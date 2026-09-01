/**
 * Horizontal-overflow regression guard.
 *
 *   node tests/overflow.check.js [baseUrl]
 *
 * Why this exists: a cart panel wider than its column was reported as clipping
 * controls at 1440px, and the check in place at the time — comparing
 * document.scrollWidth against the viewport — reported zero overflow. It was
 * blind by construction. `.pos-cart` carries `overflow: hidden`, so content too
 * wide for it is CLIPPED rather than allowed to extend the document, and
 * scrollWidth never grows. A silent clip and a clean overflow number can
 * coexist, which is the worst combination: the layout looks measured and is
 * actually cutting off the remove button.
 *
 * So this asserts three separate things:
 *
 *   1. document.scrollWidth never exceeds the viewport   (classic overflow)
 *   2. no element is painted past the right edge          (escaped content)
 *   3. no overflow:hidden box is clipping its own content (silent clipping)
 *
 * and then names the controls a cashier cannot complete a sale without, and
 * requires each to be fully inside the viewport.
 *
 * Run across the widths a shop actually uses, with an empty cart, a full one,
 * and quantities above 1 so the decrement button is rendered.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(
  'C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL',
  '97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core'
));

const BASE = process.argv[2] || process.env.POS_BASE || 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const envPath = path.join(__dirname, '..', '..', 'backend', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// Every width a shop plausibly runs, including the ones Windows display
// scaling produces from a 1440 or 1920 panel.
const WIDTHS = [390, 768, 900, 960, 1024, 1152, 1280, 1366, 1440, 1920];
const CARTS = [0, 10];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) console.log(`FAIL | ${name}${detail ? '  — ' + detail : ''}`);
};

/** Runs in the page. */
const probe = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const out = { vw, docOverflow: de.scrollWidth - de.clientWidth, past: [], clipped: [], controls: [] };

  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > vw + 1) {
      out.past.push({
        sel: typeof el.className === 'string' && el.className
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : (el.id ? '#' + el.id : el.tagName),
        over: Math.round(r.right - vw),
      });
    }
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'hidden' || cs.overflow === 'hidden') {
      // Text set to ellipsis is clipped on purpose; a layout box is not.
      const intentional = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
      if (!intentional && el.scrollWidth > el.clientWidth + 1) {
        out.clipped.push({
          sel: typeof el.className === 'string' && el.className
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : (el.id ? '#' + el.id : el.tagName),
          cut: el.scrollWidth - el.clientWidth,
        });
      }
    }
  });

  // ── Overlapping text ────────────────────────────────────────────────────
  // The reported bug was "৳380.00" and "Out of stock" drawn on top of each
  // other. scrollWidth could not see it and neither could the paint-past-edge
  // check: both boxes were inside the tile, they simply occupied the same
  // pixels. So compare the rectangles of text-bearing siblings directly.
  // An element scrolled out of its own scroll container is not visible, however
  // much its rectangle overlaps whatever is painted beyond the container's
  // edge. The cart list scrolls UNDER the totals footer by design.
  const visibleInAncestors = (el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) return false;
      if (r.right <= pr.left + 1 || r.left >= pr.right - 1) return false;
    }
    return true;
  };

  const textBoxes = [...document.querySelectorAll(
    '.pos-tile-name, .pos-tile-price, .pos-tile-stock, .pos-tile-oos, .pos-tile-qty,' +
    '.pos-line-name, .pos-line-price, .pos-line-total,' +
    '.pos-sub-label, .pos-sub-value, .pos-note-toggle, .pos-disc-resolved,' +
    '.pos-total-bar > *, .pos-pay-opt'
  )].filter((el) => el.textContent.trim() && el.getClientRects().length && visibleInAncestors(el));

  const contentBox = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const pad = (v) => parseFloat(cs[v]) || 0;
    return {
      left:   r.left   + pad('paddingLeft')   + (parseFloat(cs.borderLeftWidth)   || 0),
      right:  r.right  - pad('paddingRight')  - (parseFloat(cs.borderRightWidth)  || 0),
      top:    r.top    + pad('paddingTop')    + (parseFloat(cs.borderTopWidth)    || 0),
      bottom: r.bottom - pad('paddingBottom') - (parseFloat(cs.borderBottomWidth) || 0),
    };
  };

  out.overlaps = [];
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      const a = textBoxes[i], b = textBoxes[j];
      if (a.contains(b) || b.contains(a)) continue;           // nesting is not collision
      // Compare CONTENT boxes, not padded ones. A name that reserves a 22px
      // gutter for a corner badge legitimately has that badge sitting over its
      // padding — the text is what must not collide.
      const ra = contentBox(a), rb = contentBox(b);
      // 1px of tolerance: adjacent boxes legitimately share an edge.
      const dx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const dy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (dx > 1 && dy > 1) {
        const nm = (el) => (typeof el.className === 'string' && el.className
          ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName);
        out.overlaps.push({
          a: nm(a), b: nm(b),
          text: (a.textContent.trim().slice(0, 14) + ' / ' + b.textContent.trim().slice(0, 14)),
          by: Math.round(dx) + 'x' + Math.round(dy),
        });
      }
    }
  }

  // Controls without which a sale cannot be completed.
  const need = {
    'total amount': '.pos-total-amount',
    'complete sale': '#pos-checkout',
    'amount received': '#pos-paid',
    'language toggle': '.lang-toggle',
  };
  Object.entries(need).forEach(([label, sel]) => {
    const el = document.querySelector(sel);
    if (!el) { out.controls.push({ label, missing: true }); return; }
    const r = el.getBoundingClientRect();
    out.controls.push({ label, inside: r.right <= vw + 1 && r.left >= -1 && r.width > 0 });
  });

  // Every payment method must be reachable, not just the first three.
  const pays = [...document.querySelectorAll('.pos-pay-opt')];
  out.payAllInside = pays.length > 0 && pays.every((e) => e.getBoundingClientRect().right <= vw + 1);
  out.payCount = pays.length;

  // Every cart row must expose its controls.
  const rows = [...document.querySelectorAll('[data-cart-row]')];
  out.rowCount = rows.length;
  out.rowsComplete = rows.every((row) => {
    const qty = row.querySelector('.pos-qty-input');
    const remove = row.querySelector('.pos-line-remove');
    const n = Number(qty && qty.value);
    const minus = [...row.querySelectorAll('.ui-iconbtn')]
      .filter((b) => !b.classList.contains('pos-line-remove')).length;
    // At quantity 1 the decrement button is deliberately absent: it would do
    // exactly what the remove button does.
    const wantSteppers = n > 1 ? 2 : 1;
    const inside = (e) => e && e.getBoundingClientRect().right <= document.documentElement.clientWidth + 1;
    return qty && remove && minus === wantSteppers && inside(qty) && inside(remove);
  });
  return out;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.type('input[type="email"]', env.SEED_ADMIN_EMAIL);
  await page.type('input[type="password"]', env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 });

  console.log(`POS horizontal-overflow guard — ${BASE}`);

  for (const w of WIDTHS) {
    for (const n of CARTS) {
      const touch = w < 900;
      await page.setViewport({ width: w, height: w < 500 ? 844 : 900, isMobile: touch, hasTouch: touch });
      await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle2', timeout: 90000 });
      await page.waitForSelector('.pos-tile', { timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1400));

      if (n > 0) {
        await page.evaluate((count) => {
          const tiles = [...document.querySelectorAll('.pos-tile:not([disabled])')];
          for (let i = 0; i < count && i < tiles.length; i++) tiles[i].click();
        }, n);
        await new Promise((r) => setTimeout(r, 900 + n * 50));
        // Raise a couple of lines above quantity 1 so the decrement button renders.
        await page.evaluate(() => {
          [...document.querySelectorAll('[data-cart-row]')].slice(0, 2).forEach((row) => {
            const plus = [...row.querySelectorAll('.ui-iconbtn')]
              .find((b) => !b.classList.contains('pos-line-remove'));
            if (plus) plus.click();
          });
        });
        await new Promise((r) => setTimeout(r, 800));
      }

      const d = await page.evaluate(probe);
      const tag = `${w}px cart=${n}`;
      check(`${tag}: document does not scroll horizontally`, d.docOverflow <= 0, `overflow=${d.docOverflow}px`);
      check(`${tag}: nothing painted past the right edge`, d.past.length === 0, JSON.stringify(d.past.slice(0, 3)));
      check(`${tag}: nothing silently clipped by overflow:hidden`, d.clipped.length === 0, JSON.stringify(d.clipped.slice(0, 3)));
      check(`${tag}: no two pieces of text drawn on top of each other`, d.overlaps.length === 0, JSON.stringify(d.overlaps.slice(0, 3)));
      d.controls.forEach((c) => check(`${tag}: ${c.label} fully visible`, !!c.inside, c.missing ? 'not rendered' : ''));
      check(`${tag}: all payment methods visible`, d.payAllInside, `${d.payCount} options`);
      if (n > 0) check(`${tag}: every cart row has qty, stepper and remove`, d.rowsComplete, `${d.rowCount} rows`);
    }
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e.message); process.exit(1); });
