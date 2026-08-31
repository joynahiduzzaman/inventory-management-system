/**
 * Reports and timezone audit.
 *
 *   node tests/audit.reports.js
 *
 * Checks the reporting endpoints against SQL run directly over the same rows,
 * and against arithmetic done by hand on a controlled fixture. Where a report
 * and a hand sum disagree, the hand sum is treated as correct.
 *
 * The timezone cases place sales at 23:50 and 00:05 Bangladesh time by writing
 * createdAt directly — the API cannot backdate a sale, and those two minutes
 * either side of midnight are exactly where a day boundary goes wrong.
 *
 * Everything it creates is named AUDIT and removed by scripts/purgeTestData.js.
 */
require('../config/env');
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const BASE = process.env.AUDIT_BASE || 'http://localhost:5000/api';
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

let TOKEN = '';
const results = [];
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? '  — ' + detail : ''}`);
};

const call = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = null; try { d = await res.json(); } catch { /* no body */ }
  return { status: res.status, d };
};

const q = (sql, replacements) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, replacements });
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) < tol;

/** BST day boundaries as the app computes them, for the SQL comparisons. */
const BST = 6 * 60 * 60 * 1000;
const bstMidnightUTC = (dayOffset = 0) => {
  const n = new Date(Date.now() + BST);
  n.setUTCHours(0, 0, 0, 0);
  return new Date(n.getTime() - BST + dayOffset * 86400000);
};

(async () => {
  const login = await call('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });
  TOKEN = login.d.token;
  if (!TOKEN) { console.error('login failed'); process.exit(1); }

  // ══ TIMEZONE AT THE DAY BOUNDARY ════════════════════════════════════════
  section('Timezone — the two minutes either side of midnight');

  const pr = await call('POST', '/products', {
    name: 'AUDIT TZ Widget ' + Date.now(), price: 100, cost: 60, stock: 1000, lowStockAlert: 5,
  });
  const P = pr.d.data;

  const before = (await call('GET', '/sales/daily')).d.data;

  /** Creates a sale and forces its timestamp to a given BST wall-clock time. */
  const saleAt = async (bstHour, bstMin, dayOffset = 0) => {
    const s = await call('POST', '/sales', { items: [{ productId: P.id, quantity: 1 }] });
    const id = s.d.data.id;
    const when = new Date(bstMidnightUTC(dayOffset).getTime() + (bstHour * 60 + bstMin) * 60000);
    // The connection timezone is +06:00, so handing Sequelize a Date writes the
    // matching BST wall-clock value — the same path the app itself uses.
    await sequelize.query('UPDATE sales SET createdAt = :when WHERE id = :id', { replacements: { when, id } });
    return { id, invoiceNo: s.d.data.invoiceNo, when };
  };

  const late = await saleAt(23, 50, 0);      // today 23:50 BST
  const early = await saleAt(0, 5, 0);       // today 00:05 BST
  const tomorrow = await saleAt(0, 5, 1);    // tomorrow 00:05 BST

  const after = (await call('GET', '/sales/daily')).d.data;
  const grew = Number(after.count) - Number(before.count);
  check('a sale at 23:50 BST counts in TODAY (not tomorrow)', grew >= 2,
        `daily count ${before.count} -> ${after.count} after adding 23:50, 00:05 today and 00:05 tomorrow`);

  const [todayRow] = await q(
    'SELECT COUNT(*) AS n FROM sales WHERE createdAt BETWEEN :s AND :e',
    { s: bstMidnightUTC(0), e: bstMidnightUTC(1) }
  );
  check('  daily count equals a direct SQL count over the same BST window',
        Number(after.count) === Number(todayRow.n),
        `endpoint=${after.count} sql=${todayRow.n}`);

  const [tomorrowRow] = await q(
    'SELECT COUNT(*) AS n FROM sales WHERE createdAt BETWEEN :s AND :e',
    { s: bstMidnightUTC(1), e: bstMidnightUTC(2) }
  );
  check('  the 00:05-tomorrow sale is NOT in today\'s window', Number(tomorrowRow.n) >= 1,
        `tomorrow window holds ${tomorrowRow.n}`);

  const [lateStored] = await q('SELECT CAST(createdAt AS CHAR) AS c FROM sales WHERE id = :id', { id: late.id });
  check('  23:50 is stored as 23:50 BST wall-clock, not shifted', /23:50/.test(lateStored.c),
        `stored="${lateStored.c}"`);
  const [earlyStored] = await q('SELECT CAST(createdAt AS CHAR) AS c FROM sales WHERE id = :id', { id: early.id });
  check('  00:05 is stored as 00:05 BST wall-clock', /00:05/.test(earlyStored.c), `stored="${earlyStored.c}"`);

  // ══ DAILY / MONTHLY RECONCILIATION ══════════════════════════════════════
  section('Daily and monthly totals versus the raw sales table');

  const daily = (await call('GET', '/sales/daily')).d.data;
  const [dailySql] = await q(
    `SELECT COALESCE(SUM(total),0) AS gross, COALESCE(SUM(paid),0) AS collected,
            COALESCE(SUM(due),0) AS due, COUNT(*) AS n
       FROM sales WHERE createdAt BETWEEN :s AND :e`,
    { s: bstMidnightUTC(0), e: bstMidnightUTC(1) }
  );
  check('daily gross equals SUM(sales.total) for the BST day',
        near(daily.grossTotal, dailySql.gross), `endpoint=${daily.grossTotal} sql=${dailySql.gross}`);
  check('daily collected equals SUM(sales.paid)',
        near(daily.totalSales, dailySql.collected), `endpoint=${daily.totalSales} sql=${dailySql.collected}`);
  check('daily due equals SUM(sales.due)',
        near(daily.totalDue, dailySql.due), `endpoint=${daily.totalDue} sql=${dailySql.due}`);

  const dash = (await call('GET', '/reports/dashboard')).d.data;
  const monthStartBST = (() => {
    const n = new Date(Date.now() + BST);
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1) - BST);
  })();
  const monthEndBST = (() => {
    const n = new Date(Date.now() + BST);
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1) - BST);
  })();

  const [monthSql] = await q(
    'SELECT COALESCE(SUM(total),0) AS gross, COUNT(*) AS n FROM sales WHERE createdAt BETWEEN :s AND :e',
    { s: monthStartBST, e: monthEndBST }
  );
  check('month gross revenue equals SUM(sales.total) for the BST month',
        near(dash.month.grossRevenue, monthSql.gross),
        `dashboard=${dash.month.grossRevenue} sql=${monthSql.gross}`);

  const [retSql] = await q(
    'SELECT COALESCE(SUM(totalRefund),0) AS refunds FROM returns WHERE createdAt BETWEEN :s AND :e',
    { s: monthStartBST, e: monthEndBST }
  );
  check('month net revenue = gross - refunds (the documented rule)',
        near(dash.month.revenue, Number(monthSql.gross) - Number(retSql.refunds)),
        `dashboard=${dash.month.revenue} hand=${(Number(monthSql.gross) - Number(retSql.refunds)).toFixed(2)}`);

  // ══ COGS AND PROFIT BY HAND ═════════════════════════════════════════════
  section('COGS and profit, by hand on a fixture');

  // price 100, cost 60. Sell 10 => revenue 1000, cogs 600, gross profit 400.
  const beforeCogs = (await call('GET', '/reports/dashboard')).d.data.month;
  const fx = await call('POST', '/sales', { items: [{ productId: P.id, quantity: 10 }] });
  const fxSale = fx.d.data;
  const afterCogs = (await call('GET', '/reports/dashboard')).d.data.month;

  check('gross revenue rose by exactly the sale total (1000.00)',
        near(Number(afterCogs.grossRevenue) - Number(beforeCogs.grossRevenue), 1000),
        `delta=${(Number(afterCogs.grossRevenue) - Number(beforeCogs.grossRevenue)).toFixed(2)}`);
  check('COGS rose by exactly quantity x cost (10 x 60 = 600.00)',
        near(Number(afterCogs.cogs) - Number(beforeCogs.cogs), 600),
        `delta=${(Number(afterCogs.cogs) - Number(beforeCogs.cogs)).toFixed(2)}`);
  check('gross profit rose by revenue - cogs (1000 - 600 = 400.00)',
        near(Number(afterCogs.grossProfit) - Number(beforeCogs.grossProfit), 400),
        `delta=${(Number(afterCogs.grossProfit) - Number(beforeCogs.grossProfit)).toFixed(2)}`);
  check('grossProfit = revenue - cogs holds as an identity',
        near(Number(afterCogs.grossProfit), Number(afterCogs.revenue) - Number(afterCogs.cogs)),
        `gp=${afterCogs.grossProfit} rev-cogs=${(Number(afterCogs.revenue) - Number(afterCogs.cogs)).toFixed(2)}`);
  check('netProfit = grossProfit - expenses holds as an identity',
        near(Number(afterCogs.netProfit), Number(afterCogs.grossProfit) - Number(afterCogs.expenses)),
        `np=${afterCogs.netProfit} gp-exp=${(Number(afterCogs.grossProfit) - Number(afterCogs.expenses)).toFixed(2)}`);

  // A return must reduce COGS by the returned units' cost, not the whole line.
  const retBefore = (await call('GET', '/reports/dashboard')).d.data.month;
  await call('POST', '/returns', {
    saleId: fxSale.id,
    items: [{ saleItemId: fxSale.items[0].id, quantity: 4, restockItem: true }],
    refundMethod: 'cash',
  });
  const retAfter = (await call('GET', '/reports/dashboard')).d.data.month;
  check('a 4-unit return reduces COGS by 4 x 60 = 240.00',
        near(Number(retBefore.cogs) - Number(retAfter.cogs), 240),
        `delta=${(Number(retBefore.cogs) - Number(retAfter.cogs)).toFixed(2)}`);
  check('a 4-unit return of an UNdiscounted sale reduces revenue by 4 x 100 = 400.00',
        near(Number(retBefore.revenue) - Number(retAfter.revenue), 400),
        `delta=${(Number(retBefore.revenue) - Number(retAfter.revenue)).toFixed(2)}`);

  // ══ LEDGER RECONCILIATION ═══════════════════════════════════════════════
  section('Ledger reconciliation');

  const [drift] = await q(`
    SELECT COUNT(*) AS n FROM (
      SELECT p.id
        FROM products p
        JOIN (SELECT productId, MAX(id) AS lastId FROM stock_movements GROUP BY productId) m
          ON m.productId = p.id
        JOIN stock_movements sm ON sm.id = m.lastId
       WHERE sm.stockAfter <> p.stock
    ) x`);
  check('every product\'s stock equals the last ledger entry for it',
        Number(drift.n) === 0, `${drift.n} product(s) disagree with their ledger`);

  const [balDrift] = await q(`
    SELECT COUNT(*) AS n FROM (
      SELECT c.id
        FROM customers c
        LEFT JOIN sales s ON s.customerId = c.id
       GROUP BY c.id, c.dueAmount
      HAVING ABS(c.dueAmount - COALESCE(SUM(s.due), 0)) > 0.01
    ) x`);
  check('every customer\'s dueAmount equals the sum of their unpaid invoices',
        Number(balDrift.n) === 0, `${balDrift.n} customer(s) disagree`);

  const [neg] = await q('SELECT COUNT(*) AS n FROM products WHERE stock < 0');
  check('no product has negative stock', Number(neg.n) === 0, `${neg.n} negative`);

  const [orphan] = await q(`
    SELECT (SELECT COUNT(*) FROM sale_items si LEFT JOIN sales s ON s.id = si.saleId WHERE s.id IS NULL)
         + (SELECT COUNT(*) FROM return_items ri LEFT JOIN returns r ON r.id = ri.returnId WHERE r.id IS NULL) AS n`);
  check('no orphaned sale_items or return_items', Number(orphan.n) === 0, `${orphan.n} orphans`);

  await sequelize.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  failed.forEach((f) => console.log(`  FAIL: ${f.name}\n        ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('AUDIT HARNESS ERROR', e); process.exit(1); });
