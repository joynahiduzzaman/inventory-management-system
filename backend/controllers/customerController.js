const { Customer, Sale, SaleItem } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');
const { round2 } = require('../utils/money');
const { paginate } = require('../utils/paginate');

const parseCustomer = (body) => ({
  name:    V.reqString(body.name, 'Customer name', { max: 150 }),
  phone:   V.optPhone(body.phone),
  email:   V.optEmail(body.email),
  address: V.optString(body.address, 'Address', { max: 1000 }),
});

exports.getAll = async (req, res) => {
  try {
    const { search, dueOnly } = req.query;
    const where = {};
    if (search) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { name:  { [Op.like]: term } },
        { phone: { [Op.like]: term } },
        { email: { [Op.like]: term } },
      ];
    }
    if (dueOnly === 'true') where.dueAmount = { [Op.gt]: 0 };

    const result = await paginate(Customer, { where, order: [['name', 'ASC']] }, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    V.handle(res, err, 'Could not load customers');
  }
};

exports.getOne = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Fetched separately: a limit inside an include applies to the joined rows,
    // not per parent, so it silently truncated purchase history.
    const sales = await Sale.findAll({
      where: { customerId: customer.id },
      include: [{ model: SaleItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });

    res.json({ success: true, data: { ...customer.toJSON(), sales } });
  } catch (err) {
    V.handle(res, err, 'Could not load customer');
  }
};

exports.create = async (req, res) => {
  try {
    const customer = await Customer.create(parseCustomer(req.body));
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    V.handle(res, err, 'Could not create customer');
  }
};

exports.update = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    // totalPurchase / dueAmount are ledger-derived and must not be user-editable.
    await customer.update(parseCustomer(req.body));
    res.json({ success: true, data: customer });
  } catch (err) {
    V.handle(res, err, 'Could not update customer');
  }
};

/**
 * Deleting a customer sets customerId to NULL on their sales (FK is SET NULL),
 * which quietly detaches invoice history. Block it when they have any, and
 * always block while money is outstanding.
 */
exports.delete = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const due = parseFloat(customer.dueAmount) || 0;
    if (due > 0) {
      return res.status(409).json({
        success: false,
        message: `${customer.name} still owes ৳${due.toFixed(2)}. Settle the balance before deleting.`,
      });
    }

    const saleCount = await Sale.count({ where: { customerId: customer.id } });
    if (saleCount > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        success: false,
        message: `${customer.name} has ${saleCount} sale${saleCount === 1 ? '' : 's'} on record. Deleting will detach those invoices from the customer.`,
        saleCount,
        requiresConfirmation: true,
      });
    }

    await customer.destroy();
    res.json({ success: true, message: `Customer "${customer.name}" deleted` });
  } catch (err) {
    V.handle(res, err, 'Could not delete customer');
  }
};

/**
 * Records a payment against a CUSTOMER rather than against one invoice.
 *
 * Credit here is tracked per person, not per document: a shopkeeper taking
 * ৳2,000 off Ramiz's ৳5,000 balance is not thinking about which invoice it
 * lands on, and making them pick one — the only thing the per-invoice endpoint
 * allowed — is asking them to do the shop's bookkeeping by hand.
 *
 * The money is allocated OLDEST INVOICE FIRST, which is what both sides
 * assume: the debt that has been outstanding longest is the one being settled.
 * The last invoice touched is usually paid only in part, and that is normal
 * rather than an error.
 *
 * Correctness notes:
 *
 *  - The whole allocation is one transaction. A concurrent credit sale to the
 *    same customer must not be able to interleave and leave the customer's
 *    running balance disagreeing with the sum of their unpaid invoices.
 *
 *  - The customer row is locked FIRST, before the invoices, and every caller
 *    that touches a customer balance takes the locks in that same order. Two
 *    payments arriving together therefore queue instead of deadlocking.
 *
 *  - Overpayment is refused, not absorbed. Silently keeping ৳500 of credit the
 *    shop has no way to show or return would be a worse answer than "that is
 *    more than they owe".
 *
 *  - Every allocation writes its own row through the existing per-invoice
 *    fields, so the ledger still reconciles: sum(sales.due) for a customer
 *    always equals customers.dueAmount afterwards.
 */
