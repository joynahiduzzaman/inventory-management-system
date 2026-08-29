const { Product, Category, Supplier, StockMovement, ProductImage, sequelize } = require('../models');
const { Op } = require('sequelize');
const path = require('path');
const V    = require('../utils/validate');
const { storedName } = require('../middleware/upload');

const INCLUDE_REFS = [
  { model: Category, as: 'category', attributes: ['id', 'name'] },
  { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
];

/**
 * Writes an uploaded image to the database inside the caller's transaction and
 * returns the "/uploads/<name>" path to store on the product.
 *
 * Being part of the transaction is the point: if the product write fails, the
 * image row rolls back with it, so a failed save can never leave an orphan.
 */
const saveUpload = async (file, transaction) => {
  if (!file) return null;
  const filename = storedName(file.originalname);
  await ProductImage.create({
    filename,
    mimeType: file.mimetype,
    size:     file.size,
    data:     file.buffer,
  }, { transaction });
  return `/uploads/${filename}`;
};

/** Best-effort removal of a superseded image. Never fails the request: the
 *  product already points at the new image, so a leftover row is only waste. */
const removeStoredImage = async (imagePath) => {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  try {
    await ProductImage.destroy({ where: { filename: path.basename(imagePath) } });
  } catch { /* the product is already saved; a stale row is not worth a 500 */ }
};

// ── List ─────────────────────────────────────────────────────────────────────
// Search now spans name, SKU and barcode — a shop looks products up by whatever
// is printed on the box, not just the name.
exports.getAll = async (req, res) => {
  try {
    const { search, category, supplier, stockStatus, includeInactive } = req.query;

    const where = {};
    if (includeInactive !== 'true') where.isActive = true;

    if (search) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { name:    { [Op.like]: term } },
        { sku:     { [Op.like]: term } },
        { barcode: { [Op.like]: term } },
      ];
    }
    if (category) where.categoryId = V.optId(category, 'Category');
    if (supplier) where.supplierId = V.optId(supplier, 'Supplier');
    if (stockStatus === 'out')      where.stock = 0;
    if (stockStatus === 'low')      where.stock = { [Op.gt]: 0, [Op.lte]: sequelize.col('lowStockAlert') };
    if (stockStatus === 'in')       where.stock = { [Op.gt]: 0 };

    const products = await Product.findAll({
      where,
      include: INCLUDE_REFS,
      order: [['name', 'ASC']],
    });
    res.json({ success: true, data: products });
  } catch (err) {
    V.handle(res, err, 'Could not load products');
  }
};

exports.scanProduct = async (req, res) => {
  try {
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ success: false, message: 'No code provided' });

    const product = await Product.findOne({
      where: { isActive: true, [Op.or]: [{ sku: code }, { barcode: code }, { qrCode: code }] },
      include: INCLUDE_REFS,
    });

    if (!product) return res.status(404).json({ success: false, message: `No product found for: "${code}"` });
    if (product.stock === 0) return res.status(400).json({ success: false, message: `"${product.name}" is out of stock` });

    res.json({ success: true, data: product });
  } catch (err) {
    V.handle(res, err, 'Scan failed');
  }
};

exports.getLowStock = async (req, res) => {
  try {
    const products = await sequelize.query(
      `SELECT p.*, c.name AS categoryName
         FROM products p
         LEFT JOIN categories c ON p.categoryId = c.id
        WHERE p.isActive = 1 AND p.stock <= p.lowStockAlert
        ORDER BY (p.stock = 0) DESC, p.stock ASC`,
      { type: sequelize.QueryTypes.SELECT }
    );
    res.json({ success: true, data: products });
  } catch (err) {
    V.handle(res, err, 'Could not load low-stock products');
  }
};

/** Total retail and cost value of everything on the shelves. */
exports.getValuation = async (req, res) => {
  try {
    const [row] = await sequelize.query(
      `SELECT
         COUNT(*)                                AS productCount,
         COALESCE(SUM(stock), 0)                 AS totalUnits,
         COALESCE(SUM(stock * cost), 0)          AS costValue,
         COALESCE(SUM(stock * price), 0)         AS retailValue,
         COALESCE(SUM(stock * (price - cost)),0) AS potentialProfit,
         SUM(stock = 0)                          AS outOfStock,
         SUM(stock > 0 AND stock <= lowStockAlert) AS lowStock
       FROM products WHERE isActive = 1`,
      { type: sequelize.QueryTypes.SELECT }
    );
    res.json({ success: true, data: row });
  } catch (err) {
    V.handle(res, err, 'Could not calculate inventory valuation');
  }
};

exports.getOne = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: [{ model: Category, as: 'category' }, { model: Supplier, as: 'supplier' }],
    });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (err) {
    V.handle(res, err, 'Could not load product');
  }
};

/** Stock movement history for one product — the audit trail. */
exports.getMovements = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const movements = await StockMovement.findAll({
      where: { productId: V.reqId(req.params.id, 'Product id') },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
    });
    res.json({ success: true, data: movements });
  } catch (err) {
    V.handle(res, err, 'Could not load stock history');
  }
};

