/**
 * Cart capacity and affordance, verified by what is PAINTED.
 *
 *   node tests/cart.check.js [baseUrl]
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Two previous fixes to this cart were correct in code and invisible on screen:
 *
 *   1. `is-scrollable` was referenced by the stylesheet and set by nothing, so
 *      the fade and the scrollbar never appeared. A check that asked "is the
 *      class set?" would have passed.
 *   2. Once the class WAS set, the fade still could not be seen — the list is
 *      snapped to end flush with a row edge, so the gradient faded the bottom
 *      of a complete row into nothing.
 *
 * And the whole cart was validated at CSS 1440x900 while the shop runs a 1440
 * panel at 125% scaling — CSS 1152x720 — where the list gets 188px instead of
 * 285px and shows four rows instead of six. The measurements were right about
 * a viewport nobody was using.
 *
 * So this file does three things differently:
 *
 *   - every result names the CSS viewport it was measured at
 *   - "visible" means elementFromPoint hits it (not occluded, not clipped) AND
 *     its pixels differ from the surrounding background (something was drawn)
 *   - the widths include 1152x720 and 960x540, not just round numbers
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(
  'C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL',
  '97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core'
));

const BASE = process.argv[2] || process.env.POS_BASE || 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '..', 'backend', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// The shop's real screen is the first one. The round numbers are there to stop
// a fix that only works at one size from looking general.
const VIEWPORTS = [
  [1152, 720],   // a 1440x900 panel at 125% Windows scaling — the actual till
  [960, 540],    // a 1280x720 panel at 133%
  [1280, 800],
  [1440, 900],
  [1536, 864],   // a 1920x1080 panel at 125%
];

const CART_SIZES = [3, 6, 10];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? '  — ' + detail : ''}`);
};

/**
 * Is this element actually on screen? Runs in the page.
 * Not "does it exist" and not "is the class set" — does a click at its centre
 * land on it, which accounts for occlusion, clipping and zero size at once.
 */
const PAINT_PROBE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { present: true, painted: false, why: 'zero size' };
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) {
    return { present: true, painted: false, why: 'hidden by style' };
  }
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  const reachable = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  return {
    present: true,
    painted: reachable,
    why: reachable ? '' : 'covered by ' + (hit ? (hit.className || hit.tagName) : 'nothing'),
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    text: el.textContent.trim().slice(0, 24),
  };
};

/** Are the pixels in this box actually varied, i.e. was something drawn? */
async function pixelsDiffer(page, rect) {
  const shot = await page.screenshot({
    clip: { x: rect.x, y: rect.y, width: Math.max(1, rect.w), height: Math.max(1, rect.h) },
  });
  // A uniform region compresses to a very small PNG; anything with text or a
  // border does not. Crude, but it distinguishes "drawn" from "blank" without
  // pulling in an image library.
  const uniq = new Set(shot).size;
  return { bytes: shot.length, uniq };
}

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

  console.log(`Cart capacity + affordance — ${BASE}`);
  console.log('Every line below names the CSS viewport it was measured at.\n');

  const capacity = [];

  for (const [w, h] of VIEWPORTS) {
    for (const n of CART_SIZES) {
      await page.setViewport({ width: w, height: h });
      await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle2', timeout: 90000 });
      await page.waitForSelector('.pos-tile', { timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate((count) => {
        [...document.querySelectorAll('.pos-tile:not([disabled])')].slice(0, count).forEach((t) => t.click());
      }, n);
      await new Promise((r) => setTimeout(r, 1200 + n * 60));

      const vp = `${w}x${h}`;
      const tag = `CSS ${vp} / ${n} items`;

      const geom = await page.evaluate(() => {
        const list = document.querySelector('.pos-cart-items');
        const lr = list.getBoundingClientRect();
        const rows = [...document.querySelectorAll('[data-cart-row]')];
        const partial = rows.filter((r) => {
          const b = r.getBoundingClientRect();
          return b.top < lr.bottom - 0.5 && b.bottom > lr.bottom + 0.5;
        });
        const full = rows.filter((r) => r.getBoundingClientRect().bottom <= lr.bottom + 0.5).length;
        const hiddenTotal = rows.length - full - partial.length;
        return {
          rows: rows.length, fullyVisible: full, partial: partial.length, hidden: hiddenTotal,
          scrollable: list.scrollHeight > list.clientHeight + 1,
          rowH: rows.length ? Math.round(rows[0].getBoundingClientRect().height) : 0,
        };
      });

      // 1. No row may be sliced. This is the original complaint.
      check(`${tag}: no row is sliced by the list edge`,
        geom.partial === 0, `${geom.fullyVisible}/${geom.rows} whole, ${geom.partial} sliced`);

      // 2. If rows are hidden, the count control must be PAINTED, not merely present.
      const probe = await page.evaluate(PAINT_PROBE, '.pos-more');
      if (geom.hidden > 0) {
        check(`${tag}: "+N more" is actually on screen`,
          probe.present && probe.painted,
          probe.present ? (probe.painted ? `"${probe.text}"` : probe.why) : 'not rendered at all');
        if (probe.painted) {
          const px = await pixelsDiffer(page, probe.rect);
          check(`${tag}:   and something is drawn in its box`,
            px.uniq > 24, `png=${px.bytes}b unique-bytes=${px.uniq}`);
          // Assert the VALUE, not the rendered digits: Bengali numerals are not
          // matched by \d, so parsing the label made the check report failures
          // that were purely its own.
          const shown = await page.evaluate(() => {
            const el = document.querySelector('.pos-more');
            return el ? { n: Number(el.dataset.hidden), text: el.textContent.trim() } : null;
          });
          check(`${tag}:   and the count it reports is the count hidden (${geom.hidden})`,
            !!shown && shown.n === geom.hidden,
            shown ? `control=${shown.n} measured=${geom.hidden} label="${shown.text}"` : 'absent');
          check(`${tag}:   and its label is not empty`,
            !!shown && shown.text.length > 2, shown ? `"${shown.text}"` : 'absent');
        }
      } else {
        check(`${tag}: nothing hidden, so no "+N more" is shown`,
          !probe.present || !probe.painted, probe.present ? 'still showing' : 'absent');
      }

      if (n === CART_SIZES[CART_SIZES.length - 1]) {
        capacity.push({ vp, rows: geom.fullyVisible, rowH: geom.rowH });
      }
    }
  }

  console.log('\n  Rows fully visible before scrolling:');
  capacity.forEach((c) => console.log(`    CSS ${c.vp.padEnd(9)} ${c.rows} rows  (row ${c.rowH}px)`));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e.message); process.exit(1); });