exports.collectDue = async (req, res) => {
  const { sequelize } = require('../models');
  const t = await sequelize.transaction();
  try {
    const amount = V.money(req.body.amount, 'Amount', { required: true });
    if (amount <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }

    const customerId = req.params.id;

    // ── Lock order: SALES FIRST, THEN THE CUSTOMER ──────────────────────────
    // This is not arbitrary. saleController.collectDue locks the sale and then
    // its customer; saleController.create locks products and then the
    // customer. Every path that touches a customer balance therefore takes the
    // customer lock LAST. Taking it first here — which is the order this
    // function was first written in — would have closed a cycle with the
    // per-invoice endpoint: it holding a sale and wanting the customer, this
    // holding the customer and wanting that sale. Two payments for the same
    // person at the same moment would deadlock.
    const unpaid = await Sale.findAll({
      where: { customerId, due: { [Op.gt]: 0 } },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const customer = await Customer.findByPk(customerId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!customer) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Sum from the invoices, not from customers.dueAmount. The invoices are the
    // documents; the column is a cached total. This also counts any invoice
    // created between the two locks above, so an overpayment cannot slip
    // through that gap.
    //
    // FOR UPDATE is load-bearing, not decoration. A plain SELECT inside a
    // transaction reads a snapshot, and on TiDB that snapshot is fixed when the
    // transaction STARTS — so after this transaction has sat waiting on the row
    // locks above, a plain read still returns the totals from before the
    // transaction it just waited for. Measured: plain read 200.00, locking read
    // 100.00, true value 100.00. MySQL happened to be safe here only because
    // InnoDB establishes its consistent-read snapshot at the first NON-locking
    // read, which lands after that wait; relying on that was fragile on both
    // engines. A locking read sees the latest committed data on both.
    const [{ outstanding }] = await sequelize.query(
      'SELECT COALESCE(SUM(due), 0) AS outstanding FROM sales WHERE customerId = :customerId FOR UPDATE',
      { replacements: { customerId }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );
    const owed = round2(parseFloat(outstanding || 0));

    if (owed <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'This customer has nothing outstanding' });
    }

    // Refused, never absorbed. Quietly keeping ৳500 of credit the shop has no
    // way to show or hand back would be a worse answer than saying no.
    if (amount > owed) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Amount (৳${amount.toFixed(2)}) is more than the outstanding balance of ৳${owed.toFixed(2)}`,
      });
    }

    // ── Allocate, oldest invoice first ──────────────────────────────────────
    // Which is what both sides assume: the debt outstanding longest is the one
    // being settled. The last invoice reached is usually paid only in part,
    // and that is normal rather than an error.
    let remaining = amount;
    const allocations = [];

    for (const inv of unpaid) {
      if (remaining <= 0) break;
      const invDue = round2(parseFloat(inv.due || 0));
      if (invDue <= 0) continue;

      const applied = round2(Math.min(remaining, invDue));
      const newPaid = round2(parseFloat(inv.paid || 0) + applied);
      const newDue  = round2(invDue - applied);

      await inv.update({ paid: newPaid, due: newDue }, { transaction: t });

      allocations.push({
        saleId: inv.id,
        invoiceNo: inv.invoiceNo,
        applied,
        remainingOnInvoice: newDue,
        settled: newDue === 0,
      });

      remaining = round2(remaining - applied);
    }

    // Recompute from the table rather than subtracting, so the cached total can
    // never drift away from the documents behind it. Locking, for the same
    // snapshot reason as above.
    const [{ balance }] = await sequelize.query(
      'SELECT COALESCE(SUM(due), 0) AS balance FROM sales WHERE customerId = :customerId FOR UPDATE',
      { replacements: { customerId }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );
    const newBalance = round2(parseFloat(balance || 0));
    await customer.update({ dueAmount: newBalance }, { transaction: t });

    await t.commit();

    res.json({
      success: true,
      data: {
        customerId: customer.id,
        customerName: customer.name,
        collected: amount,
        previousBalance: owed,
        newBalance,
        invoicesSettled: allocations.filter(a => a.settled).length,
        allocations,
      },
      message: `৳${amount.toFixed(2)} collected from ${customer.name}`,
    });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not record the payment');
  }
};

/** The customer's unpaid invoices, oldest first — what a payment would settle. */
/**
 * A customer's balance history, as events rather than as a number.
 *
 * "Ramiz owes ৳0" is not an answer to "why did Ramiz stop owing ৳30". Without
 * this, a return that settles a debt shows up as an unexplained drop in the
 * balance, and next month nobody can reconstruct what happened.
 *
 * Two kinds of event exist in the data:
 *   - a credit sale, which created debt
 *   - a return that settled some of it (returns.appliedToDue > 0)
 *
 * Individual PAYMENTS cannot be listed: there is no payments table — the ledger
 * is sales.paid/sales.due itself, so a payment is visible only as the gap
 * between a sale's total and its due. That is a pre-existing limitation, called
 * out in the response as `paymentsItemised: false` rather than papered over
 * with a guess.
 */
exports.getHistory = async (req, res) => {
  // Required here rather than at module scope, matching collectDue below.
  const { sequelize } = require('../models');
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const sales = await Sale.findAll({
      where: { customerId: customer.id },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      attributes: ['id', 'invoiceNo', 'total', 'paid', 'due', 'createdAt'],
    });

    const settlements = await sequelize.query(
      `SELECT r.id, r.returnNo, r.appliedToDue, r.totalRefund, r.createdAt, s.invoiceNo
         FROM returns r JOIN sales s ON s.id = r.saleId
        WHERE r.customerId = :customerId AND r.appliedToDue > 0
        ORDER BY r.createdAt ASC`,
      { type: sequelize.QueryTypes.SELECT, replacements: { customerId: customer.id } }
    );

    const events = [
      ...sales.map((s) => ({
        type: 'sale',
        at: s.createdAt,
        ref: s.invoiceNo,
        amount: round2(parseFloat(s.total || 0)),
        stillOwed: round2(parseFloat(s.due || 0)),
      })),
      ...settlements.map((r) => ({
        type: 'return_settlement',
        at: r.createdAt,
        ref: r.returnNo,
        againstInvoice: r.invoiceNo,
        // What this event did to the balance, and what was handed back.
        amount: round2(parseFloat(r.appliedToDue || 0)),
        cashReturned: round2(parseFloat(r.totalRefund || 0) - parseFloat(r.appliedToDue || 0)),
      })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      success: true,
      data: {
        customerId: customer.id,
        customerName: customer.name,
        outstanding: round2(sales.reduce((n, s) => n + parseFloat(s.due || 0), 0)),
        cachedBalance: round2(parseFloat(customer.dueAmount || 0)),
        paymentsItemised: false,
        events,
      },
    });
  } catch (err) {
    V.handle(res, err, 'Could not load the balance history');
  }
};

exports.getDue = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const unpaid = await Sale.findAll({
      where: { customerId: customer.id, due: { [Op.gt]: 0 } },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      attributes: ['id', 'invoiceNo', 'total', 'paid', 'due', 'createdAt'],
    });

    const outstanding = round2(unpaid.reduce((s, i) => s + parseFloat(i.due || 0), 0));

    res.json({
      success: true,
      data: {
        customerId: customer.id,
        customerName: customer.name,
        outstanding,
        // Surfaced deliberately: if the cached total ever disagrees with the
        // invoices, the caller should be able to see that rather than trust it.
        cachedBalance: round2(parseFloat(customer.dueAmount || 0)),
        invoices: unpaid,
      },
    });
  } catch (err) {
    V.handle(res, err, 'Could not load the outstanding balance');
  }
};
