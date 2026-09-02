/**
 * Counter workflow features, verified by what is painted and what happens.
 *
 *   node tests/audit.till.js [baseUrl]
 *
 * Modelled on a real till (CloudPOS, as run daily at Apon Family Mart):
 * confirm before finalising, change shown large on its own, remaining stock in
 * the scan confirmation, and reprint always to hand.
 *
 * Every visual assertion uses elementFromPoint rather than "does the element
 * exist" — the lesson from a fade that was correct in code and invisible on
 * screen for two rounds of fixes.
 *
 * Creates its own fixtures (AUDIT TILL ...) for `npm run purge:test`.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(
  'C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL',
  '97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core'
));

const WEB = process.argv[2] || 'http://localhost:3000';
const API = process.env.AUDIT_API || 'http://localhost:5000/api';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '..', 'backend', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${n}${d ? '  — ' + d : ''}`);
};

/** Painted means: reachable at its centre point, and not zero-sized. */
const PAINT = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { present: true, painted: false, why: 'zero size' };
  const hit = document.elementFromPoint(
    Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)
  );
  return {
    present: true,
    painted: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
    text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
    fontPx: Math.round(parseFloat(getComputedStyle(el).fontSize)),
    w: Math.round(r.width), h: Math.round(r.height),
  };
};

