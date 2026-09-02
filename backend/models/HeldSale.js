const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A parked sale.
 *
 * A customer walks off to fetch their wallet while four people wait; the
 * cashier parks that cart, serves the queue, and brings it back.
 *
 * Held carts deliberately do NOT reserve stock. Reserving would let an
 * abandoned cart make goods unsellable, which is worse than the problem it
 * solves — so a recall rebuilds the cart from live products and reports what
 * has changed since. Nothing here is a promise about inventory.
 *
 * `itemCount` and `total` are denormalised so the recall list can identify a
 * cart without joining its lines. They are display only; the lines are the
 * truth, and the total is recomputed from live prices on recall anyway.
 */
const HeldSale = sequelize.define('HeldSale', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  holdNo:     { type: DataTypes.STRING(50), unique: true, allowNull: false },
  userId:     { type: DataTypes.INTEGER, allowNull: true },
  customerId: { type: DataTypes.INTEGER, allowNull: true },
  note:       { type: DataTypes.STRING(255), allowNull: true },

  // The discount as it stood when parked, so recall restores the same intent.
  discount:     { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  discountMode: { type: DataTypes.ENUM('flat', 'percent'), defaultValue: 'flat' },
  discountRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true },

  itemCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  total:     { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },

  // held      → parked, anybody may recall it
  // recalled  → somebody has it open; restorable, because the common mistake
  //             is recalling the wrong cart with a queue waiting
  // completed → became a sale; must never be restored or it would duplicate
  // expired   → passed its 4am boundary (see config/holds.js)
  // cancelled → discarded on purpose
  status: {
    type: DataTypes.ENUM('held', 'recalled', 'completed', 'expired', 'cancelled'),
    defaultValue: 'held',
  },
  recalledBy: { type: DataTypes.INTEGER, allowNull: true },
  recalledAt: { type: DataTypes.DATE, allowNull: true },
  saleId:     { type: DataTypes.INTEGER, allowNull: true },   // set when completed
}, { tableName: 'held_sales' });

module.exports = HeldSale;
