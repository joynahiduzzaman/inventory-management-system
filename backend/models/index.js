const sequelize  = require('../config/database');
const User       = require('./User');
const Category   = require('./Category');
const Supplier   = require('./Supplier');
const Product    = require('./Product');
const Customer   = require('./Customer');
const Sale       = require('./Sale');
const SaleItem   = require('./SaleItem');
const Expense    = require('./Expense');
const Return     = require('./Return');
const HeldSale     = require('./HeldSale');
const HeldSaleItem = require('./HeldSaleItem');
const ReturnItem = require('./ReturnItem');
const StockMovement = require('./StockMovement');
const ProductImage  = require('./ProductImage');

// ── Associations ─────────────────────────────────────────────────────────────
Product.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });
Category.hasMany(Product,   { foreignKey: 'categoryId', as: 'products' });

Product.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'supplier' });
Supplier.hasMany(Product,   { foreignKey: 'supplierId', as: 'products' });

Sale.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Customer.hasMany(Sale,   { foreignKey: 'customerId', as: 'sales' });

Sale.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Sale,   { foreignKey: 'userId', as: 'sales' });

Sale.hasMany(SaleItem,      { foreignKey: 'saleId', as: 'items' });
SaleItem.belongsTo(Sale,    { foreignKey: 'saleId', as: 'sale' });
SaleItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
Product.hasMany(SaleItem,   { foreignKey: 'productId', as: 'saleItems' });

Expense.belongsTo(User, { foreignKey: 'userId', as: 'user' });

StockMovement.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
Product.hasMany(StockMovement, { foreignKey: 'productId', as: 'movements' });
StockMovement.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Held (parked) sale associations
HeldSale.belongsTo(User,     { foreignKey: 'userId',     as: 'user' });
HeldSale.belongsTo(User,     { foreignKey: 'recalledBy', as: 'recaller' });
HeldSale.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
HeldSale.hasMany(HeldSaleItem, { foreignKey: 'heldSaleId', as: 'items' });
HeldSaleItem.belongsTo(HeldSale, { foreignKey: 'heldSaleId', as: 'hold' });

// Return associations
Return.belongsTo(Sale,       { foreignKey: 'saleId',     as: 'sale' });
Return.belongsTo(Customer,   { foreignKey: 'customerId', as: 'customer' });
Return.belongsTo(User,       { foreignKey: 'userId',     as: 'user' });
Return.hasMany(ReturnItem,   { foreignKey: 'returnId',   as: 'items' });
ReturnItem.belongsTo(Return, { foreignKey: 'returnId',   as: 'return' });
Sale.hasMany(Return,         { foreignKey: 'saleId',     as: 'returns' });

module.exports = {
  HeldSale, HeldSaleItem,
  sequelize, User, Category, Supplier, Product,
  Customer, Sale, SaleItem, Expense, Return, ReturnItem, StockMovement,
  ProductImage
};