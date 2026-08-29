/**
 * imagesToCloudinary.js — moves product images out of the database.
 *
 *   node scripts/imagesToCloudinary.js --dry-run   # report what would move
 *   node scripts/imagesToCloudinary.js             # upload and repoint
 *
 * Earlier releases stored uploaded photos as MEDIUMBLOB rows in
 * `product_images`, with products pointing at "/uploads/<filename>". Those
 * bytes should not travel to a free managed database, where they would spend
 * the storage cap on pixels and turn every <img> into a query.
 *
 * For each product still pointing at a local path this uploads the bytes to
 * Cloudinary and rewrites products.image to the delivery URL. Run it BEFORE
 * migrating data to production, so nothing blob-shaped is copied across.
 *
 * Safety:
 *   - The blob row is deleted only after the product row has been repointed,
 *     so an interrupted run leaves the image reachable, never dangling.
 *   - Re-running is harmless: products already on an https URL are skipped.
 *   - Images on disk from the oldest releases are picked up too.
 */
require('../config/env');
const fs   = require('fs');
const path = require('path');
const CDN  = require('../config/cloudinary');
const { sequelize, Product, ProductImage } = require('../models');

const DRY_RUN = process.argv.includes('--dry-run');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');

(async () => {
  if (!CDN.isConfigured()) {
    console.error('❌ Cloudinary is not configured.');
    console.error('   Add CLOUDINARY_URL to backend/.env, then run again:');
    console.error('   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>');
    process.exit(1);
  }

  await sequelize.authenticate();

  // Archived products are included deliberately. Archiving is reversible here
  // (PATCH /products/:id/restore) and sales history still shows the item, so
  // leaving their images behind would quietly break every restored product and
  // every historical invoice that displays a picture.
  const products = await Product.findAll({ attributes: ['id', 'name', 'image', 'isActive'] });

  const pending  = products.filter(p => p.image && p.image.startsWith('/uploads/'));
  const already  = products.filter(p => p.image && CDN.isCloudinaryUrl(p.image)).length;
  const archived = pending.filter(p => !p.isActive).length;

  console.log(`${products.length} products — ${pending.length} to move ` +
              `(${pending.length - archived} active, ${archived} archived), ` +
              `${already} already on Cloudinary\n`);

  if (DRY_RUN) {
    pending.forEach(p => console.log(
      `  would move  #${p.id}${p.isActive ? '' : ' (archived)'}  ${p.name}  ${p.image}`));
    await sequelize.close();
    return;
  }

  let moved = 0, missing = 0, failed = 0;

  for (const product of pending) {
    const filename = path.basename(product.image);
    try {
      // The bytes live in the database, or on disk for the oldest uploads.
      let buffer = null;
      const row = await ProductImage.findOne({ where: { filename } });
      if (row) {
        buffer = row.data;
      } else {
        const onDisk = path.join(UPLOAD_DIR, filename);
        if (fs.existsSync(onDisk)) buffer = fs.readFileSync(onDisk);
      }

      if (!buffer || !buffer.length) {
        console.log(`  ⚠ #${product.id} ${product.name} — no bytes found for ${filename}, leaving as is`);
        missing++;
        continue;
      }

      const url = await CDN.uploadImage(buffer, filename.replace(/\.[a-z0-9]+$/i, ''));

      // Repoint first, delete second: the reverse order would leave the product
      // pointing at a row that no longer exists if the process died between them.
      await product.update({ image: url });
      if (row) await row.destroy();

      console.log(`  ✅ #${product.id} ${product.name}`);
      moved++;
    } catch (err) {
      console.error(`  ❌ #${product.id} ${product.name} — ${err.message}`);
      failed++;
    }
  }

  const [{ n: blobsLeft }] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM product_images', { type: sequelize.QueryTypes.SELECT }
  );

  console.log(`\nmoved ${moved}, missing bytes ${missing}, failed ${failed}`);
  console.log(`image blobs left in the database: ${blobsLeft}`);
  await sequelize.close();
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Migration failed:', err); process.exit(1); });
