const multer = require('multer');
const path = require('path');

/**
 * Product image upload.
 *
 * Files are held in memory and written to the database by the product
 * controller, inside the same transaction as the product row. Two things fall
 * out of that which disk storage could not give us:
 *
 *   - the image survives on hosts with no writable disk (serverless, and any
 *     free container tier with an ephemeral filesystem);
 *   - a rolled-back product create leaves no orphaned file behind, because
 *     there was never a file — the image write rolls back with it.
 */

// 3 MB. Product thumbnails never need more, and the cap keeps a single row
// well inside both MEDIUMBLOB and the body limits of a serverless platform.
const MAX_BYTES = 3 * 1024 * 1024;

const ALLOWED = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const expected = ALLOWED[ext];
  // Extension and declared type must agree — a .png claiming to be a PDF, or a
  // .exe renamed to .png, is rejected rather than stored.
  if (expected && file.mimetype === expected) return cb(null, true);
  cb(new Error('Only image files are allowed (jpg, png, gif, webp)'));
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter,
});

/** Generates the stored name for an upload — kept identical to the old scheme
 *  so "/uploads/<name>" URLs written by earlier releases still resolve. */
const storedName = (originalname) =>
  `product-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(originalname || '').toLowerCase()}`;

// Wrapper that turns multer errors into a clean 400 instead of a 500.
const uploadMiddleware = (field) => (req, res, next) => {
  upload.single(field)(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Image is too large — maximum ${MAX_BYTES / 1024 / 1024} MB`
        : err.message;
      return res.status(400).json({ success: false, message });
    }
    next();
  });
};

module.exports = uploadMiddleware;
module.exports.storedName = storedName;
module.exports.MAX_BYTES = MAX_BYTES;
