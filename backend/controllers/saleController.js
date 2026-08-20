const { Sale, SaleItem, Product, Customer, User, StockMovement, sequelize } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');

const PAYMENT_METHODS = ['cash', 'bkash', 'nagad', 'card'];

// ── Invoice number generator ──────────────────────────────────────────────────
// Uses a per-day counter from the DB rather than a random suffix, so numbers are
// sequential, gap-free within a day, and cannot collide under concurrency.
const generateInvoice = async (transaction) => {
  const d   = new Date(Date.now() + 6 * 60 * 60 * 1000); // BST
  const ymd = `${d.getUTCFullYear().toString().slice(-2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const prefix = `INV-${ymd}-`;

  const [row] = await sequelize.query(
    'SELECT invoiceNo FROM sales WHERE invoiceNo LIKE :p ORDER BY id DESC LIMIT 1 FOR UPDATE',
    { replacements: { p: `${prefix}%` }, type: sequelize.QueryTypes.SELECT, transaction }
  );

  const last = row ? parseInt(String(row.invoiceNo).split('-')[2], 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
};

// ── Create Sale ───────────────────────────────────────────────────────────────
exports.createSale = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { customerId, items, discount, tax, paid, paymentMethod, note } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Add at least one product before completing the sale' });
    }
    if (items.length > 200) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'A single sale cannot contain more than 200 line items' });
    }

    const custId = V.optId(customerId, 'Customer');
    const method = V.oneOf(paymentMethod, PAYMENT_METHODS, 'Payment method', 'cash');

    // Merge duplicate lines for the same product so the stock check sees the
    // true total being sold, not each line in isolation.
    const merged = new Map();
    for (const item of items) {
      const pid = V.reqId(item.productId, 'Product');
      const qty = V.count(item.quantity, 'Quantity', { required: true, min: 1 });
      merged.set(pid, (merged.get(pid) || 0) + qty);
    }

    let subtotal = 0;
    const saleItems = [];
    const stockOps  = [];

    for (const [productId, quantity] of merged) {
      // Row lock prevents two concurrent tills overselling the same item.
      const product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!product || !product.isActive) {
        await t.rollback();
        return res.status(404).json({ success: false, message: `Product not available (id ${productId})` });
      }
      if (product.stock < quantity) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Not enough stock for "${product.name}" — ${product.stock} available, ${quantity} requested`,
        });
      }

      const unitPrice = parseFloat(product.price);
      const unitCost  = parseFloat(product.cost) || 0;
      const itemTotal = Math.round(unitPrice * quantity * 100) / 100;
      subtotal += itemTotal;

      saleItems.push({
        productId: product.id, productName: product.name,
        quantity, price: unitPrice, cost: unitCost, total: itemTotal,
      });
      stockOps.push({ product, quantity });
    }

    subtotal = Math.round(subtotal * 100) / 100;

    const discountAmt = V.money(discount, 'Discount');
    const taxAmt      = V.money(tax, 'Tax');

    // Reject rather than silently clamp — a discount larger than the bill is a
    // data-entry mistake, and swallowing it corrupts discount reporting.
    if (discountAmt > subtotal) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Discount (৳${discountAmt.toFixed(2)}) cannot be more than the subtotal (৳${subtotal.toFixed(2)})`,
      });
    }

    const total = Math.round((subtotal - discountAmt + taxAmt) * 100) / 100;

    // Distinguish "field omitted" (assume paid in full) from an explicit 0,
    // which is a legitimate fully-on-credit sale.
    const paidProvided = paid !== undefined && paid !== null && paid !== '';
    const paidRaw = paidProvided ? V.money(paid, 'Amount paid') : total;
    // Anything handed over above the total is change, not revenue.
    const paidAmt = Math.min(paidRaw, total);
    const due     = Math.round((total - paidAmt) * 100) / 100;

    const sale = await Sale.create({
      invoiceNo: await generateInvoice(t),
      customerId: custId,
      userId: req.user.id,
      subtotal, discount: discountAmt, tax: taxAmt,
      total, paid: paidAmt, due,
      paymentMethod: method,
      note: V.optString(note, 'Note', { max: 1000 }),
    }, { transaction: t });

    for (const si of saleItems) {
      await SaleItem.create({ ...si, saleId: sale.id }, { transaction: t });
    }

    // Deduct stock through the ledger so every unit sold is traceable.
    for (const { product, quantity } of stockOps) {
      await StockMovement.apply(Product, {
        product, delta: -quantity, type: 'sale',
        reference: sale.invoiceNo,
        note: `Sold on invoice ${sale.invoiceNo}`,
        user: req.user, transaction: t,
      });
    }

    if (custId) {
      const customer = await Customer.findByPk(custId, { transaction: t, lock: t.LOCK.UPDATE });
      if (customer) {
        await customer.update({
          totalPurchase: Math.round((parseFloat(customer.totalPurchase || 0) + total) * 100) / 100,
          dueAmount:     Math.round((parseFloat(customer.dueAmount || 0) + due) * 100) / 100,
        }, { transaction: t });
      }
    }

    await t.commit();

    const fullSale = await Sale.findByPk(sale.id, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Customer, as: 'customer' },
        { model: User, as: 'user', attributes: ['id', 'name'] },
      ],
    });
    res.status(201).json({ success: true, data: fullSale });
  } catch (err) {
    await t.rollback();
    if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
    V.handle(res, err, 'Could not complete the sale');
  }
};

// ── Find Sale by Invoice Number ───────────────────────────────────────────────
exports.getByInvoiceNo = async (req, res) => {
  try {
    const sale = await Sale.findOne({
      where: { invoiceNo: req.params.invoiceNo },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: User,     as: 'user',     attributes: ['id', 'name'] },
        { model: SaleItem, as: 'items' },
      ],
    });
    if (!sale) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: sale });
  } catch (err) {
    V.handle(res, err, 'Could not load invoice');
  }
};

// ── Get All Sales (paginated) ─────────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const { from, to, paymentMethod, search, dueOnly } = req.query;
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

    const where = {};
    if (from && to) {
      where.createdAt = {
        [Op.between]: [
          new Date(`${V.dateOnly(from, 'From date')}T00:00:00`),
          new Date(`${V.dateOnly(to, 'To date')}T23:59:59.999`),
        ],
      };
    }
    if (paymentMethod) where.paymentMethod = V.oneOf(paymentMethod, PAYMENT_METHODS, 'Payment method');
    if (dueOnly === 'true') where.due = { [Op.gt]: 0 };
    if (search) where.invoiceNo = { [Op.like]: `%${String(search).trim()}%` };

    // Totals are computed over the whole filtered set, not just the page —
    // otherwise the summary tiles would change every time you turn a page.
    const totalsRow = await Sale.findOne({
      where,
      attributes: [
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('total')), 0), 'revenue'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('paid')),  0), 'collected'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('due')),   0), 'due'],
        [sequelize.fn('COUNT', sequelize.col('Sale.id')), 'count'],
      ],
      raw: true,
    });

    const { rows, count } = await Sale.findAndCountAll({
      where,
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'phone'] },
        { model: User,     as: 'user',     attributes: ['id', 'name'] },
        { model: SaleItem, as: 'items' },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      offset: (page - 1) * limit,
      limit,
      distinct: true,
    });

    res.json({
      success: true,
      data: rows,
      totals: {
        revenue:   parseFloat(totalsRow?.revenue   ?? 0),
        collected: parseFloat(totalsRow?.collected ?? 0),
        due:       parseFloat(totalsRow?.due       ?? 0),
        count:     parseInt(totalsRow?.count       ?? 0),
      },
      pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    V.handle(res, err, 'Could not load sales');
  }
};

// ── Get One Sale ──────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const sale = await Sale.findByPk(req.params.id, {
      include: [
        { model: Customer, as: 'customer' },
        { model: User,     as: 'user',  attributes: ['id', 'name'] },
        { model: SaleItem, as: 'items', include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'sku'] }] },
      ],
    });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    res.json({ success: true, data: sale });
  } catch (err) {
    V.handle(res, err, 'Could not load sale');
  }
};

// ── Get Daily Sales ───────────────────────────────────────────────────────────
exports.getDailySales = async (req, res) => {
  try {
    const TZ_OFFSET_MS = 6 * 60 * 60 * 1000;
    const nowBST = new Date(Date.now() + TZ_OFFSET_MS);
    nowBST.setUTCHours(0, 0, 0, 0);
    const today    = new Date(nowBST.getTime() - TZ_OFFSET_MS);
    const tomorrow = new Date(today.getTime() + 86400000);

    const [row] = await sequelize.query(`
      SELECT COALESCE(SUM(paid), 0)  AS totalSales,
             COALESCE(SUM(total), 0) AS grossTotal,
             COALESCE(SUM(due), 0)   AS totalDue,
             COALESCE(COUNT(id), 0)  AS count
        FROM sales WHERE createdAt BETWEEN :start AND :end
    `, { replacements: { start: today, end: tomorrow }, type: sequelize.QueryTypes.SELECT });

    res.json({ success: true, data: row });
  } catch (err) {
    V.handle(res, err, 'Could not load daily sales');
  }
};

// ── Collect Due Payment ───────────────────────────────────────────────────────
exports.collectDue = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const sale = await Sale.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const currentDue = parseFloat(sale.due) || 0;
    if (currentDue <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'This invoice is already fully paid' });
    }

    const collectAmt = V.money(req.body.amount, 'Amount', { required: true });
    if (collectAmt <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }
    if (collectAmt > currentDue) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Amount (৳${collectAmt.toFixed(2)}) is more than the outstanding due of ৳${currentDue.toFixed(2)}`,
      });
    }

    const newPaid = Math.round((parseFloat(sale.paid) + collectAmt) * 100) / 100;
    const newDue  = Math.round(Math.max(0, currentDue - collectAmt) * 100) / 100;
    await sale.update({ paid: newPaid, due: newDue }, { transaction: t });

    if (sale.customerId) {
      const customer = await Customer.findByPk(sale.customerId, { transaction: t, lock: t.LOCK.UPDATE });
      if (customer) {
        await customer.update({
          dueAmount: Math.round(Math.max(0, parseFloat(customer.dueAmount) - collectAmt) * 100) / 100,
        }, { transaction: t });
      }
    }

    await t.commit();

    const updated = await Sale.findByPk(sale.id, {
      include: [{ model: SaleItem, as: 'items' }, { model: Customer, as: 'customer' }],
    });
    res.json({ success: true, data: updated, message: `৳${collectAmt.toFixed(2)} collected` });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not record the payment');
  }
};
