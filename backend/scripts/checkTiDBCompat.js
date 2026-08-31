/**
 * checkTiDBCompat.js — proves, rather than assumes, that this schema and its
 * queries behave the same on TiDB as they do on MySQL.
 *
 *   node scripts/checkTiDBCompat.js            # audits TARGET_DATABASE_URL
 *
 * TiDB is MySQL-compatible, not MySQL. The differences that matter here are
 * not syntax — everything parses — they are behavioural, and a schema can
 * migrate cleanly and then quietly stop enforcing itself. Every check below
 * therefore exercises the behaviour and inspects the result, rather than
 * asking the server what it claims to support.
 *
 * Nothing here writes to application tables: it creates its own throwaway
 * tables, prefixed _compat_, and drops them.
 */
require('../config/env');
const { Sequelize } = require('sequelize');
const { parseDbUrl, sslOptions } = require('../config/parseDbUrl');

const results = [];
const record = (area, name, ok, detail = '', severity = 'blocker') => {
  results.push({ area, name, ok, detail, severity });
  const mark = ok ? 'ok  ' : (severity === 'note' ? 'NOTE' : 'FAIL');
  console.log(`  ${mark} | ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const { url } = parseDbUrl(process.env.TARGET_DATABASE_URL);
  if (!url) { console.error('TARGET_DATABASE_URL is not set'); process.exit(1); }

  const db = new Sequelize(url, {
    dialect: 'mysql',
    logging: false,
    timezone: '+06:00',
    dialectModule: require('mysql2'),
    dialectOptions: { timezone: '+06:00', connectTimeout: 30000, ssl: sslOptions(process.env.TARGET_DB_CA_CERT) },
    pool: { max: 4, min: 0, acquire: 40000, idle: 10000 },
  });

  const q = (sql, opts = {}) => db.query(sql, { type: db.QueryTypes.SELECT, ...opts });
  const raw = (sql, opts = {}) => db.query(sql, opts);

  await db.authenticate();

  // ── Server identity ───────────────────────────────────────────────────────
  console.log('\nServer');
  const [v] = await q('SELECT VERSION() AS v');
  console.log(`  version: ${v.v}`);
  const [mode] = await q('SELECT @@sql_mode AS m');
  console.log(`  sql_mode: ${mode.m}`);

  // ── 1. sql_mode / ANSI_QUOTES ─────────────────────────────────────────────
  // This is what broke index repair on Aiven: with ANSI_QUOTES on, "x" is an
  // identifier rather than a string.
  console.log('\nANSI_QUOTES');
  const ansi = mode.m.includes('ANSI_QUOTES');
  record('sql_mode', 'ANSI_QUOTES is ' + (ansi ? 'ON' : 'off'), true,
         ansi ? 'double-quoted literals would be identifiers' : 'double quotes are string literals', 'note');
  try {
    const [t] = await q(`SELECT 'literal' = "literal" AS same`);
    record('sql_mode', 'double-quoted string comparison behaves as expected', true, `result=${t.same}`, 'note');
  } catch (e) {
    record('sql_mode', 'double-quoted strings are identifiers here', true,
           'confirms the bound-parameter fix in dedupeIndexes is required', 'note');
  }

  // ── 2. FOREIGN KEYS — the one that would silently break the schema ────────
  console.log('\nForeign keys');
  await raw('DROP TABLE IF EXISTS _compat_child');
  await raw('DROP TABLE IF EXISTS _compat_parent');
  await raw('CREATE TABLE _compat_parent (id INT PRIMARY KEY)');
  await raw(`CREATE TABLE _compat_child (
      id INT PRIMARY KEY,
      parent_id INT,
      CONSTRAINT fk_compat FOREIGN KEY (parent_id) REFERENCES _compat_parent(id)
    )`);

  const fkRows = await q(`
    SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_NAME = '_compat_child' AND REFERENCED_TABLE_NAME IS NOT NULL`);
  record('fk', 'constraint is recorded in information_schema', fkRows.length > 0, `rows=${fkRows.length}`);

  await raw('INSERT INTO _compat_parent (id) VALUES (1)');

  // Enforced on insert?
  let orphanRejected = false;
  try {
    await raw('INSERT INTO _compat_child (id, parent_id) VALUES (1, 999)');
  } catch { orphanRejected = true; }
  record('fk', 'orphan INSERT is REJECTED (constraint actually enforced)', orphanRejected,
         orphanRejected ? '' : 'CONSTRAINT IS BEING IGNORED — the schema would not protect itself');

  // Enforced on delete of a referenced parent?
  await raw('INSERT INTO _compat_child (id, parent_id) VALUES (2, 1)').catch(() => {});
  let deleteRejected = false;
  try {
    await raw('DELETE FROM _compat_parent WHERE id = 1');
  } catch { deleteRejected = true; }
  record('fk', 'DELETE of a referenced parent is REJECTED', deleteRejected,
         deleteRejected ? '' : 'referential integrity not enforced on delete');

  const [fkVar] = await q('SELECT @@foreign_key_checks AS v');
  record('fk', 'foreign_key_checks is ON by default', String(fkVar.v) === '1', `value=${fkVar.v}`);

  // The migrator toggles this around the bulk copy.
  let toggleOk = true;
  try {
    await raw('SET FOREIGN_KEY_CHECKS = 0');
    await raw('SET FOREIGN_KEY_CHECKS = 1');
  } catch (e) { toggleOk = false; }
  record('fk', 'SET FOREIGN_KEY_CHECKS toggling works (migrator needs it)', toggleOk);

  await raw('DROP TABLE IF EXISTS _compat_child');
  await raw('DROP TABLE IF EXISTS _compat_parent');

  // ── 3. The raw-SQL constructs the reports depend on ───────────────────────
  console.log('\nRaw SQL used by the reports');
  await raw('DROP TABLE IF EXISTS _compat_stock');
  await raw(`CREATE TABLE _compat_stock (
     id INT PRIMARY KEY, stock INT, lowStockAlert INT, price DECIMAL(10,2), createdAt DATETIME)`);
  await raw(`INSERT INTO _compat_stock VALUES
     (1, 0, 5, 10.50, '2026-08-01 10:00:00'),
     (2, 3, 5, 20.25, '2026-08-01 18:00:00'),
     (3, 50, 5, 5.75,  '2026-08-02 09:00:00')`);

  // Boolean-as-integer aggregation — every low-stock and out-of-stock figure.
  const [b] = await q(`SELECT SUM(stock = 0) AS out_, SUM(stock <= lowStockAlert) AS low_,
                              SUM(stock > 0 AND stock <= lowStockAlert) AS lowOnly FROM _compat_stock`);
  record('sql', 'SUM(stock = 0) boolean aggregation', Number(b.out_) === 1 && Number(b.low_) === 2 && Number(b.lowOnly) === 1,
         `out=${b.out_} low=${b.low_} lowOnly=${b.lowOnly} (expected 1/2/1)`);

  // Date bucketing — the sales chart and every daily total.
  const d = await q(`SELECT DATE(createdAt) AS day, COUNT(*) AS n FROM _compat_stock
                      GROUP BY DATE(createdAt) ORDER BY day`);
  record('sql', 'DATE(createdAt) grouping', d.length === 2 && Number(d[0].n) === 2,
         `buckets=${d.length} first=${d[0] && d[0].n} (expected 2 / 2)`);

  // Boolean ordering — "out of stock first" on the product list.
  const o = await q('SELECT id FROM _compat_stock ORDER BY (stock = 0) DESC, id ASC');
  record('sql', 'ORDER BY (stock = 0) DESC', o.length === 3 && o[0].id === 1, `first=${o[0] && o[0].id} (expected 1)`);

  const [g] = await q('SELECT GREATEST(0, -5) AS a, COALESCE(NULL, 7) AS b, ROUND(SUM(price), 2) AS c FROM _compat_stock');
  record('sql', 'GREATEST / COALESCE / DECIMAL SUM', Number(g.a) === 0 && Number(g.b) === 7 && Math.abs(Number(g.c) - 36.5) < 0.001,
         `greatest=${g.a} coalesce=${g.b} sum=${g.c}`);

  // ONLY_FULL_GROUP_BY, which ANSI mode implies.
  let ofgbOk = true, ofgbErr = '';
  try {
    await q('SELECT stock, COUNT(*) AS n FROM _compat_stock GROUP BY stock');
  } catch (e) { ofgbOk = false; ofgbErr = e.message.slice(0, 60); }
  record('sql', 'grouped report queries run under this sql_mode', ofgbOk, ofgbErr);

  // ── 4. information_schema, used by the index repair on every boot ─────────
  console.log('\nIndex repair (information_schema)');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  const tbls = await q(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?',
    { replacements: [dbName, 'BASE TABLE'] });
  record('schema', 'information_schema.TABLES with bound parameters', Array.isArray(tbls), `rows=${tbls.length}`);

  const stats = await q(
    `SELECT INDEX_NAME AS idx, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    { replacements: [dbName, '_compat_stock'] });
  record('schema', 'information_schema.STATISTICS reports indexes', stats.length > 0, `rows=${stats.length}`);

  // Can the app add the reporting indexes it needs at boot?
  let idxOk = true, idxErr = '';
  try {
    await raw('CREATE INDEX _compat_idx ON _compat_stock (createdAt)');
    await raw('DROP INDEX _compat_idx ON _compat_stock');
  } catch (e) { idxOk = false; idxErr = e.message.slice(0, 70); }
  record('schema', 'CREATE INDEX / DROP INDEX at runtime', idxOk, idxErr);

  await raw('DROP TABLE IF EXISTS _compat_stock');

  // ── 5. Locking — what the oversell and due-payment tests rely on ──────────
  console.log('\nTransactions and locking');
  const [txnMode] = await q('SELECT @@tidb_txn_mode AS m').catch(() => [{ m: '(not a TiDB variable)' }]);
  const pessimistic = String(txnMode.m).toLowerCase() === 'pessimistic';
  record('txn', 'transaction mode is pessimistic', pessimistic, `tidb_txn_mode=${txnMode.m}`,
         pessimistic ? 'blocker' : 'blocker');

  const [iso] = await q('SELECT @@transaction_isolation AS i');
  record('txn', 'isolation level', true, iso.i, 'note');

  // Prove SELECT ... FOR UPDATE actually blocks a second writer, which is the
  // mechanism the oversell guard and the due-payment allocation both depend on.
  await raw('DROP TABLE IF EXISTS _compat_lock');
  await raw('CREATE TABLE _compat_lock (id INT PRIMARY KEY, n INT)');
  await raw('INSERT INTO _compat_lock VALUES (1, 10)');

  const t1 = await db.transaction();
  await db.query('SELECT * FROM _compat_lock WHERE id = 1 FOR UPDATE', { transaction: t1 });

  let blocked = false;
  const t2 = await db.transaction();
  const contender = db.query('SELECT * FROM _compat_lock WHERE id = 1 FOR UPDATE', { transaction: t2 })
    .then(() => 'acquired').catch((e) => 'error:' + e.message.slice(0, 40));
  const race = await Promise.race([
    contender,
    new Promise((r) => setTimeout(() => r('blocked'), 2500)),
  ]);
  blocked = race === 'blocked';
  record('txn', 'SELECT ... FOR UPDATE blocks a second transaction', blocked,
         blocked ? 'second reader waited as expected' : `second reader ${race} immediately — the oversell guard would not hold`);

  await t1.rollback();
  await contender.catch(() => {});
  await t2.rollback().catch(() => {});
  await raw('DROP TABLE IF EXISTS _compat_lock');

  // ── 6. Types the models use ──────────────────────────────────────────────
  console.log('\nColumn types');
  await raw('DROP TABLE IF EXISTS _compat_types');
  let typesOk = true, typesErr = '';
  try {
    await raw(`CREATE TABLE _compat_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      st ENUM('cash','bkash','nagad','card') DEFAULT 'cash',
      amt DECIMAL(12,2) DEFAULT 0,
      flag BOOLEAN DEFAULT true,
      body TEXT,
      blob_ MEDIUMBLOB,
      createdAt DATETIME)`);
    await raw(`INSERT INTO _compat_types (st, amt, body) VALUES ('bkash', 1234.56, 'x')`);
    const [r] = await q('SELECT st, amt, flag FROM _compat_types LIMIT 1');
    typesOk = r.st === 'bkash' && Math.abs(Number(r.amt) - 1234.56) < 0.001;
    typesErr = `enum=${r.st} decimal=${r.amt} bool=${r.flag}`;
  } catch (e) { typesOk = false; typesErr = e.message.slice(0, 80); }
  record('types', 'ENUM / DECIMAL / BOOLEAN / MEDIUMBLOB round-trip', typesOk, typesErr);

  // AUTO_INCREMENT is allocated in per-node batches on TiDB, so ids are unique
  // and ascending within a session but not necessarily gapless.
  await raw(`INSERT INTO _compat_types (st) VALUES ('cash'), ('card')`);
  const ids = await q('SELECT id FROM _compat_types ORDER BY id');
  const gapless = ids.every((r, i) => i === 0 || r.id === ids[i - 1].id + 1);
  record('types', 'AUTO_INCREMENT ids are unique and ascending', ids.length === 3, `ids=${ids.map(r => r.id).join(',')}`);
  record('types', 'ids are gapless', gapless,
         gapless ? '' : 'TiDB allocates in batches — fine here, ids are surrogate keys and the migrator copies them explicitly',
         'note');
  await raw('DROP TABLE IF EXISTS _compat_types');

  // ── 7. Connection limits, for sizing the pool ────────────────────────────
  console.log('\nConnection limits');
  const [mc] = await q("SHOW VARIABLES LIKE 'max_connections'").then(r => r.length ? r : [{ Value: '(none)' }]);
  record('pool', 'max_connections', true, `${mc.Value}${String(mc.Value) === '0' ? ' (0 = no server-side cap; the serverless gateway enforces its own)' : ''}`, 'note');

  await db.close();

  // ── Verdict ──────────────────────────────────────────────────────────────
  const blockers = results.filter(r => !r.ok && r.severity === 'blocker');
  console.log('\n' + '='.repeat(66));
  if (blockers.length === 0) {
    console.log(`ALL COMPATIBILITY CHECKS PASSED — ${results.filter(r => r.ok).length} checks, no blockers.`);
  } else {
    console.log(`${blockers.length} BLOCKER(S) — do not migrate until these are resolved:`);
    blockers.forEach(b => console.log(`  - [${b.area}] ${b.name}: ${b.detail}`));
  }
  console.log('='.repeat(66) + '\n');
  process.exit(blockers.length ? 1 : 0);
})().catch((err) => {
  console.error('\nCompatibility audit failed:', err.message);
  process.exit(1);
});
