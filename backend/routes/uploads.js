const express = require('express');
const router = express.Router();
const { ProductImage } = require('../models');

/**
 * Serves product images out of the database.
 *
 * Mounted at /uploads *behind* express.static, so a file still sitting on disk
 * from an older release wins and nothing that used to work stops working.
 *
 * Deliberately public, like the static mount it backs: an <img> tag cannot send
 * an Authorization header, and these are product photos on a shop's own
 * catalogue, not private documents. Names are unguessable (timestamp + random).
 */
router.get('/:filename', async (req, res, next) => {
  try {
    // Path traversal has no purchase here — the name is an exact-match column
    // lookup, not a filesystem path — but reject anything path-shaped anyway so
    // the intent is explicit rather than incidental.
    const filename = req.params.filename;
    if (!/^[\w.-]{1,255}$/.test(filename)) return next();

    const image = await ProductImage.findOne({ where: { filename } });
    if (!image) return next();

    res.set('Content-Type', image.mimeType);
    res.set('Content-Length', String(image.size));
    // Stored names are unique per upload and never rewritten, so the bytes at a
    // given URL can never change — cache them hard.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
