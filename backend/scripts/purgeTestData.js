/**
 * purgeTestData.js — removes automated-test fixtures from a database.
 *
 *   node scripts/purgeTestData.js --dry-run              # report only
 *   node scripts/purgeTestData.js                        # local database
 *   node scripts/purgeTestData.js --target               # the migration target
 *
 * The end-to-end suite creates products named "AUDIT Test Widget" and sells
 * them, and the image checks create "IMGTEST"/"CDNTEST"/"LIVE IMG CHECK"
 * products. Those rows are indistinguishable from trade in the dashboard: they
 * inflate the sale count, revenue and profit for whichever day the suite last
 * ran. This removes them.
 *
 * Safety:
 *   - Every row it touches is written to backups/ as JSON first.
 *   - A sale is removed ONLY if every line on it is a test product, so a real
 *     invoice that happens to include one is never touched.
 *   - Stock taken by a removed sale of a REAL product is given back, and the
 *     matching ledger rows go with it, so products.stock still reconciles
 *     against stock_movements afterwards.
 */
require('../config/env');
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { parseDbUrl, sslOptions } = require('./../config/parseDbUrl');

const DRY = process.argv.includes('--dry-run');
const USE_TARGET = process.argv.includes('--target');

// Names the test suites use. Anchored so a real product cannot match by accident.
const TEST_NAME_SQL = `(
     name LIKE 'AUDIT %'
  OR name LIKE 'IMGTEST %'
  OR name LIKE 'CDNTEST %'
  OR name LIKE 'LIVE IMG CHECK %'
)`;

// Customers the audit suites open accounts for, so a purged debtor does not
// leave a phantom balance behind.
const TEST_CUSTOMER_SQL = `(name LIKE 'AUDIT %')`;

function connect() {
  if (USE_TARGET) {
    const { url } = parseDbUrl(process.env.TARGET_DATABASE_URL);
    if (!url) { console.error('TARGET_DATABASE_URL is not set'); process.exit(1); }
    return new Sequelize(url, {
      dialect: 'mysql', logging: false, timezone: '+06:00',
      dialectModule: require('mysql2'),
      dialectOptions: { timezone: '+06:00', ssl: sslOptions(process.env.TARGET_DB_CA_CERT) },
    });
  }
  return require('../config/database');
}

