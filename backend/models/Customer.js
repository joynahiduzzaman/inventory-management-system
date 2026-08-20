const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Customer = sequelize.define('Customer', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(150), allowNull: false, validate: { notEmpty: { msg: 'Customer name is required' } } },
  phone: { type: DataTypes.STRING(20), allowNull: true },
  email: { type: DataTypes.STRING(150), allowNull: true, validate: { isEmail: { msg: 'Customer email is not a valid address' } } },
  address: { type: DataTypes.TEXT, allowNull: true },
  totalPurchase: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  dueAmount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 }
}, { tableName: 'customers' });

module.exports = Customer;
