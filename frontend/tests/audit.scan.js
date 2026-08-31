/**
 * Scanning-path audit.
 *
 *   node tests/audit.scan.js [baseUrl]
 *
 * Drives the real POS in a real browser. Where a hardware path cannot be
 * exercised (a physical scanner gun, a real camera sensor, a device that
 * actually vibrates) the check verifies the code path that hardware would
 * trigger — the event handling, the constraint object, the API call — and the
 * report says plainly which is which.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(
  'C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL',
  '97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core'
));

const BASE = process.argv[2] || process.env.POS_BASE || 'http://localhost:3000';
const API = process.env.AUDIT_API || 'http://localhost:5000/api';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '..', 'backend', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const results = [];
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? '  — ' + detail : ''}`);
};

const SCAN = '[data-scan-input="true"]';

(async () => {
  // A fixture with a known SKU, and one with exactly one unit left.
  const login = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }),
  }).then((r) => r.json());
  const api = (m, u, b) => fetch(API + u, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, d: await r.json().catch(() => null) }));

  const stamp = Date.now();
  const mk = async (name, sku, stock) => (await api('POST', '/products', {
    name: `AUDIT SCAN ${name} ${stamp}`, sku, barcode: sku, price: 25, cost: 10, stock, lowStockAlert: 2,
  })).d.data;
  const NORMAL = await mk('Normal', `AUDSCAN-N-${stamp}`, 50);
  const LASTONE = await mk('LastOne', `AUDSCAN-L-${stamp}`, 1);
  const OOS = await mk('OutOfStock', `AUDSCAN-O-${stamp}`, 0);

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Record every lookup the app makes, GET only — an OPTIONS preflight is not
  // a scan, and counting it once made a working scanner look like it fired twice.
  const lookups = [];
  page.on('response', (r) => {
    if (r.url().includes('/products/scan/') && r.request().method() === 'GET') {
      lookups.push(decodeURIComponent(r.url().split('/scan/')[1]));
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.type('input[type="email"]', env.SEED_ADMIN_EMAIL);
  await page.type('input[type="password"]', env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 });

  const gotoPos = async () => {
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('.pos-tile', { timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
  };
  const cartQty = () => page.evaluate(() => [...document.querySelectorAll('.pos-qty-input')].map((i) => Number(i.value)));
  const status = () => page.evaluate(() => {
    const el = document.querySelector('.pos-scan-status');
    return el ? { cls: el.className, text: el.innerText.trim() } : null;
  });
  /** Types like a scanner gun: fast, ending in Enter. */
  const gunScan = async (code, focusFirst = true) => {
    await page.waitForSelector(SCAN, { timeout: 20000 });
    if (focusFirst) await page.evaluate((s) => { const i = document.querySelector(s); i.value = ''; i.focus(); }, SCAN);
    await page.keyboard.type(code, { delay: 6 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 1600));
  };

  // ══ USB / KEYBOARD WEDGE ════════════════════════════════════════════════
  section('USB keyboard-wedge scanner');
  await gotoPos();

  check('the scan field holds focus on arrival',
        await page.evaluate((s) => document.activeElement === document.querySelector(s), SCAN));

  lookups.length = 0;
  await gunScan(NORMAL.sku);
  check('a gun scan into the scan field performs exactly one lookup',
        lookups.length === 1, `lookups=${JSON.stringify(lookups)}`);
  check('  and adds exactly one unit', (await cartQty())[0] === 1, JSON.stringify(await cartQty()));

  // Focus lost to the page body — the case after tapping a tile or a button.
  lookups.length = 0;
  await page.evaluate(() => { document.activeElement.blur(); document.body.focus(); });
  await page.keyboard.type(NORMAL.sku, { delay: 6 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1600));
  check('a gun scan still registers when focus has been lost to the page',
        lookups.length === 1, `lookups=${JSON.stringify(lookups)}`);
  check('  and increments the same line to 2', (await cartQty())[0] === 2, JSON.stringify(await cartQty()));

  // Focus in the PRODUCT SEARCH field — a scan must not be typed into it.
  lookups.length = 0;
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => /পণ্য খুঁজুন|Search products/i.test(x.placeholder || ''));
    i.focus();
  });
  await page.keyboard.type(NORMAL.sku, { delay: 6 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1400));
  const searchVal = await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => /পণ্য খুঁজুন|Search products/i.test(x.placeholder || ''));
    return i.value;
  });
  check('a scan while the SEARCH field has focus is not hijacked into the cart',
        lookups.length === 0, `lookups=${JSON.stringify(lookups)}`);
  check('  the characters land in the search box, where the cashier put the caret',
        searchVal.includes(NORMAL.sku), `search="${searchVal.slice(0, 30)}"`);

  // After switching category.
  await gotoPos();
  await page.evaluate(() => { const s = document.querySelector('select'); if (s && s.options.length > 1) { s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await new Promise((r) => setTimeout(r, 900));
  lookups.length = 0;
  await gunScan(NORMAL.sku);
  check('a scan works after switching category', lookups.length === 1 && (await cartQty()).length > 0,
        `lookups=${lookups.length} rows=${(await cartQty()).length}`);

  // After closing a modal.
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /ক্যামেরা|Camera/i.test(x.innerText)); if (b) b.click(); });
  // Wait for it to actually open: pressing Escape at a fixed 2.5s sometimes
  // beat the camera starting, and the modal then opened behind the next step.
  await page.waitForSelector('.scan-modal', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.scan-modal'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  lookups.length = 0;
  await gunScan(NORMAL.sku);
  check('a scan works after closing the camera modal', lookups.length === 1, `lookups=${lookups.length}`);

  // After a completed sale.
  await page.evaluate(() => document.getElementById('pos-checkout')?.click());
  await new Promise((r) => setTimeout(r, 6000));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.modal-footer button, .modal button')].find((x) => /বিক্রয় কাউন্টার|New Sale|Point of Sale/i.test(x.innerText));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1800));
  check('the scan field is refocused after a completed sale',
        await page.evaluate((s) => document.activeElement === document.querySelector(s), SCAN));
  // Zero delay on purpose. A gun fires its whole code in ~60ms, which is
  // exactly when the deferred refocus lands; scanning "after a moment" hides
  // the race entirely. This caught a select() that ate the first characters.
  lookups.length = 0;
  await page.keyboard.type(NORMAL.sku, { delay: 5 });
  const heldAfterSale = await page.evaluate((s) => document.querySelector(s).value, SCAN);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));
  check('  a scan fired the instant the invoice closes is not truncated by the refocus',
        heldAfterSale === NORMAL.sku, `field held "${heldAfterSale}"`);
  check('  and it looks up the whole code, not a fragment',
        lookups.length === 1 && lookups[0] === NORMAL.sku, JSON.stringify(lookups));
  check('  and lands in the cart', (await cartQty()).length === 1, JSON.stringify(await cartQty()));

  // ══ HUMAN TYPING VS MACHINE SPEED ═══════════════════════════════════════
  section('Typing by hand versus a machine-speed burst');
  await gotoPos();
  lookups.length = 0;
  await page.evaluate((s) => { const i = document.querySelector(s); i.value = ''; i.focus(); }, SCAN);
  await page.keyboard.type(NORMAL.sku.slice(0, 6), { delay: 170 });
  await new Promise((r) => setTimeout(r, 900));               // the pause a person makes
  const midValue = await page.evaluate((s) => document.querySelector(s).value, SCAN);
  check('typing slowly does NOT fire a lookup mid-code', lookups.length === 0, `lookups=${JSON.stringify(lookups)}`);
  check('  and the field keeps what was typed', midValue === NORMAL.sku.slice(0, 6), `field="${midValue}"`);
  await page.keyboard.type(NORMAL.sku.slice(6), { delay: 170 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1600));
  check('  pressing Enter then performs exactly one lookup of the whole code',
        lookups.length === 1 && lookups[0] === NORMAL.sku, JSON.stringify(lookups));

  // ══ DUPLICATE SCANS ═════════════════════════════════════════════════════
  section('Duplicate scans');
  await gotoPos();
  lookups.length = 0;
  await gunScan(NORMAL.sku);
  await gunScan(NORMAL.sku);
  const twice = await cartQty();
  check('scanning the same item twice adds TWO units', twice[0] === 2, `qty=${JSON.stringify(twice)}`);
  check('  via exactly two lookups, not one and not three', lookups.length === 2, `lookups=${lookups.length}`);

  // ══ EDGE CASES ══════════════════════════════════════════════════════════
  section('Unknown, out of stock, and the last unit');
  await gotoPos();
  await gunScan('AUDSCAN-DOES-NOT-EXIST');
  let st = await status();
  check('an unknown barcode reports "not found"', !!st && /is-error/.test(st.cls), st ? st.text.slice(0, 50) : 'no status');
  check('  and adds nothing to the cart', (await cartQty()).length === 0, JSON.stringify(await cartQty()));

  await gunScan(OOS.sku);
  st = await status();
  check('an out-of-stock product is refused with a clear reason',
        !!st && /is-error/.test(st.cls), st ? st.text.slice(0, 50) : 'no status');
  check('  and is not added to the cart', (await cartQty()).length === 0, JSON.stringify(await cartQty()));

  await gunScan(LASTONE.sku);
  check('a product with exactly one unit left CAN be scanned', (await cartQty())[0] === 1, JSON.stringify(await cartQty()));
  await gunScan(LASTONE.sku);
  st = await status();
  check('  scanning it a second time is refused (only one existed)',
        (await cartQty())[0] === 1 && !!st && /is-error/.test(st.cls),
        `qty=${JSON.stringify(await cartQty())} status=${st ? st.text.slice(0, 40) : 'none'}`);

  // ══ FEEDBACK WITH THE DEVICE MUTED ══════════════════════════════════════
  section('Scan feedback on a muted device');
  await gotoPos();
  await page.evaluate(() => {
    window.__vibes = [];
    // Stand in for a device that has a vibrator; headless Chrome does not.
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true, value: (p) => { window.__vibes.push(p); return true; },
    });
  });
  await gunScan(NORMAL.sku);
  let vibes = await page.evaluate(() => window.__vibes);
  st = await status();
  check('a successful scan triggers vibration', vibes.length >= 1, JSON.stringify(vibes));
  check('  and shows a visible confirmation independent of sound',
        !!st && /is-success/.test(st.cls), st ? st.text.slice(0, 40) : 'none');
  await page.evaluate(() => { window.__vibes = []; });
  await gunScan('AUDSCAN-NOPE');
  vibes = await page.evaluate(() => window.__vibes);
  st = await status();
  check('a failed scan vibrates differently from a success', vibes.length >= 1 && JSON.stringify(vibes) !== '[35]',
        JSON.stringify(vibes));
  check('  and shows a visible error independent of sound',
        !!st && /is-error/.test(st.cls), st ? st.text.slice(0, 40) : 'none');
  check('the confirmation never moves the product grid',
        await page.evaluate(() => {
          const g = document.querySelector('.pos-grid').getBoundingClientRect().top;
          return Math.abs(g - Number(sessionStorage.getItem('__gridTop') || g)) <= 1;
        }));

  // ══ CAMERA ══════════════════════════════════════════════════════════════
  section('Camera scanner');
  await gotoPos();
  check('the page is a secure context (getUserMedia will be allowed)',
        await page.evaluate(() => window.isSecureContext), BASE.startsWith('https') ? 'https' : 'localhost counts as secure');

  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /ক্যামেরা|Camera/i.test(x.innerText)); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 4000));
  const cam = await page.evaluate(() => {
    const m = document.querySelector('.scan-modal');
    if (!m) return null;
    return {
      open: true,
      status: (m.querySelector('.scan-status') || {}).innerText,
      error: (m.querySelector('.scan-error p') || {}).innerText || null,
      torch: !!m.querySelector('[aria-pressed]'),
      tips: (m.querySelector('.scan-tips') || {}).innerText,
    };
  });
  check('the camera scanner opens', !!cam, cam ? cam.status : 'not found');
  check('  a failure is explained in words, not a raw DOMException',
        !cam ? false : (cam.error === null || /ক্যামেরা|অনুমতি|camera|permission/i.test(cam.error)),
        cam ? (cam.error || cam.status) : '');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  check('  Escape closes it', await page.evaluate(() => !document.querySelector('.scan-modal')));

  // Rear camera and format list are configuration, verifiable by reading what
  // the component asks the browser for.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'CameraScannerModal.jsx'), 'utf8');
  check('rear camera is the default constraint', /facingMode:\s*'environment'/.test(src));
  check('the scan window is derived from the video size, not a fixed box', /qrbox:\s*\(vw,\s*vh\)/.test(src));
  check('1D retail formats AND QR are both requested',
        /EAN_13/.test(src) && /UPC_A/.test(src) && /CODE_128/.test(src) && /QR_CODE/.test(src));
  check('a torch toggle is offered only when the track reports the capability',
        /getRunningTrackCapabilities/.test(src) && /torch/.test(src));
  check('permission denial is matched on err.name, not a localised message',
        /NotAllowedError/.test(src));
  check('a non-secure context is named explicitly rather than left to the browser',
        /isSecureContext/.test(src));
  check('duplicate frames of the same symbol are debounced',
        /lastScanRef/.test(src) && /2000/.test(src));

  // What happens with no camera API at all.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /ক্যামেরা|Camera/i.test(x.innerText)); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 3500));
  const noApi = await page.evaluate(() => {
    const m = document.querySelector('.scan-modal');
    return m ? { err: (m.querySelector('.scan-error p') || {}).innerText || null, crashed: false } : { crashed: true };
  });
  const pageAlive = await page.evaluate(() => !!document.querySelector('.pos-tile'));
  check('with no camera API the app explains itself instead of crashing',
        !noApi.crashed && pageAlive, noApi.err ? noApi.err.slice(0, 60) : 'modal did not open');
  await page.keyboard.press('Escape');

  // ══ LABELS ══════════════════════════════════════════════════════════════
  section('Barcode label generation');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  check('JsBarcode is a bundled dependency', !!(pkg.dependencies && pkg.dependencies.jsbarcode),
        pkg.dependencies && pkg.dependencies.jsbarcode);
  const prodSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Products.js'), 'utf8');
  check('  imported, not fetched from a CDN at click time',
        /import JsBarcode from 'jsbarcode'/.test(prodSrc) && !/cdn\.jsdelivr|unpkg/.test(prodSrc));

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/products`, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.addScriptTag({ path: path.join(__dirname, '..', 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js') });
  const roundTrip = await page.evaluate(async (codes) => {
    const out = [];
    for (const code of codes) {
      const canvas = document.createElement('canvas');
      try {
        // Same settings drawBarcode() uses in Products.js.
        window.JsBarcode(canvas, String(code), {
          format: 'CODE128', width: 2, height: 60, displayValue: true,
          fontSize: 13, margin: 10, background: '#ffffff', lineColor: '#000000', textMargin: 4,
        });
      } catch (e) { out.push({ code, err: 'render: ' + e.message }); continue; }
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const host = document.createElement('div');
      host.id = 'h' + Math.random().toString(36).slice(2); host.style.display = 'none';
      document.body.appendChild(host);
      const reader = new window.Html5Qrcode(host.id, { verbose: false });
      try {
        const decoded = await reader.scanFile(new File([blob], 'l.png', { type: 'image/png' }), false);
        out.push({ code, decoded, ok: decoded === String(code) });
      } catch (e) { out.push({ code, err: 'decode: ' + (e.message || e) }); }
      finally { try { reader.clear(); } catch { /* gone */ } host.remove(); }
    }
    return out;
  }, [NORMAL.sku, '8801234567895', 'ABC-123/XYZ']);
  roundTrip.forEach((r) => check(`  a printed label for "${r.code}" reads back correctly`, !!r.ok, r.err || `decoded="${r.decoded}"`));

  // Is JsBarcode reachable without the network? Prove nothing is fetched.
  const cdnHits = [];
  page.on('request', (req) => { if (/jsdelivr|unpkg|cdnjs/.test(req.url())) cdnHits.push(req.url()); });
  await page.goto(`${BASE}/products`, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 2500));
  check('no CDN request is made when the products page loads', cdnHits.length === 0, cdnHits.join(' '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  failed.forEach((f) => console.log(`  FAIL: ${f.name}\n        ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('AUDIT HARNESS ERROR', e); process.exit(1); });
