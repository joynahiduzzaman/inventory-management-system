const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Return = sequelize.define('Return', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  returnNo:     { type: DataTypes.STRING,  allowNull: false, unique: true },
  saleId:       { type: DataTypes.INTEGER, allowNull: false },
  customerId:   { type: DataTypes.INTEGER, allowNull: true },
  userId:       { type: DataTypes.INTEGER, allowNull: true },
  totalRefund:  { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  refundMethod: {
    type: DataTypes.ENUM('cash','bkash','nagad','card','store_credit'),
    defaultValue: 'cash'
  },
  reason:    { type: DataTypes.STRING, allowNull: true },
  note:      { type: DataTypes.TEXT,   allowNull: true },
  createdAt: { type: DataTypes.DATE,   allowNull: true },
  updatedAt: { type: DataTypes.DATE,   allowNull: true },
}, {
  tableName:  'returns',
  timestamps: false   // we insert createdAt/updatedAt manually via raw SQL
});

module.exports = Return;