/**
 * Regression tests for the report timezone boundary.
 *
 * The bug these pin down: report windows are built as JavaScript Date objects
 * and passed to SQL as replacements, where the driver renders them using the
 * PROCESS timezone rather than the connection timezone. On a Bangladesh laptop
 * that matched the stored BST wall-clock values by accident; on Vercel, which
 * runs UTC, "today" ended at 18:00 instead of midnight and the dashboard
 * silently dropped the last six hours of every trading day.
 *
 * These need no database — they assert on the boundary arithmetic and on the
 * process timezone the app pins, which is what made the two agree.
 *
 *   npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// Loading the app's env module is the thing under test: it must pin the
// timezone even when the host has already forced TZ=UTC, as serverless does.
process.env.TZ = 'UTC';
require('../config/env');

const BST_OFFSET_MS = 6 * 60 * 60 * 1000;

/** The same arithmetic reportController and saleController use. */
const bstMidnightUTC = () => {
  const nowBST = new Date(Date.now() + BST_OFFSET_MS);
  nowBST.setUTCHours(0, 0, 0, 0);
  return new Date(nowBST.getTime() - BST_OFFSET_MS);
};

/** How the driver renders a Date replacement: process-local wall clock. */
const asLocalSqlString = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

test('the app pins the process timezone even when the host forces UTC', () => {
  assert.equal(process.env.TZ, 'Asia/Dhaka');
  // Bangladesh is UTC+6 year-round; getTimezoneOffset is minutes *behind* UTC.
  assert.equal(new Date().getTimezoneOffset(), -360);
});

test('a day window renders as BST midnight-to-midnight, not 18:00', () => {
  const start = bstMidnightUTC();
  const end = new Date(start.getTime() + 86400000);

  // These are the strings that actually reach MySQL. Before the fix the end
  // boundary rendered as "... 18:00:00" and truncated the trading day.
  assert.match(asLocalSqlString(start), /^\d{4}-\d{2}-\d{2} 00:00:00$/);
  assert.match(asLocalSqlString(end), /^\d{4}-\d{2}-\d{2} 00:00:00$/);
});

test('the window spans exactly one calendar day in BST', () => {
  const start = bstMidnightUTC();
  const end = new Date(start.getTime() + 86400000);
  assert.equal(end.getTime() - start.getTime(), 86400000);
  assert.equal(start.getHours(), 0);
  assert.equal(end.getHours(), 0);
  assert.notEqual(asLocalSqlString(start).slice(0, 10), asLocalSqlString(end).slice(0, 10));
});

test('a month window starts on the 1st at BST midnight', () => {
  const nowBST = new Date(Date.now() + BST_OFFSET_MS);
  const start = new Date(Date.UTC(nowBST.getUTCFullYear(), nowBST.getUTCMonth(), 1, 0, 0, 0, 0) - BST_OFFSET_MS);
  const rendered = asLocalSqlString(start);
  assert.match(rendered, /^\d{4}-\d{2}-01 00:00:00$/);
});

test('a sale recorded late in the BST evening falls inside today', () => {
  // 20:56 BST — the exact case that production excluded, because the window
  // was ending at 18:00.
  const start = bstMidnightUTC();
  const end = new Date(start.getTime() + 86400000);
  const lateEvening = new Date(start.getTime() + (20 * 60 + 56) * 60000);

  assert.equal(lateEvening.getHours(), 20);
  assert.ok(lateEvening >= start && lateEvening < end,
    'a 20:56 BST sale must fall within the current BST day');
});
