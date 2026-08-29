/**
 * Product image storage on Cloudinary.
 *
 * Images used to be written to local disk (lost on every redeploy) and then to
 * a MEDIUMBLOB column (durable, but it spends the free database tier's ~1 GB on
 * pixels that crowd out the inventory data, and turns every <img> into a
 * database round trip through a serverless function).
 *
 * Cloudinary stores the bytes and serves them straight from its own CDN, so a
 * page full of product photos never touches the database or the API at all.
 *
 * Configuration is a single variable, CLOUDINARY_URL, in the form
 *   cloudinary://<api_key>:<api_secret>@<cloud_name>
 * which the SDK reads by itself. When it is absent — a fresh clone, CI, or a
 * developer who has not signed up — isConfigured() is false and the callers
 * fall back to the database-blob path, so the app and its tests still work
 * end to end with no external account.
 */
const FOLDER = process.env.CLOUDINARY_FOLDER || 'inventory-products';

/**
 * Validate the URL's SHAPE before the SDK ever sees it.
 *
 * `require('cloudinary')` parses CLOUDINARY_URL at import time and throws a
 * raw ERR_INVALID_URL if it is malformed — and Node puts the offending string,
 * api_key and api_secret included, straight into the error output and the
 * stack trace. So a typo in an environment variable both crashed the entire
 * API at require time and leaked the credential into the logs.
 *
 * Checking the shape here means a malformed value is reported as a malformed
 * value, by name, with nothing sensitive attached.
 */
const URL_SHAPE = /^cloudinary:\/\/[^:@/\s]+:[^:@/\s]+@[^:@/\s]+$/;

const rawUrl = (process.env.CLOUDINARY_URL || '').trim();
const hasDiscrete = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

const urlIsValid = rawUrl !== '' && URL_SHAPE.test(rawUrl);

if (rawUrl !== '' && !urlIsValid) {
  console.error(
    'CLOUDINARY_URL is set but malformed — expected ' +
    'cloudinary://<api_key>:<api_secret>@<cloud_name> ' +
    '(the "@<cloud_name>" part is the one usually missing). Value not shown.'
  );
  // Keep it away from the SDK, which would throw at import and take the API
  // down with it.
  delete process.env.CLOUDINARY_URL;
}

const { v2: cloudinary } = require('cloudinary');

const isConfigured = () => urlIsValid || hasDiscrete;

// Only the discrete-variable form needs wiring up by hand; a valid
// CLOUDINARY_URL is picked up automatically. secure: true so we never hand the
// browser an http:// URL that an https:// page would refuse as mixed content.
if (isConfigured()) {
  cloudinary.config({
    ...(urlIsValid ? {} : {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    }),
    secure: true,
  });
}

/**
 * Uploads an image buffer and returns its permanent https URL.
 *
 * The upload is capped and normalised server-side as well as in multer: a 2000px
 * bound keeps a phone camera's 12-megapixel original from becoming the thing a
 * cashier waits on, and `quality: auto` lets Cloudinary pick the format the
 * requesting browser handles best.
 */
const uploadImage = (buffer, baseName) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    {
      folder: FOLDER,
      public_id: baseName,
      resource_type: 'image',
      overwrite: false,
      transformation: [{ width: 2000, height: 2000, crop: 'limit', quality: 'auto' }],
    },
    (err, result) => (err ? reject(err) : resolve(result.secure_url))
  );
  stream.end(buffer);
});

/**
 * Recovers the public_id from a delivery URL, so a superseded image can be
 * deleted without storing a second copy of the identifier alongside it.
 *
 * A URL looks like
 *   https://res.cloudinary.com/<cloud>/image/upload/v1699999999/<folder>/<id>.png
 * Everything after "/upload/" is the id, minus an optional version segment and
 * the extension. We never request a transformed delivery URL, so there is no
 * transformation segment in between to strip.
 */
const publicIdFromUrl = (url) => {
  const m = /\/image\/upload\/(?:v\d+\/)?(.+)$/.exec(String(url || ''));
  if (!m) return null;
  return m[1].replace(/\.[a-z0-9]+$/i, '');
};

const isCloudinaryUrl = (url) => /^https?:\/\/res\.cloudinary\.com\//i.test(String(url || ''));

/** Best-effort delete. The product already points elsewhere, so a failure here
 *  costs storage, not correctness — it must never fail the request. */
const destroyImage = async (url) => {
  const publicId = publicIdFromUrl(url);
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    return true;
  } catch (err) {
    console.error('Cloudinary delete failed (image left in storage):', err.message);
    return false;
  }
};

module.exports = {
  cloudinary, isConfigured, uploadImage, destroyImage, isCloudinaryUrl, publicIdFromUrl, FOLDER,
  // Exposed so callers can tell "you never set it" from "you set it wrong" —
  // the variable itself is unset by then, to keep it away from the SDK.
  urlWasMalformed: rawUrl !== '' && !urlIsValid,
};
