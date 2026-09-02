const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A line on a parked sale.
 *
 * `heldPrice` and `heldName` are a snapshot, kept for one purpose only: to
 * tell the cashier on recall that something changed. They are never used to
 * price the sale — recall rebuilds from the live product, because the shop's
 * price is the shop's price and a cart parked yesterday must not sell at
 * yesterday's.
 */
const HeldSaleItem = sequelize.define('HeldSaleItem', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  heldSaleId: { type: DataTypes.INTEGER, allowNull: false },
  productId:  { type: DataTypes.INTEGER, allowNull: false },
  quantity:   { type: DataTypes.INTEGER, defaultValue: 1 },
  heldPrice:  { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  heldName:   { type: DataTypes.STRING, allowNull: true },
}, { tableName: 'held_sale_items', timestamps: false });

module.exports = HeldSaleItem;
