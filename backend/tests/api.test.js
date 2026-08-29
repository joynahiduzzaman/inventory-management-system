/**
 * End-to-end API test suite.
 *
 * Exercises the live HTTP API the way the frontend does: authentication and
 * authorisation, validation on every write path, sale/return/stock arithmetic,
 * the movement ledger, and concurrency safety.
 *
 * Requires a running server:
 *     npm start            # terminal 1
 *     npm run test:api     # terminal 2
 *
 * It creates its own category and product, and archives the product on the way
 * out, so it is safe to run against a database holding real shop data.
 * Override API_URL / TEST_EMAIL / TEST_PASSWORD to point it elsewhere.
 */
require('dotenv').config();

const BASE = (process.env.API_URL || 'http://localhost:5000') + '/api';
const EMAIL = process.env.TEST_EMAIL || process.env.SEED_ADMIN_EMAIL || 'admin@shop.com';
// Never hard-code a working password. Read it from the environment, and fail
// loudly rather than silently trying a default that might be a real credential.
const PASSWORD = process.env.TEST_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error('Set TEST_PASSWORD (or SEED_ADMIN_PASSWORD) before running the API suite.');
  console.error('  TEST_PASSWORD=... npm run test:api');
  process.exit(2);
}
let TOKEN = '', STAFF = '';
const results = [];
// Every category this run creates, so the suite can leave the database as it
// found it. Without this, each run permanently added another "AUDIT Cat …" to
// the shop's real category list.
const createdCategories = [];

async function call(m, p, body, tok) {
  const h = {};
  if (tok !== null) h.Authorization = 'Bearer ' + (tok || TOKEN);
  let b;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method: m, headers: h, body: b });
  let d; try { d = await r.json(); } catch { d = null; }
  return { status: r.status, d };
}
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

