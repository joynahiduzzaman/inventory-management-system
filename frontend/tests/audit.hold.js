/**
 * Hold and recall a parked sale.
 *
 *   node tests/audit.hold.js [baseUrl]
 *
 * The three things that make this feature safe rather than merely present:
 *
 *   1. a held cart reserves NO stock, so the shop can sell the same goods
 *      while it is parked — and the cashier must be told at recall, not at
 *      Complete Sale
 *   2. two terminals recalling the same cart: exactly one wins, and the other
 *      is told who took it
 *   3. a recalled cart can be put back, because the common mistake is
 *      recalling the wrong one with a queue waiting
 *
 * Visual assertions use elementFromPoint, not "does the element exist".
 * Creates AUDIT HOLD ... fixtures for `npm run purge:test`.
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

const PAINT = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { present: true, painted: false };
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return {
    present: true,
    painted: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
    text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 90),
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
  const mk = async (tag, price, stock) => (await call('POST', '/products', {
    name: `AUDIT HOLD ${tag} ${stamp}`, sku: `AUDHOLD-${tag}-${stamp}`, barcode: `AUDHOLD-${tag}-${stamp}`,
    price, cost: 5, stock, lowStockAlert: 2,
  })).d.data;
  const P = await mk('Main', 25, 10);

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
    await new Promise((r) => setTimeout(r, 1600));
  };
  const rows = () => page.evaluate(() => document.querySelectorAll('[data-cart-row]').length);

  // ══ PARK A CART ═════════════════════════════════════════════════════════
  console.log('\n── Holding ────────────────────────────────────────────────');
  await gotoPos();
  await scan(P.sku);
  await scan(P.sku);
  check('a cart is built', (await rows()) === 1, `${await rows()} row(s)`);

  const holdBtn = await page.evaluate(PAINT, '#pos-hold');
  check('the hold control is on the till', holdBtn.present && holdBtn.painted, holdBtn.text);

  // F6, the way the shop's cashiers already work.
  await page.keyboard.press('F6');
  await new Promise((r) => setTimeout(r, 2200));
  check('F6 parks the cart and clears the screen', (await rows()) === 0, `${await rows()} row(s) left`);

  const badge = await page.evaluate(PAINT, '.pos-hold-badge');
  check('  and the recall badge shows one waiting', badge.present && badge.painted, badge.text);

  // ══ STOCK IS NOT RESERVED ═══════════════════════════════════════════════
  console.log('\n── A held cart reserves no stock ──────────────────────────');
  const live = (await call('GET', `/products/${P.id}`)).d.data;
  check('stock is untouched while the cart is parked', live.stock === 10, `stock=${live.stock}`);

  // The shop sells the same goods down to 1 while the cart sits parked.
  await call('PUT', `/products/${P.id}`, {
    name: live.name, sku: live.sku, price: 30, cost: 5, stock: 1, lowStockAlert: 2,
  });

  // ══ RECALL SURFACES WHAT CHANGED ════════════════════════════════════════
  console.log('\n── Recall ────────────────────────────────────────────────');
  await gotoPos();
  await page.keyboard.press('F7');
  await new Promise((r) => setTimeout(r, 1800));
  const list = await page.evaluate(PAINT, '.pos-recall');
  check('F7 opens the list of parked sales', list.present && list.painted, list.text.slice(0, 60));
  const rowInfo = await page.evaluate(PAINT, '.pos-hold-row');
  check('  a parked cart is identifiable — number, items, total, time',
    /HOLD-/.test(rowInfo.text || '') && /৳/.test(rowInfo.text || ''), rowInfo.text);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.pos-hold-row .ui-btn--primary')][0];
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  check('recalling restores the cart', (await rows()) === 1, `${await rows()} row(s)`);

  const issues = await page.evaluate(PAINT, '.pos-recall-issues');
  // PAINT truncates for readable output; the panel lists one line per change,
  // so read it in full before asserting on what it contains.
  const issuesFull = await page.evaluate(() => {
    const el = document.querySelector('.pos-recall-issues');
    return el ? el.innerText.replace(/\s+/g, ' ') : '';
  });
  check('what changed while it was parked is shown, not discovered at checkout',
    issues.present && issues.painted, issues.text);
  check('  it names the shortfall (2 wanted, 1 in stock)',
    /2/.test(issuesFull) && /1/.test(issuesFull), issuesFull.slice(0, 110));
  check('  and the price change (৳25 → ৳30)',
    /25/.test(issuesFull) && /30/.test(issuesFull), issuesFull.slice(-110));

  const price = await page.evaluate(() => {
    const el = document.querySelector('[data-cart-row] .pos-line-total');
    return el ? el.textContent : '';
  });
  check('the cart is priced from the LIVE product, not the snapshot',
    /60/.test(price), `line total ${price}`);

  // ══ TWO TERMINALS ═══════════════════════════════════════════════════════
  console.log('\n── Two terminals, one cart ───────────────────────────────');
  const second = (await call('POST', '/holds', {
    items: [{ productId: P.id, quantity: 1 }], note: 'contention',
  })).d.data;
  const first = await call('POST', `/holds/${second.id}/recall`);
  const clash = await call('POST', `/holds/${second.id}/recall`);
  check('the first terminal gets the cart', first.status === 200, `status ${first.status}`);
  check('the second is refused, not given a duplicate', clash.status === 409, `status ${clash.status}`);
  check('  and is told who took it and when',
    /recalled that sale first/i.test(clash.d.message || '') && !!clash.d.data.recalledAt,
    clash.d.message);

  // ══ PUT IT BACK ═════════════════════════════════════════════════════════
  console.log('\n── Restoring a wrongly recalled cart ─────────────────────');
  const back = await call('POST', `/holds/${second.id}/restore`);
  check('a recalled cart can be put back', back.status === 200, JSON.stringify(back.d.data));
  const again = await call('POST', `/holds/${second.id}/recall`);
  check('  and is then recallable again', again.status === 200, `status ${again.status}`);

  // A completed sale must never be restorable, or it would duplicate.
  await call('POST', `/holds/${second.id}/complete`, { saleId: null });
  const afterDone = await call('POST', `/holds/${second.id}/restore`);
  check('a cart that became a sale can NOT be put back', afterDone.status === 409, afterDone.d.message);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e.message); process.exit(1); });