// ── Create / update ──────────────────────────────────────────────────────────
const parseProductData = (body) => {
  const data = {
    name:          V.reqString(body.name, 'Product name', { max: 200 }),
    sku:           V.optString(body.sku, 'SKU', { max: 100 }),
    barcode:       V.optString(body.barcode, 'Barcode', { max: 200 }),
    qrCode:        V.optString(body.qrCode, 'QR code', { max: 200 }),
    categoryId:    V.optId(body.categoryId, 'Category'),
    supplierId:    V.optId(body.supplierId, 'Supplier'),
    price:         V.money(body.price, 'Selling price', { max: 99999999.99 }),
    cost:          V.money(body.cost, 'Cost price', { max: 99999999.99 }),
    stock:         V.count(body.stock, 'Stock quantity'),
    lowStockAlert: body.lowStockAlert === undefined || body.lowStockAlert === ''
      ? 10 : V.count(body.lowStockAlert, 'Low-stock alert'),
    unit:          V.optString(body.unit, 'Unit', { max: 50 }) || 'pcs',
    description:   V.optString(body.description, 'Description', { max: 5000 }),
  };

  if (data.price < data.cost) {
    throw new V.ValidationError(
      `Selling price (৳${data.price.toFixed(2)}) cannot be less than cost price (৳${data.cost.toFixed(2)})`,
      'price'
    );
  }
  return data;
};

exports.create = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const data = parseProductData(req.body);
    const image = await saveUpload(req.file, t);
    if (image) data.image = image;
    const product = await Product.create(data, { transaction: t });

    // Opening balance goes on the ledger so the running total always reconciles.
    if (product.stock > 0) {
      await StockMovement.create({
        productId: product.id, productName: product.name,
        type: 'initial', quantity: product.stock,
        stockBefore: 0, stockAfter: product.stock,
        reference: 'Opening stock', note: 'Recorded when the product was created',
        userId: req.user.id, userName: req.user.name,
      }, { transaction: t });
    }

    await t.commit();
    const full = await Product.findByPk(product.id, { include: INCLUDE_REFS });
    res.status(201).json({ success: true, data: full });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not create product');
  }
};

exports.update = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) { await t.rollback(); return res.status(404).json({ success: false, message: 'Product not found' }); }

    const data = parseProductData(req.body);

    // Held for after the commit: the old image must not be dropped while the
    // transaction that repoints the product at the new one can still roll back.
    const previousImage = product.image;
    const image = await saveUpload(req.file, t);
    if (image) data.image = image;

    // A stock edit from the product form is a real inventory movement — log it
    // rather than letting the number change silently.
    const newStock = data.stock;
    const oldStock = product.stock;
    delete data.stock;

    await product.update(data, { transaction: t });

    if (newStock !== oldStock) {
      await StockMovement.apply(Product, {
        product, delta: newStock - oldStock, type: 'correction',
        reference: 'Product edit',
        note: `Stock changed from ${oldStock} to ${newStock} while editing the product`,
        user: req.user, transaction: t,
      });
    }

    await t.commit();

    // Only now, with the new image safely committed, is the old one dead weight.
    if (image && previousImage && previousImage !== image) {
      await removeStoredImage(previousImage);
    }

    const updated = await Product.findByPk(product.id, { include: INCLUDE_REFS });
    res.json({ success: true, data: updated });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not update product');
  }
};

/**
 * Explicit stock adjustment — the correct way for a shop to record a recount,
 * damaged goods, or a delivery arriving. Always leaves an audit row.
 */
exports.adjustStock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) { await t.rollback(); return res.status(404).json({ success: false, message: 'Product not found' }); }

    const mode = V.oneOf(req.body.mode, ['add', 'remove', 'set'], 'Adjustment type');
    const qty  = V.count(req.body.quantity, 'Quantity', { required: true, min: mode === 'set' ? 0 : 1 });
    const type = V.oneOf(req.body.type, ['adjustment', 'purchase', 'damage', 'correction'], 'Reason', 'adjustment');
    const note = V.optString(req.body.note, 'Note', { max: 500 });

    let delta;
    if (mode === 'add')    delta = qty;
    if (mode === 'remove') delta = -qty;
    if (mode === 'set')    delta = qty - product.stock;

    if (delta === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'That would not change the stock level' });
    }
    if (product.stock + delta < 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot remove ${qty} — only ${product.stock} in stock`,
      });
    }

    await StockMovement.apply(Product, {
      product, delta, type,
      reference: mode === 'set' ? 'Stock recount' : 'Manual adjustment',
      note, user: req.user, transaction: t,
    });

    await t.commit();
    const updated = await Product.findByPk(product.id, { include: INCLUDE_REFS });
    res.json({
      success: true,
      data: updated,
      message: `Stock updated: ${product.stock - delta} → ${product.stock}`,
    });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not adjust stock');
  }
};

// Soft delete — sale history references products, so rows are never destroyed.
exports.delete = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    if (!product.isActive) return res.json({ success: true, message: 'Product is already archived' });
    await product.update({ isActive: false });
    res.json({ success: true, message: `"${product.name}" archived. Sales history is preserved.` });
  } catch (err) {
    V.handle(res, err, 'Could not archive product');
  }
};

exports.restore = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    await product.update({ isActive: true });
    res.json({ success: true, message: `"${product.name}" restored` });
  } catch (err) {
    V.handle(res, err, 'Could not restore product');
  }
};