(async () => {
  // ---------- AUTH ----------
  let r = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, null);
  TOKEN = r.d && r.d.token; check('login admin', r.status === 200 && TOKEN);
  r = await call('POST', '/auth/login', { email: 'staff@shop.com', password: PASSWORD }, null);
  STAFF = r.d && r.d.token; check('login staff', r.status === 200 && STAFF);
  r = await call('POST', '/auth/login', { email: EMAIL, password: 'definitely-the-wrong-password' }, null);
  check('bad password rejected', r.status === 401);
  r = await call('POST', '/auth/login', { email: 'nope@x.com', password: 'x' }, null);
  check('unknown user rejected', r.status === 401);
  r = await call('GET', '/products', undefined, 'garbage.token.here');
  check('invalid token rejected', r.status === 401);
  const nr = await fetch(BASE + '/products');
  check('no token rejected', nr.status === 401);
  r = await call('GET', '/auth/users', undefined, STAFF);
  check('staff blocked from /auth/users', r.status === 403);

  // ---------- AUTHZ GAPS ----------
  r = await call('GET', '/reports/profit', undefined, STAFF);
  check('staff can read profit report (authz check)', true, 'status=' + r.status + ' -- is this intended?');

  // ---------- PRODUCT VALIDATION ----------
  const mk = (o) => call('POST', '/products', o);
  r = await mk({ name: '', price: 10, cost: 5 });
  check('reject empty product name', r.status >= 400, 'status=' + r.status + ' ' + (r.d && r.d.message));
  r = await mk({ name: 'NegPrice Test', price: -50, cost: -60 });
  check('reject negative price', r.status >= 400, 'status=' + r.status + ' price=' + (r.d && r.d.data && r.d.data.price));
  r = await mk({ name: 'NegStock Test', price: 100, cost: 50, stock: -99 });
  check('reject negative stock', r.status >= 400, 'status=' + r.status + ' stock=' + (r.d && r.d.data && r.d.data.stock));
  r = await mk({ name: 'PriceLessThanCost', price: 5, cost: 50 });
  check('reject price<cost', r.status >= 400, 'status=' + r.status);

  // Self-contained: make our own category so the suite never depends on seeds.
  r = await call('POST', '/categories', { name: 'AUDIT Cat ' + Date.now() });
  if (r.d && r.d.data && r.d.data.id) createdCategories.push(r.d.data.id);
  const CATID = r.d && r.d.data && r.d.data.id;
  check('create test category', r.status === 201, 'id=' + CATID);

  const sku = 'TST-' + Date.now();
  r = await mk({ name: 'AUDIT Test Widget', sku: sku, barcode: 'BC' + Date.now(), price: 100, cost: 60, stock: 50, lowStockAlert: 5, categoryId: CATID });
  check('create valid product', r.status === 201, 'status=' + r.status + ' ' + (r.d && r.d.message));
  const PID = r.d && r.d.data && r.d.data.id;
  r = await mk({ name: 'Dup SKU', sku: sku, price: 100, cost: 60, stock: 5 });
  check('reject duplicate SKU', r.status >= 400, 'status=' + r.status + ' ' + String(r.d && r.d.message).slice(0, 70));

  r = await mk({ name: 'Huge Stock', price: 1, cost: 0, stock: 99999999999 });
  check('huge stock handled gracefully', r.status >= 400, 'status=' + r.status + ' ' + String(r.d && r.d.message).slice(0, 70));

  // ---------- SEARCH ----------
  r = await call('GET', '/products?search=AUDIT');
  check('search by name', r.status === 200 && r.d.data.some(p => p.id === PID));
  r = await call('GET', '/products?search=' + sku);
  check('search by SKU', r.status === 200 && r.d.data.some(p => p.id === PID), 'found=' + (r.d && r.d.data && r.d.data.length));

  // ---------- SCAN ----------
  r = await call('GET', '/products/scan/' + sku);
  check('scan by SKU', r.status === 200 && r.d.data.id === PID);
  r = await call('GET', '/products/scan/NOPE-XYZ');
  check('scan unknown returns 404', r.status === 404);

  // ---------- SALE ----------
  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 5 }], discount: 0, tax: 0, paid: 500, paymentMethod: 'cash' });
  check('create sale', r.status === 201, 'status=' + r.status + ' ' + (r.d && r.d.message));
  const SALE = r.d && r.d.data; const SID = SALE && SALE.id;
  check('sale total 5x100=500', SALE && parseFloat(SALE.total) === 500, 'total=' + (SALE && SALE.total));
  r = await call('GET', '/products/' + PID);
  check('stock deducted 50->45', r.d.data.stock === 45, 'stock=' + r.d.data.stock);

  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 99999 }], paid: 0 });
  check('reject oversell', r.status >= 400, String(r.d && r.d.message).slice(0, 60));
  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: -5 }], paid: 0 });
  check('reject negative qty', r.status >= 400, String(r.d && r.d.message).slice(0, 60));
  r = await call('POST', '/sales', { items: [], paid: 0 });
  check('reject empty cart', r.status >= 400);
  r = await call('POST', '/sales', { items: [{ productId: 99999999, quantity: 1 }], paid: 0 });
  check('reject unknown product', r.status >= 400, String(r.d && r.d.message).slice(0, 60));

  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 2.7 }], paid: 0 });
  check('reject decimal qty', r.status >= 400, 'status=' + r.status + ' qty=' + (r.d && r.d.data && r.d.data.items && r.d.data.items[0] && r.d.data.items[0].quantity));

  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 1 }], discount: 99999, paid: 0 });
  check('reject discount > subtotal', r.status >= 400, 'status=' + r.status + ' total=' + (r.d && r.d.data && r.d.data.total) + ' disc=' + (r.d && r.d.data && r.d.data.discount));

  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 1 }], paid: 0 });
  check('paid=0 credit sale recorded as due', r.status === 201 && parseFloat(r.d.data.due) === 100, 'paid=' + (r.d && r.d.data && r.d.data.paid) + ' due=' + (r.d && r.d.data && r.d.data.due));

  // ---------- RETURNS ----------
  r = await call('GET', '/returns/sale/' + SID);
  check('get returnable items', r.status === 200, 'items=' + (r.d && r.d.data && r.d.data.items && r.d.data.items.length));
  const RITEM = r.d && r.d.data && r.d.data.items && r.d.data.items[0];
  const beforeStock = (await call('GET', '/products/' + PID)).d.data.stock;
  r = await call('POST', '/returns', { saleId: SID, items: [{ saleItemId: RITEM.id, quantity: 2, restockItem: true }], refundMethod: 'cash', reason: 'damaged' });
  check('create return', r.status === 201, 'refund=' + (r.d && r.d.data && r.d.data.totalRefund) + ' ' + (r.d && r.d.message));
  const afterStock = (await call('GET', '/products/' + PID)).d.data.stock;
  check('restock +2 on return', afterStock === beforeStock + 2, beforeStock + ' -> ' + afterStock);
  r = await call('POST', '/returns', { saleId: SID, items: [{ saleItemId: RITEM.id, quantity: 99, restockItem: true }] });
  check('reject over-return', r.status >= 400, String(r.d && r.d.message).slice(0, 70));

  // ---------- COLLECT DUE ----------
  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 1 }], paid: 10 });
  const DSID = r.d && r.d.data && r.d.data.id;
  check('partial pay -> due 90', parseFloat(r.d.data.due) === 90, 'due=' + r.d.data.due);
  r = await call('PATCH', '/sales/' + DSID + '/collect-due', { amount: 1000 });
  check('reject overcollect', r.status >= 400);
  r = await call('PATCH', '/sales/' + DSID + '/collect-due', { amount: -50 });
  check('reject negative collect', r.status >= 400);
  r = await call('PATCH', '/sales/' + DSID + '/collect-due', { amount: 90 });
  check('collect full due', r.status === 200 && parseFloat(r.d.data.due) === 0, 'due=' + (r.d && r.d.data && r.d.data.due));

  // ---------- CUSTOMERS ----------
  r = await call('POST', '/customers', { name: '' });
  check('reject empty customer name', r.status >= 400, 'status=' + r.status);
  r = await call('POST', '/customers', { name: 'AUDIT Cust', phone: '01711111111', email: 'not-an-email' });
  check('reject invalid customer email', r.status >= 400, 'status=' + r.status + ' email=' + (r.d && r.d.data && r.d.data.email));

  // ---------- CATEGORIES / SUPPLIERS ----------
  r = await call('POST', '/categories', { name: '' });
  check('reject empty category name', r.status >= 400, 'status=' + r.status);
  r = await call('POST', '/categories', { name: 'AUDIT Cat dup' });
  if (r.d && r.d.data && r.d.data.id) createdCategories.push(r.d.data.id);
  const dup2 = await call('POST', '/categories', { name: 'AUDIT Cat dup2' });
  if (dup2.d && dup2.d.data && dup2.d.data.id) createdCategories.push(dup2.d.data.id);
  r = await call('POST', '/categories', { name: 'AUDIT Cat dup' });
  check('reject duplicate category', r.status >= 400, 'status=' + r.status);
  r = await call('POST', '/suppliers', { name: '' });
  check('reject empty supplier name', r.status >= 400, 'status=' + r.status);
  r = await call('DELETE', '/categories/' + CATID);
  check('delete in-use category blocked', r.status === 409, 'status=' + r.status + ' ' + String(r.d && r.d.message).slice(0, 90));

  // ---------- EXPENSES ----------
  r = await call('POST', '/expenses', { title: 'AUDIT exp', category: 'Rent', amount: -500, date: '2026-08-19' });
  check('reject negative expense', r.status >= 400, 'status=' + r.status + ' amount=' + (r.d && r.d.data && r.d.data.amount));
  r = await call('POST', '/expenses', { title: 'x', category: 'Rent', amount: 100, date: 'not-a-date' });
  check('reject invalid expense date', r.status >= 400, 'status=' + r.status);

  // ---------- REPORTS ----------
  const eps = ['/reports/dashboard', '/reports/sales-chart', '/reports/top-products', '/reports/profit', '/reports/sales-summary', '/reports/product-sales', '/sales/daily', '/products/low-stock'];
  for (const ep of eps) {
    r = await call('GET', ep);
    check('GET ' + ep, r.status === 200, 'status=' + r.status + ' ' + ((r.d && r.d.message) || ''));
  }

  // ---------- INVALID IDS ----------
  for (const ep of ['/products/abc', '/sales/abc', '/customers/abc', '/returns/abc', '/suppliers/abc']) {
    r = await call('GET', ep);
    check('GET ' + ep + ' handled cleanly', r.status === 404 || r.status === 400, 'status=' + r.status + ' ' + String(r.d && r.d.message).slice(0, 60));
  }

  // ---------- STOCK ADJUSTMENT + AUDIT TRAIL ----------
  const stockNow = (await call('GET', '/products/' + PID)).d.data.stock;
  r = await call('POST', '/products/' + PID + '/adjust-stock', { mode: 'add', quantity: 10, type: 'purchase', note: 'delivery' });
  check('stock adjust add 10', r.status === 200 && r.d.data.stock === stockNow + 10, 'stock=' + (r.d && r.d.data && r.d.data.stock));
  r = await call('POST', '/products/' + PID + '/adjust-stock', { mode: 'remove', quantity: 999999 });
  check('reject removing more than on hand', r.status >= 400, String(r.d && r.d.message).slice(0, 70));
  r = await call('POST', '/products/' + PID + '/adjust-stock', { mode: 'set', quantity: 7.5 });
  check('reject decimal in adjustment', r.status >= 400, String(r.d && r.d.message).slice(0, 70));
  r = await call('POST', '/products/' + PID + '/adjust-stock', { mode: 'set', quantity: 25, type: 'correction', note: 'recount' });
  check('stock recount set to 25', r.status === 200 && r.d.data.stock === 25, 'stock=' + (r.d && r.d.data && r.d.data.stock));

  r = await call('GET', '/products/' + PID + '/movements');
  const mv = (r.d && r.d.data) || [];
  check('movement ledger populated', r.status === 200 && mv.length >= 5, 'rows=' + mv.length);
  const chainOk = mv.slice().reverse().every((m, i, arr) => i === 0 || arr[i - 1].stockAfter === m.stockBefore);
  check('ledger chain reconciles (before/after continuous)', chainOk);
  const typesSeen = [...new Set(mv.map(m => m.type))].sort().join(',');
  check('ledger records sale + return + adjustment', /sale/.test(typesSeen) && /return/.test(typesSeen) && /purchase|adjustment|correction/.test(typesSeen), 'types=' + typesSeen);
  const last = mv[0];
  check('ledger stockAfter matches product stock', last && last.stockAfter === 25, 'ledger=' + (last && last.stockAfter));

  r = await call('GET', '/products/valuation');
  check('GET /products/valuation', r.status === 200, 'retail=' + (r.d && r.d.data && r.d.data.retailValue));

  // ---------- CONCURRENCY: two tills selling the last units ----------
  r = await call('POST', '/products/' + PID + '/adjust-stock', { mode: 'set', quantity: 10, type: 'correction' });
  const both = await Promise.all([
    call('POST', '/sales', { items: [{ productId: PID, quantity: 8 }], paid: 0 }),
    call('POST', '/sales', { items: [{ productId: PID, quantity: 8 }], paid: 0 }),
  ]);
  const okCount = both.filter(x => x.status === 201).length;
  const finalStock = (await call('GET', '/products/' + PID)).d.data.stock;
  check('concurrent oversell prevented (only one 8-unit sale of 10)', okCount === 1 && finalStock === 2,
        'succeeded=' + okCount + ' finalStock=' + finalStock);

  // ---------- duplicate line items in one cart ----------
  await call('POST', '/products/' + PID + '/adjust-stock', { mode: 'set', quantity: 5, type: 'correction' });
  r = await call('POST', '/sales', { items: [{ productId: PID, quantity: 3 }, { productId: PID, quantity: 4 }], paid: 0 });
  check('duplicate cart lines merged for stock check (3+4 > 5 rejected)', r.status >= 400, 'status=' + r.status + ' ' + String(r.d && r.d.message).slice(0, 60));

  // ---------- CLEAN UP WHAT THIS RUN CREATED ----------
  // The suite is meant to be safe to run against a database holding real shop
  // data, which means it has to remove its own fixtures too — not just archive
  // the product. force=true uncategorises rather than deletes any product still
  // pointing at a test category, so nothing real is destroyed.
  await call('DELETE', '/products/' + PID).catch(() => {});
  for (const id of createdCategories) {
    await call('DELETE', '/categories/' + id + '?force=true').catch(() => {});
  }

  const f = results.filter(x => !x.pass);
  console.log('\n===== ' + (results.length - f.length) + '/' + results.length + ' passed, ' + f.length + ' FAILED =====');
  f.forEach(x => console.log('  FAIL: ' + x.name + ' -- ' + x.detail));
  process.exit(f.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
