const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Product = sequelize.define('Product', {
  id:           { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name:         { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: { msg: 'Product name is required' } } },
  sku:          { type: DataTypes.STRING(100), unique: true, allowNull: true },
  barcode:      { type: DataTypes.STRING(200), unique: true, allowNull: true },
  qrCode:       { type: DataTypes.STRING(200), unique: true, allowNull: true },
  categoryId:   { type: DataTypes.INTEGER, allowNull: true, references: { model: 'categories', key: 'id' } },
  supplierId:   { type: DataTypes.INTEGER, allowNull: true, references: { model: 'suppliers', key: 'id' } },
  price:        { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0, validate: { min: { args: [0], msg: 'Selling price cannot be negative' } } },
  cost:         { type: DataTypes.DECIMAL(10,2), allowNull: false, defaultValue: 0, validate: { min: { args: [0], msg: 'Cost price cannot be negative' } } },
  stock:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: { args: [0], msg: 'Stock cannot be negative' }, isInt: { msg: 'Stock must be a whole number' } } },
  lowStockAlert:{ type: DataTypes.INTEGER, defaultValue: 10, validate: { min: { args: [0], msg: 'Low-stock alert cannot be negative' } } },
  unit:         { type: DataTypes.STRING(50), defaultValue: 'pcs' },
  description:  { type: DataTypes.TEXT, allowNull: true },
  image:        { type: DataTypes.STRING(500), allowNull: true },
  isActive:     { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'products' });

module.exports = Product;