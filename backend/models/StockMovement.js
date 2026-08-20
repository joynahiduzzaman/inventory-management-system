const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Append-only ledger of every change to products.stock.
 *
 * Before this existed, stock could move for three different reasons (sale,
 * return-restock, someone editing the number in the product form) and none of
 * them left a trace — a wrong count could not be explained after the fact.
 *
 * Rows are never updated or deleted. `stockBefore`/`stockAfter` are recorded at
 * write time inside the same transaction as the stock change, so the ledger can
 * be replayed to audit any discrepancy.
 */
const StockMovement = sequelize.define('StockMovement', {
  id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  productId:   { type: DataTypes.INTEGER, allowNull: false },
  productName: { type: DataTypes.STRING(200), allowNull: false },

  // What caused the movement.
  type: {
    type: DataTypes.ENUM('initial', 'sale', 'return', 'adjustment', 'purchase', 'damage', 'correction'),
    allowNull: false,
  },

  // Signed: negative removes stock, positive adds it.
  quantity:    { type: DataTypes.INTEGER, allowNull: false },
  stockBefore: { type: DataTypes.INTEGER, allowNull: false },
  stockAfter:  { type: DataTypes.INTEGER, allowNull: false },

  // Free-form pointer back to the source document, e.g. "INV-260819-123".
  reference:   { type: DataTypes.STRING(100), allowNull: true },
  note:        { type: DataTypes.STRING(500), allowNull: true },

  userId:      { type: DataTypes.INTEGER, allowNull: true },
  userName:    { type: DataTypes.STRING(100), allowNull: true },
}, {
  tableName: 'stock_movements',
  updatedAt: false,
  indexes: [
    { name: 'sm_product_created', fields: ['productId', 'createdAt'] },
    { name: 'sm_created',         fields: ['createdAt'] },
    { name: 'sm_type',            fields: ['type'] },
  ],
});

/**
 * Records a stock change AND applies it, inside the caller's transaction.
 * Returns the new stock level.
 *
 * Always use this instead of writing products.stock directly, so the ledger
 * can never drift from reality.
 */
StockMovement.apply = async function apply(Product, {
  product, delta, type, reference = null, note = null, user = null, transaction,
}) {
  const before = product.stock;
  const after  = before + delta;
  if (after < 0) {
    const err = new Error(`Insufficient stock for "${product.name}" — have ${before}, needed ${Math.abs(delta)}`);
    err.status = 400;
    throw err;
  }

  await product.update({ stock: after }, { transaction });
  await StockMovement.create({
    productId:   product.id,
    productName: product.name,
    type,
    quantity:    delta,
    stockBefore: before,
    stockAfter:  after,
    reference,
    note,
    userId:      user ? user.id : null,
    userName:    user ? user.name : null,
  }, { transaction });

  return after;
};

module.exports = StockMovement;
