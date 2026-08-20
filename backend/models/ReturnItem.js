const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReturnItem = sequelize.define('ReturnItem', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  returnId:    { type: DataTypes.INTEGER, allowNull: false },
  saleItemId:  { type: DataTypes.INTEGER, allowNull: false },
  productId:   { type: DataTypes.INTEGER, allowNull: true },
  productName: { type: DataTypes.STRING },
  quantity:    { type: DataTypes.INTEGER, defaultValue: 1 },
  price:       { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  cost:        { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  refundTotal: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  restockItem: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'return_items', timestamps: false });

module.exports = ReturnItem;