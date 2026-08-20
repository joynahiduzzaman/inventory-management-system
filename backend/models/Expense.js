const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Expense = sequelize.define('Expense', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: { msg: 'Expense title is required' } } },
  category: { type: DataTypes.STRING(100), allowNull: false, validate: { notEmpty: { msg: 'Expense category is required' } } },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, validate: { min: { args: [0.01], msg: 'Expense amount must be greater than zero' } } },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  note: { type: DataTypes.TEXT, allowNull: true },
  userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } }
}, { tableName: 'expenses' });

module.exports = Expense;