(async () => {
  const db = connect();
  const q = (sql, replacements) => db.query(sql, { type: db.QueryTypes.SELECT, replacements });
  const label = USE_TARGET ? 'TARGET (production)' : 'LOCAL';
  await db.authenticate();
  console.log(`\n===== ${label} =====`);

  const products = await q(`SELECT id, name FROM products WHERE ${TEST_NAME_SQL}`);
  const pids = products.map(r => r.id);
  const inP = pids.length ? pids.join(',') : '0';

  // A sale qualifies only when it has at least one test line and no real line.
  const sales = await q(`
    SELECT s.id, s.invoiceNo, s.total, s.customerId
      FROM sales s
     WHERE EXISTS (SELECT 1 FROM sale_items si WHERE si.saleId = s.id AND si.productId IN (${inP}))
       AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.saleId = s.id AND si.productId NOT IN (${inP}))`);

  // Sales explicitly named on the command line (e.g. a deployment smoke-test sale).
  const extraArg = process.argv.find(a => a.startsWith('--invoices='));
  const extraInvoices = extraArg ? extraArg.split('=')[1].split(',').filter(Boolean) : [];
  const extraSales = extraInvoices.length
    ? await q(`SELECT id, invoiceNo, total, customerId FROM sales WHERE invoiceNo IN (:inv)`, { inv: extraInvoices })
    : [];

  const allSales = [...sales, ...extraSales.filter(e => !sales.some(s => s.id === e.id))];
  const sids = allSales.map(r => r.id);
  const inS = sids.length ? sids.join(',') : '0';

  const items = sids.length ? await q(`SELECT * FROM sale_items WHERE saleId IN (${inS})`) : [];
  const returns = sids.length ? await q(`SELECT * FROM returns WHERE saleId IN (${inS})`) : [];
  const rids = returns.map(r => r.id);
  const returnItems = rids.length ? await q(`SELECT * FROM return_items WHERE returnId IN (${rids.join(',')})`) : [];
  const movements = pids.length || sids.length
    ? await q(`SELECT * FROM stock_movements
                WHERE productId IN (${inP})
                   OR reference IN (${allSales.length ? allSales.map(s => db.escape(s.invoiceNo)).join(',') : "''"})`)
    : [];

  // Stock to hand back: lines on removed sales whose product is NOT itself being removed.
  const restore = sids.length ? await q(`
    SELECT si.productId, SUM(si.quantity) AS qty, p.name, p.stock
      FROM sale_items si JOIN products p ON p.id = si.productId
     WHERE si.saleId IN (${inS}) AND si.productId NOT IN (${inP})
     GROUP BY si.productId, p.name, p.stock`) : [];

  console.log(`test products      : ${products.length}`);
  console.log(`test-only sales    : ${allSales.length}  (value ${allSales.reduce((a, s) => a + Number(s.total), 0).toFixed(2)})`);
  console.log(`sale_items         : ${items.length}`);
  console.log(`returns            : ${returns.length} (+${returnItems.length} items)`);
  console.log(`stock_movements    : ${movements.length}`);
  restore.forEach(r => console.log(`stock to give back : ${r.name} +${r.qty} (currently ${r.stock})`));
  if (allSales.length) console.log('invoices           :', allSales.map(s => s.invoiceNo).join(', '));

  if (DRY) { console.log('\n--dry-run: nothing changed.'); await db.close(); return; }
  if (!products.length && !allSales.length) { console.log('\nNothing to remove.'); await db.close(); return; }

  // ── Back up everything about to be deleted ────────────────────────────────
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `purged-test-data-${USE_TARGET ? 'target' : 'local'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ products, sales: allSales, items, returns, returnItems, movements, restore }, null, 1));
  console.log(`\n💾 Backed up to ${path.relative(process.cwd(), file)}`);

  const t = await db.transaction();
  try {
    const run = (sql) => db.query(sql, { transaction: t });
    if (rids.length)   await run(`DELETE FROM return_items WHERE returnId IN (${rids.join(',')})`);
    if (sids.length)   await run(`DELETE FROM returns WHERE saleId IN (${inS})`);
    if (sids.length)   await run(`DELETE FROM sale_items WHERE saleId IN (${inS})`);
    if (movements.length) await run(`DELETE FROM stock_movements WHERE id IN (${movements.map(m => m.id).join(',')})`);
    if (sids.length)   await run(`DELETE FROM sales WHERE id IN (${inS})`);

    // Give back stock taken from real products by the removed sales.
    for (const r of restore) {
      await run(`UPDATE products SET stock = stock + ${Number(r.qty)} WHERE id = ${Number(r.productId)}`);
    }

    // Reverse the customer running totals those sales contributed to.
    for (const s of allSales.filter(x => x.customerId)) {
      await run(`UPDATE customers SET totalPurchase = GREATEST(0, totalPurchase - ${Number(s.total)}) WHERE id = ${Number(s.customerId)}`);
    }

    if (pids.length) {
      await run(`DELETE FROM sale_items WHERE productId IN (${inP})`);
      await run(`DELETE FROM stock_movements WHERE productId IN (${inP})`);
      await run(`DELETE FROM products WHERE id IN (${inP})`);
      await run(`DELETE FROM categories WHERE name LIKE 'AUDIT Cat%'`);
    }

    // Audit customers last, and only those whose sales are already gone. There
    // is no separate payments table — the ledger IS sales.paid/sales.due — so a
    // customer still holding sales is one this purge did not fully cover, and
    // removing them would orphan real invoices.
    const custs = await q(`SELECT id FROM customers WHERE ${TEST_CUSTOMER_SQL}
                            AND id NOT IN (SELECT DISTINCT customerId FROM sales WHERE customerId IS NOT NULL)`);
    if (custs.length) {
      await run(`DELETE FROM customers WHERE id IN (${custs.map(c => Number(c.id)).join(',')})`);
      console.log(`test customers     : ${custs.length}`);
    }
    await t.commit();
  } catch (err) {
    await t.rollback();
    console.error('❌ Purge rolled back:', err.message);
    process.exit(1);
  }

  const after = await q('SELECT COUNT(*) AS sales, COALESCE(SUM(total),0) AS gross FROM sales');
  console.log(`✅ Done. sales now ${after[0].sales}, gross ${after[0].gross}`);
  await db.close();
})().catch(err => { console.error('Purge failed:', err.message); process.exit(1); });
