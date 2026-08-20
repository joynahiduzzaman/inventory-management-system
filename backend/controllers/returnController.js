const { Return, ReturnItem, Sale, SaleItem, Product, Customer, User, StockMovement, sequelize } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');

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

    // Refund = full face value of returned items (price × qty).
    // Invoice totals are NEVER modified after a return — the return ledger
    // records the refund and all net calculations (revenue, profit) are
    // derived at query time by subtracting returns from gross sales.

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

      // Refund = full face value. Accumulate unrounded to avoid per-item drift.
      const fullAmt   = parseFloat(saleItem.price) * qty;
      totalRefund += fullAmt;

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
        refundTotal: parseFloat((parseFloat(saleItem.price) * qty).toFixed(2)),
        restockItem: !!ri.restockItem,
      });
    }

    // Round the accumulated totalRefund once here — avoids per-item rounding drift.
    // e.g. 3 items at ৳33.333 each: accumulate 99.999, round once → ৳100.00
    // vs rounding each to ৳33.33 first: 33.33 × 3 = ৳99.99 (wrong by 0.01)
    totalRefund = parseFloat(totalRefund.toFixed(2));

    if (returnItemsData.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'No valid items to return' });
    }

    // Create return record
    const now = new Date();
    const ret = await Return.create({
      returnNo:     generateReturnNo(),
      saleId,
      customerId:   sale.customerId || null,
      userId:       req.user.id,
      totalRefund,
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

    // ── Invoice totals (total/paid/due) are NEVER modified after a return ────
    // All net revenue and profit figures are computed at query time by the
    // reportController using: Net Revenue = SUM(sales.total) - SUM(returns.totalRefund)
    // The return ledger (returns + return_items tables) is the single source of truth.

    await t.commit();

    const fullReturn = await Return.findByPk(ret.id, {
      include: [
        { model: Sale,       as: 'sale',     attributes: ['id', 'invoiceNo'] },
        { model: Customer,   as: 'customer', attributes: ['id', 'name'] },
        { model: ReturnItem, as: 'items' }
      ]
    });

    res.status(201).json({ success: true, data: fullReturn });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not process the return');
  }
};