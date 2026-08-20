/**
 * validate.js — server-side input validation helpers.
 *
 * Frontend validation is a convenience; these are the rules that actually
 * protect the data. Every controller that writes money or stock uses them.
 *
 * Throws ValidationError, which the controllers translate into HTTP 400 with a
 * human-readable message (no raw SQL/Sequelize text ever reaches the user).
 */

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.field = field;
  }
}

/** Required non-empty string, trimmed. */
const reqString = (value, label, { max = 255, min = 1 } = {}) => {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (s.length < min) throw new ValidationError(`${label} is required`, label);
  if (s.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`, label);
  return s;
};

/** Optional string — empty/blank becomes null so UNIQUE columns don't collide. */
const optString = (value, label, { max = 255 } = {}) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (s.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`, label);
  return s;
};

/** Money: finite, >= 0, at most 2 decimals, within DECIMAL(12,2) range. */
const money = (value, label, { required = false, max = 9999999999.99 } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${label} is required`, label);
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a valid number`, label);
  if (n < 0) throw new ValidationError(`${label} cannot be negative`, label);
  if (n > max) throw new ValidationError(`${label} is too large`, label);
  return Math.round(n * 100) / 100;
};

/** Whole, non-negative count. Rejects decimals outright rather than rounding. */
const count = (value, label, { required = false, max = 2147483647, min = 0 } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${label} is required`, label);
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a valid number`, label);
  if (!Number.isInteger(n)) {
    throw new ValidationError(`${label} must be a whole number — "${value}" has a decimal part`, label);
  }
  if (n < min) throw new ValidationError(`${label} cannot be less than ${min}`, label);
  if (n > max) throw new ValidationError(`${label} is too large (max ${max})`, label);
  return n;
};

/** Optional integer foreign key; '' / null / undefined → null. */
const optId = (value, label) => {
  if (value === undefined || value === null || value === '' || value === 'null') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${label} is not a valid selection`, label);
  return n;
};

/** Required integer id (route params, body references). */
const reqId = (value, label) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${label} is not a valid id`, label);
  return n;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const optEmail = (value, label = 'Email') => {
  const s = optString(value, label, { max: 150 });
  if (s === null) return null;
  if (!EMAIL_RE.test(s)) throw new ValidationError(`${label} "${s}" is not a valid email address`, label);
  return s.toLowerCase();
};

const reqEmail = (value, label = 'Email') => {
  const s = reqString(value, label, { max: 150 });
  if (!EMAIL_RE.test(s)) throw new ValidationError(`${label} "${s}" is not a valid email address`, label);
  return s.toLowerCase();
};

/** Phone: digits, spaces and + - ( ) only. Optional. */
const optPhone = (value, label = 'Phone') => {
  const s = optString(value, label, { max: 20 });
  if (s === null) return null;
  if (!/^[+\d][\d\s\-()]{4,19}$/.test(s)) {
    throw new ValidationError(`${label} "${s}" is not a valid phone number`, label);
  }
  return s;
};

/** YYYY-MM-DD, and a date that actually exists. */
const dateOnly = (value, label = 'Date', { required = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${label} is required`, label);
    return null;
  }
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`${label} must be in YYYY-MM-DD format`, label);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ValidationError(`${label} "${s}" is not a real date`, label);
  }
  return s;
};

/** Value must be one of a fixed set. */
const oneOf = (value, allowed, label, fallback) => {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${label} is required`, label);
  }
  const s = String(value);
  if (!allowed.includes(s)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`, label);
  }
  return s;
};

/** Wraps a controller so ValidationError → 400 and anything else → 500. */
const handle = (res, err, fallbackMessage = 'Something went wrong') => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ success: false, message: err.message, field: err.field });
  }
  if (err && err.name === 'SequelizeUniqueConstraintError') {
    const field = err.errors && err.errors[0] && err.errors[0].path;
    const pretty = { sku: 'SKU', barcode: 'Barcode', qrCode: 'QR code', email: 'Email', name: 'Name', invoiceNo: 'Invoice number' }[field] || field || 'value';
    return res.status(409).json({ success: false, message: `That ${pretty} is already in use`, field });
  }
  if (err && err.name === 'SequelizeValidationError') {
    return res.status(400).json({ success: false, message: err.errors.map(e => e.message).join('; ') });
  }
  if (err && err.name === 'SequelizeForeignKeyConstraintError') {
    // Distinguish "you picked something that no longer exists" (the common
    // case on create/update) from "other rows still point at this one".
    const f = (err.fields && (Array.isArray(err.fields) ? err.fields[0] : Object.keys(err.fields)[0])) || '';
    const label = { categoryId: 'category', supplierId: 'supplier', customerId: 'customer', productId: 'product', userId: 'user' }[f];
    if (label) {
      return res.status(400).json({
        success: false,
        message: `The selected ${label} no longer exists — refresh and choose another`,
        field: f,
      });
    }
    return res.status(409).json({ success: false, message: 'That record is still referenced by other data and cannot be changed' });
  }
  console.error(`${fallbackMessage}:`, err);
  return res.status(500).json({ success: false, message: fallbackMessage });
};

module.exports = {
  ValidationError,
  reqString, optString, money, count, optId, reqId,
  optEmail, reqEmail, optPhone, dateOnly, oneOf, handle,
};
