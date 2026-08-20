const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SaleItem = sequelize.define('SaleItem', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  saleId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'sales', key: 'id' } },
  productId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'products', key: 'id' } },
  productName: { type: DataTypes.STRING(200), allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: { args: [1], msg: 'Quantity must be at least 1' }, isInt: { msg: 'Quantity must be a whole number' } } },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  cost: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(12, 2), allowNull: false }
}, { tableName: 'sale_items' });

module.exports = SaleItem;
