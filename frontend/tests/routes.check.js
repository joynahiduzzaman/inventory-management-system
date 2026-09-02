/**
 * Every route, at phone width, in both languages.
 *
 *   node tests/routes.check.js [baseUrl]
 *
 * Why this exists: overflow.check.js watched the POS screen closely and nothing
 * else at all, so Products, Stock & History and Reports shipped with tables
 * crushed to a single letter per column, KPI figures sliced mid-digit
 * (৳152,18…) and a page heading rendering underneath the cards it was supposed
 * to introduce. Every one of those would have been caught by a check that
 * simply visited the page.
 *
 * The assertions are the ones a shopkeeper would make by looking:
 *
 *   1. the page does not scroll sideways
 *   2. nothing is painted past the right edge
 *   3. no overflow:hidden box is clipping its own content
 *   4. no two pieces of text are drawn on top of each other
 *   5. NO NUMBER OR NAME IS CUT MID-CHARACTER — the one that matters most,
 *      because a truncated price is worse than a missing one: it is a
 *      different, plausible number
 *   6. every interactive control meets the 44px touch floor
 *
 * Ellipsis is treated as deliberate ONLY where the full value is recoverable —
 * the element carries a title attribute. A price ellipsised with no way to read
 * it is a defect, not a design decision.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(
  'C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL',
  '97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core'
));

const BASE = process.argv[2] || process.env.POS_BASE || 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ONLY = process.env.ONLY_ROUTE ? process.env.ONLY_ROUTE.split(',') : null;

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '..', 'backend', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const ROUTES = [
  ['/', 'Dashboard'],
  ['/pos', 'POS'],
  ['/sales', 'Sales history'],
  ['/returns', 'Returns'],
  ['/products', 'Products'],
  ['/inventory', 'Stock & history'],
  ['/categories', 'Categories'],
  ['/suppliers', 'Suppliers'],
  ['/customers', 'Customers'],
  ['/expenses', 'Expenses'],
  ['/reports', 'Reports'],
  ['/users', 'Users'],
];

const WIDTHS = [390, 768];
const LANGS = ['bn', 'en'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) console.log(`FAIL | ${name}${detail ? '\n       ' + detail : ''}`);
};

/** Runs in the page. */
const probe = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const out = { vw, docOverflow: de.scrollWidth - de.clientWidth, past: [], clipped: [], cut: [], overlaps: [], small: [] };

  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.id ? '#' + el.id : cls || el.tagName);
  };

  // An element hidden by a scrolling ancestor is not on screen, however its
  // own rectangle happens to fall.
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflow === 'visible' && pcs.overflowX === 'visible' && pcs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) return false;
      if (r.right <= pr.left + 1 || r.left >= pr.right - 1) return false;
    }
    return true;
  };

  const contentBox = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const n = (v) => parseFloat(cs[v]) || 0;
    return {
      left: r.left + n('paddingLeft') + n('borderLeftWidth'),
      right: r.right - n('paddingRight') - n('borderRightWidth'),
      top: r.top + n('paddingTop') + n('borderTopWidth'),
      bottom: r.bottom - n('paddingBottom') - n('borderBottomWidth'),
    };
  };

  // Content inside a container that scrolls sideways is not "past the edge" —
  // it is reachable by swiping, which is the whole point of the container. The
  // page-level "no horizontal page scroll" assertion above is what catches the
  // real fault, and it stays strict.
  const inScrollerX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll')
          && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > vw + 1 && !inScrollerX(el)) {
      out.past.push({ sel: label(el), over: Math.round(r.right - vw), text: el.textContent.trim().slice(0, 28) });
    }
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'hidden' || cs.overflow === 'hidden') {
      const intentional = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
      if (!intentional && el.scrollWidth > el.clientWidth + 1) {
        out.clipped.push({ sel: label(el), cut: el.scrollWidth - el.clientWidth, text: el.textContent.trim().slice(0, 28) });
      }
    }
  });

  // ── Text cut mid-character ────────────────────────────────────────────────
  // A leaf element whose content is wider than its box, where the value cannot
  // be recovered (no title attribute, not a deliberate multi-line clamp).
  const leaves = [...document.querySelectorAll('body *')].filter(
    (el) => el.children.length === 0 && el.textContent.trim() && visible(el)
  );
  leaves.forEach((el) => {
    const cs = getComputedStyle(el);
    if (el.scrollWidth <= el.clientWidth + 1) return;
    const recoverable = el.title || el.closest('[title]');
    if (recoverable) return;
    if (cs.webkitLineClamp !== 'none') return;      // deliberate multi-line clamp
    out.cut.push({
      sel: label(el),
      text: el.textContent.trim().slice(0, 34),
      by: Math.round(el.scrollWidth - el.clientWidth),
    });
  });

  // ── Overlapping text ──────────────────────────────────────────────────────
  const texts = leaves.filter((el) => el.textContent.trim().length > 1);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      // A sticky cell is SUPPOSED to cover what scrolls beneath it; it has an
      // opaque background for exactly that reason. Only flag it when it is not
      // sticky, which is the case the phone breakpoint already turns off.
      if (a.closest('[class*="col-actions"]') && getComputedStyle(a.closest('td,th') || a).position === 'sticky') continue;
      if (b.closest('[class*="col-actions"]') && getComputedStyle(b.closest('td,th') || b).position === 'sticky') continue;
      const ra = contentBox(a), rb = contentBox(b);
      const dx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const dy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (dx > 2 && dy > 2) {
        out.overlaps.push({
          a: label(a), b: label(b),
          text: a.textContent.trim().slice(0, 16) + ' / ' + b.textContent.trim().slice(0, 16),
          by: Math.round(dx) + 'x' + Math.round(dy),
        });
      }
    }
  }

  // ── Touch targets ─────────────────────────────────────────────────────────
  if (matchMedia('(pointer: coarse)').matches) {
    document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=button]').forEach((el) => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) {
        out.small.push({ sel: label(el), size: Math.round(r.width) + 'x' + Math.round(r.height),
          text: el.textContent.trim().slice(0, 20) });
      }
    });
  }
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

  console.log(`Route guard — ${BASE}`);

  for (const w of WIDTHS) {
    for (const lang of LANGS) {
      await page.setViewport({ width: w, height: w < 500 ? 844 : 1024, isMobile: true, hasTouch: true });
      for (const [route, name] of ROUTES) {
        if (ONLY && !ONLY.includes(route)) continue;
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise((r) => setTimeout(r, 1800));
        await page.evaluate((L) => {
          const bs = [...document.querySelectorAll('.lang-toggle button')];
          const want = bs.find((x) => (L === 'en' ? /EN/i.test(x.innerText) : /বাংলা/.test(x.innerText)));
          if (want) want.click();
        }, lang);
        await new Promise((r) => setTimeout(r, 1200));

        const d = await page.evaluate(probe);
        const tag = `${w}px ${lang} ${name}`;
        check(`${tag}: no horizontal page scroll`, d.docOverflow <= 0, `overflow=${d.docOverflow}px`);
        check(`${tag}: nothing painted past the right edge`, d.past.length === 0, JSON.stringify(d.past.slice(0, 3)));
        check(`${tag}: nothing silently clipped`, d.clipped.length === 0, JSON.stringify(d.clipped.slice(0, 3)));
        check(`${tag}: no text cut mid-character`, d.cut.length === 0, JSON.stringify(d.cut.slice(0, 4)));
        check(`${tag}: no overlapping text`, d.overlaps.length === 0, JSON.stringify(d.overlaps.slice(0, 3)));
        check(`${tag}: touch targets >= 44px`, d.small.length === 0, JSON.stringify(d.small.slice(0, 4)));
      }
    }
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e.message); process.exit(1); });
