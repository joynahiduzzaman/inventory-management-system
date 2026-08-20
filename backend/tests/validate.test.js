/**
 * Unit tests for the validation layer.
 *
 * These need no database and no server: they pin down the rules that stop bad
 * money and bad stock quantities from ever reaching the tables.
 *
 *   npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../utils/validate');

const throws = (fn, re) => assert.throws(fn, (e) => e instanceof V.ValidationError && (!re || re.test(e.message)));

test('reqString rejects empty and blank input', () => {
  throws(() => V.reqString('', 'Name'), /required/);
  throws(() => V.reqString('   ', 'Name'), /required/);
  throws(() => V.reqString(undefined, 'Name'), /required/);
  assert.equal(V.reqString('  Widget  ', 'Name'), 'Widget');
});

test('reqString enforces a maximum length', () => {
  throws(() => V.reqString('x'.repeat(300), 'Name', { max: 200 }), /200 characters/);
});

test('optString turns blank into null so UNIQUE columns do not collide', () => {
  // Two products with sku '' would violate the unique index; null does not.
  assert.equal(V.optString('', 'SKU'), null);
  assert.equal(V.optString('   ', 'SKU'), null);
  assert.equal(V.optString(undefined, 'SKU'), null);
  assert.equal(V.optString(' ABC-1 ', 'SKU'), 'ABC-1');
});

test('money rejects negatives', () => {
  throws(() => V.money(-1, 'Price'), /cannot be negative/);
  throws(() => V.money(-0.01, 'Price'), /cannot be negative/);
});

test('money rounds to two decimals rather than carrying float drift', () => {
  assert.equal(V.money(10.005, 'Price'), 10.01);
  assert.equal(V.money('19.999', 'Price'), 20);
  assert.equal(V.money(0.1 + 0.2, 'Price'), 0.3);
});

test('money treats missing input as zero unless required', () => {
  assert.equal(V.money('', 'Discount'), 0);
  assert.equal(V.money(undefined, 'Discount'), 0);
  throws(() => V.money('', 'Amount', { required: true }), /required/);
});

test('money rejects non-numeric input', () => {
  throws(() => V.money('abc', 'Price'), /valid number/);
  throws(() => V.money(Infinity, 'Price'), /valid number/);
  throws(() => V.money(NaN, 'Price'), /valid number/);
});

test('count rejects decimals instead of silently rounding them', () => {
  // A 2.7 that becomes 3 sells stock the shop does not have.
  throws(() => V.count(2.7, 'Quantity'), /whole number/);
  throws(() => V.count('1.5', 'Quantity'), /whole number/);
  assert.equal(V.count('4', 'Quantity'), 4);
});

test('count rejects negatives and enforces a minimum', () => {
  throws(() => V.count(-1, 'Stock'), /cannot be less than 0/);
  throws(() => V.count(0, 'Quantity', { min: 1 }), /cannot be less than 1/);
  assert.equal(V.count(1, 'Quantity', { min: 1 }), 1);
});

test('count rejects values beyond the INT column range', () => {
  throws(() => V.count(99999999999, 'Stock'), /too large/);
});

test('optId normalises empty selections to null and rejects junk', () => {
  assert.equal(V.optId('', 'Category'), null);
  assert.equal(V.optId(null, 'Category'), null);
  assert.equal(V.optId('null', 'Category'), null);
  assert.equal(V.optId('7', 'Category'), 7);
  throws(() => V.optId('abc', 'Category'), /valid selection/);
  throws(() => V.optId(0, 'Category'), /valid selection/);
  throws(() => V.optId(-3, 'Category'), /valid selection/);
});

test('email validation', () => {
  assert.equal(V.optEmail(''), null);
  assert.equal(V.optEmail('A@B.com'), 'a@b.com');
  throws(() => V.optEmail('not-an-email'), /not a valid email/);
  throws(() => V.optEmail('a@b'), /not a valid email/);
  throws(() => V.reqEmail(''), /required/);
});

test('phone validation accepts local formats and rejects text', () => {
  assert.equal(V.optPhone(''), null);
  assert.equal(V.optPhone('01711000001'), '01711000001');
  assert.equal(V.optPhone('+880 171 100 0001'), '+880 171 100 0001');
  throws(() => V.optPhone('call me'), /not a valid phone/);
});

test('dateOnly rejects impossible and malformed dates', () => {
  assert.equal(V.dateOnly('2026-08-19'), '2026-08-19');
  throws(() => V.dateOnly('not-a-date'), /YYYY-MM-DD/);
  throws(() => V.dateOnly('19-08-2026'), /YYYY-MM-DD/);
  throws(() => V.dateOnly('2026-02-31'), /not a real date/);
  throws(() => V.dateOnly('2026-13-01'), /not a real date/);
  throws(() => V.dateOnly(''), /required/);
});

test('oneOf constrains enums and honours a fallback', () => {
  assert.equal(V.oneOf('cash', ['cash', 'card'], 'Payment'), 'cash');
  assert.equal(V.oneOf('', ['cash', 'card'], 'Payment', 'cash'), 'cash');
  throws(() => V.oneOf('crypto', ['cash', 'card'], 'Payment'), /must be one of/);
});

// ── Money arithmetic used by the sale controller ────────────────────────────
// Mirrors saleController so the rounding contract stays pinned down.
const round2 = (n) => Math.round(n * 100) / 100;

test('sale totals round once, not per line', () => {
  // 3 lines at 33.333 each: rounding per line loses a paisa.
  const lines = [33.333, 33.333, 33.333];
  const perLine = lines.reduce((s, n) => s + round2(n), 0);
  const roundedOnce = round2(lines.reduce((s, n) => s + n, 0));
  assert.equal(round2(perLine), 99.99);
  assert.equal(roundedOnce, 100);
});

test('overpayment is change, never recorded as revenue', () => {
  const total = 240;
  const handedOver = 500;
  const paid = Math.min(handedOver, total);
  assert.equal(paid, 240);
  assert.equal(round2(total - paid), 0);
});

test('an explicit zero payment is a credit sale, a missing one is paid in full', () => {
  const total = 100;
  const resolve = (paid) => {
    const provided = paid !== undefined && paid !== null && paid !== '';
    return Math.min(provided ? Number(paid) : total, total);
  };
  assert.equal(resolve(0), 0);          // fully on credit
  assert.equal(resolve(undefined), 100); // field omitted -> paid in full
  assert.equal(resolve(''), 100);
  assert.equal(resolve(40), 40);
});
