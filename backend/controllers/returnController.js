const { Return, ReturnItem, Sale, SaleItem, Product, Customer, User, StockMovement, sequelize } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');
const { round2 } = require('../utils/money');

const generateReturnNo = () => {
  const d    = new Date();
  const y    = d.getFullYear().toString().slice(-2);
  const m    = String(d.getMonth() + 1).padStart(2, '0');
  const day  = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RET-${y}${m}${day}-${rand}`;
};

// GET /returns
exports.getAll = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from && to) where.createdAt = { [Op.between]: [new Date(from + 'T00:00:00'), new Date(to + 'T23:59:59')] };

    const returns = await Return.findAll({
      where,
      include: [
        { model: Sale,     as: 'sale',     attributes: ['id', 'invoiceNo'] },
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: User,     as: 'user',     attributes: ['id', 'name'] },
        { model: ReturnItem, as: 'items' }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, data: returns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /returns/:id
exports.getOne = async (req, res) => {
  try {
    const ret = await Return.findByPk(req.params.id, {
      include: [
        { model: Sale,       as: 'sale',     attributes: ['id', 'invoiceNo', 'total'] },
        { model: Customer,   as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: User,       as: 'user',     attributes: ['id', 'name'] },
        { model: ReturnItem, as: 'items' }
      ]
    });
    if (!ret) return res.status(404).json({ success: false, message: 'Return not found' });
    res.json({ success: true, data: ret });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /returns/sale/:saleId — get returnable items for a sale
exports.getReturnableItems = async (req, res) => {
  try {
    const sale = await Sale.findByPk(req.params.saleId, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Customer, as: 'customer', attributes: ['id', 'name'] }
      ]
    });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });

    // For each sale item, calculate how many have already been returned
    const items = await Promise.all(sale.items.map(async (item) => {
      const returned = await ReturnItem.sum('quantity', {
        where: { saleItemId: item.id }
      }) || 0;
      const maxReturnable = item.quantity - returned;
      return {
        id:             item.id,
        productId:      item.productId,
        productName:    item.productName,
        quantity:       item.quantity,
        price:          item.price,
        alreadyReturned: returned,
        maxReturnable
      };
    }));

    const returnableItems = items.filter(i => i.maxReturnable > 0);
    res.json({ success: true, data: { sale, items: returnableItems } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /returns — process a return
exports.createReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { saleId, items, refundMethod, reason, note } = req.body;

    if (!items || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'No items selected for return' });
    }

    const sale = await Sale.findByPk(saleId, {
      include: [
        { model: Customer, as: 'customer' },
        { model: SaleItem, as: 'items' },      // loaded here — no extra query needed later
      ],
      transaction: t,
    });
    if (!sale) { await t.rollback(); return res.status(404).json({ success: false, message: 'Sale not found' }); }

    // Build a map of saleItemId → SaleItem from the sale we just loaded.
    // All per-item lookups in the loop use this map — zero extra DB queries.
    const saleItemMap = {};
    for (const si of sale.items) {
      saleItemMap[si.id] = si;
    }

    let totalRefund = 0;
    const returnItemsData = [];
    const restockOps = [];
    const thisReturnQty = {};   // saleItemId -> quantity being returned right now

    // Fetch already-returned quantities for ALL items in this sale — not just the
    // ones in this request. This ensures the allItemsReturned check is complete
    // even if prior returns covered different items.
    const allSaleItemIds = sale.items.map(si => si.id);
    const alreadyReturnedRows = await ReturnItem.findAll({
      attributes: ['saleItemId', [sequelize.fn('SUM', sequelize.col('quantity')), 'returnedQty']],
      where: { saleItemId: allSaleItemIds },
      group: ['saleItemId'],
      transaction: t,
      raw: true,
    });
    const alreadyReturnedMap = {};
    for (const row of alreadyReturnedRows) {
      // Cast key to int — Sequelize raw results may return saleItemId as string or number
      alreadyReturnedMap[parseInt(row.saleItemId)] = parseInt(row.returnedQty) || 0;
    }

    // Precompute total sale qty from already-loaded items — no extra DB query needed
    const totalSaleQty = sale.items.reduce((s, si) => s + si.quantity, 0);

    // ── Refund arithmetic ───────────────────────────────────────────────
    //
    // A refund returns what the customer PAID, not what the goods were listed
    // at. On a discounted sale those differ: ৳40.40 of goods sold for ৳30.00
    // must refund ৳30.00, or the shop hands back money it never took. Every
    // returned line therefore carries its proportional share of the discount.
    //
    // Tax is deliberately left out of this. It was never part of a refund
    // before, and folding it in now would change every undiscounted return
    // too — a separate decision, not this one.
    //
    // What is frozen after a sale, and what is not:
    //
    //   frozen   total, subtotal, discount, tax — the invoice as agreed
    //   mutable  paid, due — payment state, which collectDue has always moved
    //
    // The old comment here said "invoice totals are NEVER modified", which was
    // misleading: collectDue mutates paid and due on every payment. Only the
    // agreed amounts are immutable. A refund settling a debt moves `due` for
    // the same reason a payment does — the customer no longer owes it.
    const saleSubtotal = parseFloat(sale.subtotal) || 0;
    const saleDiscount = parseFloat(sale.discount) || 0;
    // Nothing was charged, so nothing was discounted — and dividing by zero
    // would poison every line.
    const discountFactor = saleSubtotal > 0
      ? (saleSubtotal - saleDiscount) / saleSubtotal
      : 1;

    /** Face value — price x qty, before any discount — of a set of quantities. */
    const faceValue = (qtyOf) => sale.items.reduce(
      (sum, si) => sum + parseFloat(si.price) * (qtyOf[si.id] || 0), 0);

    for (const ri of items) {
      let qty;
      try {
        qty = V.count(ri.quantity, 'Return quantity', { required: true, min: 1 });
      } catch (ve) {
        await t.rollback();
        return res.status(400).json({ success: false, message: ve.message });
      }
      if (!ri.saleItemId) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'A return line is missing its sale item reference' });
      }

      // Lookup from the map built off sale.items — no DB query, and guarantees
      // the item belongs to this sale (items not in this sale won't be in the map).
      const saleItem = saleItemMap[parseInt(ri.saleItemId)];
      if (!saleItem) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Item ${ri.saleItemId} does not belong to sale ${saleId}` });
      }

      const alreadyReturned = alreadyReturnedMap[parseInt(ri.saleItemId)] || 0;
      const maxReturnable = saleItem.quantity - alreadyReturned;
      if (maxReturnable <= 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Item "${saleItem.productName}" has already been fully returned` });
      }
      if (qty > maxReturnable) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Cannot return ${qty} of "${saleItem.productName}" — max returnable is ${maxReturnable}` });
      }

      thisReturnQty[saleItem.id] = (thisReturnQty[saleItem.id] || 0) + qty;

      // Restock through the ledger so the returned units are traceable.
      if (ri.restockItem) {
        const product = await Product.findByPk(saleItem.productId, { transaction: t, lock: t.LOCK.UPDATE });
        if (product) {
          restockOps.push({ product, qty, productName: saleItem.productName });
        }
      }

      returnItemsData.push({
        saleItemId:  saleItem.id,
        productId:   saleItem.productId,
        productName: saleItem.productName,
        quantity:    qty,
        price:       saleItem.price,
        cost:        parseFloat(saleItem.cost || 0),
        refundTotal: 0,          // allocated below, once the total is known
        restockItem: !!ri.restockItem,
      });
    }

    // Telescoping total: this return refunds the discounted value of everything
    // returned so far, minus whatever earlier returns already gave back. A sale
    // returned in three pieces therefore refunds exactly what was paid in
    // total, with the final return absorbing the rounding remainder instead of
    // stranding a paisa. Returning it all at once still lands on
    // subtotal - discount, and on an undiscounted sale the factor is 1 and this
    // reduces to the face value it always was.
    const afterQty = { ...alreadyReturnedMap };
    for (const [id, q] of Object.entries(thisReturnQty)) {
      afterQty[id] = (afterQty[id] || 0) + q;
    }
    const refundedBefore = round2(faceValue(alreadyReturnedMap) * discountFactor);
    totalRefund = round2(round2(faceValue(afterQty) * discountFactor) - refundedBefore);

    // Split that total across this return's lines by largest remainder, so the
    // line amounts add up to the total exactly rather than to a paisa either
    // side of it.
    const weights   = returnItemsData.map((r) => parseFloat(r.price) * r.quantity);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    if (weightSum > 0) {
      const targetPaisa = Math.round(totalRefund * 100);
      const exact  = weights.map((w) => (targetPaisa * w) / weightSum);
      const paisa  = exact.map((e) => Math.floor(e));
      let left = targetPaisa - paisa.reduce((a, b) => a + b, 0);
      const byFraction = exact
        .map((e, i) => ({ i, frac: e - Math.floor(e) }))
        .sort((a, b) => b.frac - a.frac);
      for (let k = 0; k < byFraction.length && left > 0; k += 1, left -= 1) {
        paisa[byFraction[k].i] += 1;
      }
      returnItemsData.forEach((r, i) => { r.refundTotal = paisa[i] / 100; });
    }

    if (returnItemsData.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'No valid items to return' });
    }

    // ── Settle the debt before handing back cash ─────────────────────────
    //
    // A customer who bought on credit and returns the goods should stop owing
    // for them. Previously the refund was recorded in the return ledger and
    // the balance beside their name did not move — defensible accounting and
    // indefensible at a counter, where the shopkeeper is holding the goods and
    // the book still says the customer owes.
    //
    // So: the refund clears what is outstanding on THIS invoice first, and only
    // the remainder is money out of the till. A ৳100 sale with ৳70 paid and
    // ৳30 owing, returned in full, cancels the ৳30 and hands back ৳70.
    //
    // Lock order is SALES THEN CUSTOMER, matching collectDue exactly. Taking
    // them in the other order would deadlock a return against a payment for
    // the same customer. The due is re-read under the lock rather than trusted
    // from the sale loaded at the top of this request, because a payment may
    // have landed in between.
    let appliedToDue = 0;
    if (sale.customerId) {
      const [{ currentDue }] = await sequelize.query(
        'SELECT due AS currentDue FROM sales WHERE id = :saleId FOR UPDATE',
        { type: sequelize.QueryTypes.SELECT, replacements: { saleId }, transaction: t }
      );
      const owed = round2(parseFloat(currentDue || 0));
      appliedToDue = round2(Math.min(totalRefund, Math.max(0, owed)));

      if (appliedToDue > 0) {
        await sequelize.query(
          'UPDATE sales SET due = :newDue WHERE id = :saleId',
          { replacements: { newDue: round2(owed - appliedToDue), saleId }, transaction: t }
        );
        const customer = await Customer.findByPk(sale.customerId, {
          transaction: t, lock: t.LOCK.UPDATE,
        });
        if (customer) {
          await customer.update(
            { dueAmount: round2(Math.max(0, parseFloat(customer.dueAmount || 0) - appliedToDue)) },
            { transaction: t }
          );
        }
      }
    }
    // What actually leaves the till. The receipt shows both halves.
    const cashRefund = round2(totalRefund - appliedToDue);

    // Create return record
    const now = new Date();
    const ret = await Return.create({
      returnNo:     generateReturnNo(),
      saleId,
      customerId:   sale.customerId || null,
      userId:       req.user.id,
      totalRefund,
      appliedToDue,
      refundMethod: refundMethod || 'cash',
      reason,
      note,
      createdAt:    now,
      updatedAt:    now,
    }, { transaction: t });

    // Create return items
    for (const ri of returnItemsData) {
      await ReturnItem.create({ ...ri, returnId: ret.id }, { transaction: t });
    }

    // Put the returned units back on the shelf, on the ledger.
    for (const { product, qty } of restockOps) {
      await StockMovement.apply(Product, {
        product, delta: qty, type: 'return',
        reference: ret.returnNo,
        note: `Returned against ${sale.invoiceNo}`,
        user: req.user, transaction: t,
      });
    }

    // ── What a return touches ───────────────────────────────────────────────
    // total/subtotal/discount/tax:  never
    // due (and the customer's cached balance):  only when the refund settles a
    //   debt, and only by appliedToDue, which is recorded on the return
    // paid:  never — it is cash received, and reports it as `collected`
    //
    // Net revenue and profit are still derived at query time:
    //   Net Revenue = SUM(sales.total) - SUM(returns.totalRefund)
    // The return ledger remains the single source of truth for refunds.

    await t.commit();

    const fullReturn = await Return.findByPk(ret.id, {
      include: [
        { model: Sale,       as: 'sale',     attributes: ['id', 'invoiceNo'] },
        { model: Customer,   as: 'customer', attributes: ['id', 'name'] },
        { model: ReturnItem, as: 'items' }
      ]
    });

    // cashRefund is derived, not stored — totalRefund and appliedToDue are the
    // facts, and a derived third column could drift from them. It is returned
    // here so the receipt can print the split without recomputing it.
    res.status(201).json({
      success: true,
      data: { ...fullReturn.toJSON(), cashRefund },
    });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not process the return');
  }
};