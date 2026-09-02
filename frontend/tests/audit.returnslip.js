/**
 * The refund slip, verified by what reaches the printer.
 *
 *   node tests/audit.returnslip.js
 *
 * A refund against a credit sale does two things at once: it cancels debt and
 * it hands over cash. A customer who cannot see which was which has only the
 * shopkeeper's word for it, so the split is the point of this document.
 *
 * This intercepts window.open and reads the HTML actually written to the print
 * window. Asserting that the button exists proves nothing about what it prints
 * — the same mistake that let an invisible fade and a class-that-nothing-set
 * both pass earlier checks.
 *
 * Creates its own fixtures (AUDIT SLIP ...) and leaves them for
 * `npm run purge:test`.
 */
/**
 * Create a settled return via the API, open it from the returns list, click
 * 58mm and 80mm, and read the document the print window actually receives.
 * Checking the button exists proves nothing about what it prints.
 */
const puppeteer = require('C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL/97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core');
const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync('c:/Users/skjoy/Desktop/inventory-system-v2-FINAL/backend/.env', 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const API = process.env.AUDIT_API || 'http://localhost:5000/api';
const WEB = process.argv[2] || 'http://localhost:3000';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  let tok;
  const call = (m, u, b) => fetch(API + u, {
    method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, d: await r.json().catch(() => null) }));

  tok = (await call('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD })).d.token;
  const st = Date.now();
  const P = (await call('POST', '/products', {
    name: 'AUDIT SLIP W ' + st, sku: 'AUDSLIP-' + st, barcode: 'AUDSLIP-' + st,
    price: 10.10, cost: 5, stock: 30, lowStockAlert: 2,
  })).d.data;
  const C = (await call('POST', '/customers', { name: 'AUDIT SLIP Debtor ' + st, phone: '01700005555' })).d.data.id;
  const sale = (await call('POST', '/sales', {
    items: [{ productId: P.id, quantity: 10 }], paid: 70, customerId: C,
  })).d.data;
  const ret = (await call('POST', '/returns', {
    saleId: sale.id,
    items: [{ saleItemId: sale.items[0].id, quantity: 10, restockItem: true }],
    refundMethod: 'cash', reason: 'slip print check',
  })).d.data;
  console.log(`  sale ${sale.invoiceNo}: total ${sale.total} paid ${sale.paid} owing ${sale.due}`);
  console.log(`  return ${ret.returnNo}: refund ${ret.totalRefund} settled ${ret.appliedToDue} cash ${ret.cashRefund}\n`);

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1152, height: 720 });
  await p.goto(WEB + '/login', { waitUntil: 'networkidle2', timeout: 120000 });
  await p.type('input[type=email]', env.SEED_ADMIN_EMAIL);
  await p.type('input[type=password]', env.SEED_ADMIN_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 });

  for (const lang of ['bn', 'en']) {
    await p.goto(WEB + '/returns', { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2400));
    await p.evaluate((L) => {
      const bs = [...document.querySelectorAll('.lang-toggle button')];
      const w = bs.find((x) => (L === 'en' ? /EN/i.test(x.innerText) : /বাংলা/.test(x.innerText)));
      if (w) w.click();
    }, lang);
    await new Promise((r) => setTimeout(r, 1400));

    // The split must be on the durable row, not only in the moment.
    const rowSplit = await p.evaluate((rn) => {
      const rows = [...document.querySelectorAll('tr')];
      const row = rows.find((r) => r.innerText.includes(rn));
      if (!row) return null;
      const el = row.querySelector('.ret-split') || row.querySelector('.ret-amount-split');
      return el ? el.innerText.replace(/\s+/g, ' ') : 'row found, no split';
    }, ret.returnNo);
    check(`${lang}: the returns list row shows the split`,
      !!rowSplit && rowSplit !== 'row found, no split', rowSplit || 'row not found');

    // Open it.
    await p.evaluate((rn) => {
      const rows = [...document.querySelectorAll('tr')];
      const row = rows.find((r) => r.innerText.includes(rn));
      const btn = row && [...row.querySelectorAll('button')].find((b) => /View|দেখুন|🔍/.test(b.innerText));
      if (btn) btn.click();
    }, ret.returnNo);
    await new Promise((r) => setTimeout(r, 1800));
    // Prove the modal is really open before clicking anything inside it.
    const opened = await p.evaluate(() => !!document.getElementById('ret-reprint-58'));
    check(`${lang}: the return detail opens with reprint buttons`, opened, ret.returnNo);
    if (!opened) continue;

    for (const w of [58, 80]) {
      const html = await p.evaluate((width) => {
        window.__cap = '';
        const realOpen = window.open;
        window.open = function () {
          return {
            document: { open() {}, close() {}, write(h) { window.__cap += h; }, fonts: null },
            addEventListener() {}, focus() {}, print() {}, close() {},
            setTimeout: (fn) => fn(),
          };
        };
        const b = document.getElementById('ret-reprint-' + width);
        if (b) b.click();
        window.open = realOpen;
        return window.__cap;
      }, w);

      check(`${lang} ${w}mm: a slip document is produced`, html.length > 500, html.length + ' bytes');
      if (html.length > 500) {
        check(`${lang} ${w}mm:   total ৳101.00 present`, /101\.00/.test(html));
        check(`${lang} ${w}mm:   settled ৳31.00 present`, /31\.00/.test(html));
        check(`${lang} ${w}mm:   cash handed back ৳70.00 present`, /70\.00/.test(html));
        check(`${lang} ${w}mm:   names the invoice it was against`, html.includes(sale.invoiceNo));
        check(`${lang} ${w}mm:   embeds Hind Siliguri (no boxes on thermal)`,
          /Hind Siliguri/.test(html) && /woff2/.test(html));
        check(`${lang} ${w}mm:   paper width is ${w}mm`, new RegExp(`size: ${w}mm`).test(html),
          (html.match(/size: \d+mm/) || ['?'])[0]);
      }
    }
  }

  await browser.close();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
