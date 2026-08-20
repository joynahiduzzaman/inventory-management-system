const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Supplier = sequelize.define('Supplier', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(150), allowNull: false, validate: { notEmpty: { msg: 'Supplier name is required' } } },
  phone: { type: DataTypes.STRING(20), allowNull: true },
  email: { type: DataTypes.STRING(150), allowNull: true, validate: { isEmail: { msg: 'Supplier email is not a valid address' } } },
  address: { type: DataTypes.TEXT, allowNull: true },
  company: { type: DataTypes.STRING(150), allowNull: true },
  totalPurchased: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 }
}, { tableName: 'suppliers' });

module.exports = Supplier;
