/**
 * migrateSchema.js — bring a production database's SCHEMA up to date.
 *
 *   node scripts/migrateSchema.js --check     # report drift, change nothing
 *   node scripts/migrateSchema.js             # apply missing columns + indexes
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `sequelize.sync({ alter: false })` creates tables that do not exist and then
 * never touches them again, so a column added to a model never reaches a
 * database that already has the table. `config/ensureColumns.js` closes that
 * gap — but it is wired into `server.js`, and **server.js never runs on
 * Vercel**. There the API is a serverless function: `api/index.js` requires
 * `backend/app.js` directly, and the whole boot sequence (sync, dedupeIndexes,
 * ensureIndexes, ensureColumns, the integrity report) is deliberately absent.
 *
 * So on a serverless deployment the schema can only ever be moved forward from
 * outside, which is what this script is. Run it against production BEFORE
 * deploying code that depends on a new column, or the first write will fail
 * with "Unknown column" on real data.
 *
 * Both underlying modules are idempotent: they read information_schema, add
 * only what is absent, and never alter or drop anything that already exists.
 * Running this twice is a no-op, and running it against an already-correct
 * database changes nothing.
 *
 * Target comes from TARGET_DATABASE_URL (the same variable migrate:prod uses).
 * It never touches the local development database.
 */

require('../config/env');
const { Sequelize } = require('sequelize');
const { parseDbUrl, sslOptions } = require('../config/parseDbUrl');
const ensureColumns = require('../config/ensureColumns');
const ensureIndexes = require('../config/ensureIndexes');

const CHECK_ONLY = process.argv.includes('--check');

// Kept in step with config/ensureColumns.js. Listed here too so --check can
// report drift without importing the module's internals.
const EXPECTED = [
  { table: 'sales', column: 'discountMode' },
  { table: 'sales', column: 'discountRate' },
];

(async () => {
  const { url } = parseDbUrl(process.env.TARGET_DATABASE_URL);
  if (!url) {
    console.error('❌ TARGET_DATABASE_URL is not set in backend/.env');
    console.error('   This script only ever writes to the target, never to your local database.');
    process.exit(1);
  }

  const db = new Sequelize(url, {
    dialect: 'mysql',
    logging: false,
    timezone: '+06:00',
    dialectModule: require('mysql2'),
    dialectOptions: { timezone: '+06:00', ssl: sslOptions(process.env.TARGET_DB_CA_CERT) },
  });

  try {
    await db.authenticate();
  } catch (err) {
    console.error('❌ Could not reach the target database:', err.message);
    process.exit(1);
  }

  // Never print the URL — it carries the password.
  console.log(`\n===== TARGET: ${db.config.database} @ ${db.config.host} =====`);

  const rows = await db.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :db`,
    { type: db.QueryTypes.SELECT, replacements: { db: db.config.database } }
  );
  const present = new Set(rows.map((r) => `${r.t}.${r.c}`));

  const missing = EXPECTED.filter((e) => !present.has(`${e.table}.${e.column}`));
  console.log('\nSchema check:');
  for (const e of EXPECTED) {
    const ok = present.has(`${e.table}.${e.column}`);
    console.log(`  ${ok ? '✓' : '✗'} ${e.table}.${e.column}${ok ? '' : '   MISSING'}`);
  }

  const [{ n: saleCount }] = await db.query('SELECT COUNT(*) AS n FROM sales',
    { type: db.QueryTypes.SELECT });
  console.log(`\n  sales rows on target: ${saleCount}`);

  if (CHECK_ONLY) {
    console.log(missing.length
      ? `\n--check: ${missing.length} column(s) missing. Re-run without --check to add them.`
      : '\n--check: schema is up to date. Nothing to do.');
    await db.close();
    process.exit(missing.length ? 2 : 0);
  }

  if (!missing.length) {
    console.log('\n✅ Schema already up to date. Nothing changed.');
    await db.close();
    process.exit(0);
  }

  console.log('\nApplying…');
  const added = await ensureColumns(db);
  // Indexes second: one of them is defined on a column added just above.
  const idx = await ensureIndexes(db);

  const after = await db.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'sales'`,
    { type: db.QueryTypes.SELECT, replacements: { db: db.config.database } }
  );
  const now = new Set(after.map((r) => r.c));
  const stillMissing = EXPECTED.filter((e) => e.table === 'sales' && !now.has(e.column));

  console.log(`\n  columns added: ${added}`);
  console.log(`  indexes added: ${idx}`);

  if (stillMissing.length) {
    console.error(`\n❌ Still missing: ${stillMissing.map((e) => e.column).join(', ')}`);
    await db.close();
    process.exit(1);
  }

  // Existing rows keep mode='flat' and rate=NULL, which is accurate: every
  // discount taken before these columns existed was entered as taka.
  const [{ n: flat }] = await db.query(
    "SELECT COUNT(*) AS n FROM sales WHERE discountMode = 'flat'",
    { type: db.QueryTypes.SELECT }
  );
  console.log(`  existing rows defaulted to discountMode='flat': ${flat}`);
  console.log('\n✅ Schema is up to date. Safe to deploy the code that needs it.');
  await db.close();
  process.exit(0);
})().catch((err) => {
  console.error('❌ Schema migration failed:', err.message);
  process.exit(1);
});
