const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Uploaded product images, stored as rows rather than files.
 *
 * The product form has always written to `backend/uploads/`, which is fine on a
 * laptop and useless on any host with an ephemeral or read-only filesystem —
 * the image vanishes on the next deploy, and every product silently loses its
 * picture. Keeping the bytes in the database means an image is exactly as
 * durable as the product row that references it, on every host, with no object
 * store to pay for.
 *
 * `filename` is the same generated name that used to be written to disk, so
 * products keep pointing at "/uploads/<filename>" and nothing downstream —
 * the API contract, the frontend, existing rows — had to change.
 */
const ProductImage = sequelize.define('ProductImage', {
  id:       { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  filename: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  mimeType: { type: DataTypes.STRING(100), allowNull: false },
  size:     { type: DataTypes.INTEGER, allowNull: false },
  // MEDIUMBLOB holds 16 MB; uploads are capped far below that in upload.js.
  data:     { type: 'MEDIUMBLOB', allowNull: false },
}, {
  tableName: 'product_images',
  updatedAt: false,
});

module.exports = ProductImage;
