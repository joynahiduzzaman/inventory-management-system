const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Sale = sequelize.define('Sale', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  invoiceNo: { type: DataTypes.STRING(50), unique: true, allowNull: false },
  customerId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'customers', key: 'id' } },
  userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  // The resolved taka amount, and the single authority for every money
  // calculation that touches a discount — refunds, reports, receipts.
  discount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  // What was actually agreed at the counter. Provenance, never arithmetic:
  // recomputing a total from the rate disagrees with what the customer paid on
  // ~6% of sales, because the sale rounds at the discount and a recomputation
  // rounds at the total. See README "Money and rounding".
  discountMode: { type: DataTypes.ENUM('flat', 'percent'), defaultValue: 'flat' },
  discountRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  tax: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  paid: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  due: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  paymentMethod: { type: DataTypes.ENUM('cash', 'bkash', 'nagad', 'card'), defaultValue: 'cash' },
  status: { type: DataTypes.ENUM('completed', 'pending', 'cancelled'), defaultValue: 'completed' },
  note: { type: DataTypes.TEXT, allowNull: true }
}, { tableName: 'sales' });

module.exports = Sale;