(async () => {
  let tok;
  const call = (m, u, b) => fetch(API + u, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, d: await r.json().catch(() => null) }));

  tok = (await call('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD })).d.token;
  const stamp = Date.now();
  // Exactly 3 in stock, so "second-to-last" is observable.
  const P = (await call('POST', '/products', {
    name: `AUDIT TILL W ${stamp}`, sku: `AUDTILL-${stamp}`, barcode: `AUDTILL-${stamp}`,
    price: 40, cost: 20, stock: 3, lowStockAlert: 2,
  })).d.data;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1152, height: 720 });
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.type('input[type="email"]', env.SEED_ADMIN_EMAIL);
  await page.type('input[type="password"]', env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 });

  const gotoPos = async () => {
    await page.goto(`${WEB}/pos`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('.pos-tile', { timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1800));
  };
  const scan = async (code) => {
    await page.waitForSelector('[data-scan-input="true"]', { timeout: 20000 });
    await page.evaluate((s) => { const i = document.querySelector(s); i.value = ''; i.focus(); }, '[data-scan-input="true"]');
    await page.keyboard.type(code, { delay: 6 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 1700));
  };

  // ══ 4. STOCK AT SCAN TIME ═══════════════════════════════════════════════
  console.log('\n── Stock shown at scan time ───────────────────────────────');
  await gotoPos();
  await scan(P.sku);
  let left = await page.evaluate(PAINT, '.pos-scan-left');
  check('the scan confirmation shows remaining stock', left.present && left.painted, left.text);
  check('  and it is 2 after selling one of three', /2/.test(left.text || ''), left.text);

  await scan(P.sku);
  left = await page.evaluate(PAINT, '.pos-scan-left');
  check('selling the second-to-last one says 1 left, marked low',
    /1/.test(left.text || ''), left.text);
  const lowTone = await page.evaluate(() =>
    document.querySelector('.pos-scan-left').className.includes('is-low'));
  check('  and it is styled as low stock, not as normal', lowTone);

  await scan(P.sku);
  left = await page.evaluate(PAINT, '.pos-scan-left');
  const outTone = await page.evaluate(() =>
    document.querySelector('.pos-scan-left').className.includes('is-out'));
  check('selling the last one says so, in danger colour', outTone, left.text);

  // ══ 3. CONFIRM BEFORE COMPLETING ════════════════════════════════════════
  console.log('\n── Confirm before completing ──────────────────────────────');
  await page.evaluate(() => document.getElementById('pos-checkout').click());
  await new Promise((r) => setTimeout(r, 900));
  const confirm = await page.evaluate(PAINT, '.pos-confirm');
  check('a confirmation appears before the sale is finalised',
    confirm.present && confirm.painted, confirm.text);
  const totalShown = await page.evaluate(PAINT, '.pos-confirm-total');
  check('  it shows the total', /120/.test(totalShown.text || ''), totalShown.text);

  // Nothing may have been charged yet.
  const salesBefore = (await call('GET', '/sales?page=1&limit=1')).d.data[0];
  check('  and nothing is charged until it is accepted',
    !salesBefore || !String(salesBefore.total).startsWith('120'),
    salesBefore ? `latest ${salesBefore.invoiceNo} @ ${salesBefore.total}` : 'no sales');

  // Escape cancels, cart survives.
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 700));
  const cancelled = await page.evaluate(() => !document.querySelector('.pos-confirm'));
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('[data-cart-row]').length);
  check('Escape cancels it and leaves the cart intact', cancelled && rowsAfter === 1,
    `dismissed=${cancelled} rows=${rowsAfter}`);

  // ══ 2. CHANGE, SHOWN LARGE ══════════════════════════════════════════════
  console.log('\n── Change due, shown large ────────────────────────────────');
  await page.evaluate(() => { const i = document.getElementById('pos-paid'); i.focus(); });
  await page.keyboard.type('200', { delay: 25 });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.getElementById('pos-checkout').click());
  await new Promise((r) => setTimeout(r, 800));
  // Enter accepts, so a keyboard cashier is not slowed down.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 5000));

  const chg = await page.evaluate(PAINT, '.pos-change-amt');
  check('the change is shown on its own screen', chg.present && chg.painted, chg.text);
  check('  it is ৳80.00 (৳200 tendered on a ৳120 sale)', /80/.test(chg.text || ''), chg.text);
  check('  and it is large — at least 40px', chg.fontPx >= 40, chg.fontPx + 'px');
  const tendered = await page.evaluate(PAINT, '.pos-change-tendered');
  check('  the amount tendered is shown above it', /200/.test(tendered.text || ''), tendered.text);

  // Enter dismisses, and the receipt follows.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  const gone = await page.evaluate(() => !document.querySelector('.pos-change'));
  const invoiceUp = await page.evaluate(() => !!document.querySelector('.modal-title'));
  check('Enter dismisses it and the receipt follows', gone && invoiceUp,
    `dismissed=${gone} invoice=${invoiceUp}`);

  // ══ 5. REPRINT ══════════════════════════════════════════════════════════
  console.log('\n── Reprint the last receipt ───────────────────────────────');
  await gotoPos();
  const rp = await page.evaluate(PAINT, '#pos-reprint');
  check('a reprint control is present on the till without navigating away',
    rp.present && rp.painted, rp.text);

  const printed = await page.evaluate(() => {
    window.__cap = '';
    const real = window.open;
    window.open = function () {
      return {
        document: { open() {}, close() {}, write(h) { window.__cap += h; }, fonts: null },
        addEventListener() {}, focus() {}, print() {}, close() {}, setTimeout: (fn) => fn(),
      };
    };
    document.getElementById('pos-reprint').click();
    window.open = real;
    return window.__cap;
  });
  check('  clicking it produces a receipt document', printed.length > 500, printed.length + ' bytes');
  // Assert against the invoice the button itself names, not a hard-coded
  // total: other suites add sales between this one and the reprint, and a
  // check that depends on running alone is a check that will lie eventually.
  const namedInvoice = await page.evaluate(() => {
    const el = document.querySelector('.pos-reprint-inv');
    return el ? el.textContent.trim() : '';
  });
  check('  it prints the sale it names on the button',
    !!namedInvoice && printed.includes(namedInvoice),
    `button says ${namedInvoice || '(none)'}`);
  check('  and it survives a page reload (fetched, not held in this tab)',
    rp.present, 'rendered on a fresh load of /pos');

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e.message); process.exit(1); });
