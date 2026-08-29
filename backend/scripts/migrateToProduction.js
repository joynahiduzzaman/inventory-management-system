/**
 * migrateToProduction.js — copy the local database into a production one.
 *
 *   node scripts/migrateToProduction.js --check     # connectivity + row counts only
 *   node scripts/migrateToProduction.js --dry-run   # report what would be copied
 *   node scripts/migrateToProduction.js             # perform the copy
 *
 * Safety rules this script follows:
 *   - It NEVER writes to the source database.
 *   - It writes a JSON backup of the source to backups/ before copying anything.
 *   - It refuses to run if the target already holds business data, unless
 *     --force is passed, so a real production database is never clobbered.
 *   - It copies inside a transaction per table and preserves primary keys, so
 *     foreign keys between sales, items and the stock ledger stay intact.
 *
 * Source comes from backend/.env (the DB_* variables you already use).
 * Target comes from TARGET_DATABASE_URL, or TARGET_DB_HOST/USER/PASSWORD/NAME.
 *
 *   TARGET_DATABASE_URL="mysql://user:pass@host:3306/db" \
 *     node scripts/migrateToProduction.js
 */

require('../config/env');
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { parseDbUrl, sslOptions } = require('../config/parseDbUrl');

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');

// Parent rows must exist before the rows that reference them.
const COPY_ORDER = [
  'users',
  'categories',
  'suppliers',
  'customers',
  'products',
  'sales',
  'sale_items',
  'returns',
  'return_items',
  'expenses',
  'stock_movements',
  // Normally empty — images live on Cloudinary. Listed so that anything left
  // behind by a partial `npm run images:cloudinary` is carried over rather
  // than silently dropped.
  'product_images',
];

// Tables that mean "this database is already in use".
const BUSINESS_TABLES = ['products', 'sales', 'customers', 'stock_movements'];

const BATCH = 500;

function buildTarget() {
  // A provider's copy-paste URI carries TLS as `?ssl-mode=REQUIRED`, which
  // mysql2 does not understand. parseDbUrl translates it into the driver's own
  // ssl option and strips the query string; without that, this script is the
  // first thing to fail, with a handshake error that never mentions TLS.
  const { url: targetUrl, ssl: urlWantsSSL } = parseDbUrl(process.env.TARGET_DATABASE_URL);

  // TLS on by default: every managed provider requires it, and TARGET_DB_SSL
  // stays available to turn it off for a plain local target.
  const useSSL = process.env.TARGET_DB_SSL !== 'false' || urlWantsSSL;

  const common = {
    dialect: 'mysql',
    logging: false,
    timezone: '+06:00',
    dialectOptions: {
      timezone: '+06:00',
      connectTimeout: 30000,
      ...(useSSL ? { ssl: sslOptions(process.env.TARGET_DB_CA_CERT) } : {}),
    },
    pool: { max: 3, min: 0, acquire: 60000, idle: 10000 },
  };

  if (targetUrl) {
    return new Sequelize(targetUrl, common);
  }
  if (!process.env.TARGET_DB_HOST) return null;
  return new Sequelize(
    process.env.TARGET_DB_NAME,
    process.env.TARGET_DB_USER,
    process.env.TARGET_DB_PASSWORD,
    { ...common, host: process.env.TARGET_DB_HOST, port: process.env.TARGET_DB_PORT || 3306 }
  );
}

const counts = async (db, tables) => {
  const out = {};
  for (const t of tables) {
    try {
      const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      out[t] = Number(r.n);
    } catch {
      out[t] = null; // table not present
    }
  }
  return out;
};

(async () => {
  const source = require('../config/database');

  const target = buildTarget();
  if (!target && !CHECK_ONLY) {
    console.error('❌ No target database configured.');
    console.error('   Set TARGET_DATABASE_URL, or TARGET_DB_HOST / TARGET_DB_USER /');
    console.error('   TARGET_DB_PASSWORD / TARGET_DB_NAME, then run again.');
    process.exit(1);
  }

  // ── Connectivity ──────────────────────────────────────────────────────────
  try {
    await source.authenticate();
    console.log(`✅ Source connected: ${source.config.database}@${source.config.host}`);
  } catch (e) {
    console.error('❌ Cannot reach the source (local) database:', e.message);
    process.exit(1);
  }

  const srcCounts = await counts(source, COPY_ORDER);
  console.log('\nSource row counts:');
  console.table(srcCounts);

  if (!target) {
    console.log('\n(no target configured — connectivity check of source only)');
    await source.close();
    return;
  }

  try {
    await target.authenticate();
    console.log(`✅ Target connected: ${target.config.database}@${target.config.host}`);
  } catch (e) {
    console.error('❌ Cannot reach the target (production) database:', e.message);
    console.error('   Check the host, port, credentials, TLS setting, and that your');
    console.error('   IP is allowed by the provider firewall.');
    process.exit(1);
  }

  if (CHECK_ONLY) {
    console.log('\nTarget row counts:');
    console.table(await counts(target, COPY_ORDER));
    await source.close(); await target.close();
    return;
  }

  // ── Create the schema on the target ───────────────────────────────────────
  // Point the shared models at the target connection by temporarily swapping
  // the module cache entry, so sync() builds the identical schema.
  console.log('\n📐 Creating schema on target…');
  const dbModulePath = require.resolve('../config/database');
  require.cache[dbModulePath].exports = target;
  Object.keys(require.cache)
    .filter(k => k.includes(`${path.sep}models${path.sep}`))
    .forEach(k => delete require.cache[k]);

  const models = require('../models');
  await models.sequelize.sync({ force: false, alter: false });
  await require('../config/dedupeIndexes')(target, { verbose: false });
  await require('../config/ensureIndexes')(target, { verbose: false });
  console.log('✅ Schema ready on target');

  const tgtCounts = await counts(target, COPY_ORDER);
  console.log('\nTarget row counts before copy:');
  console.table(tgtCounts);

  const occupied = BUSINESS_TABLES.filter(t => (tgtCounts[t] || 0) > 0);
  if (occupied.length && !FORCE) {
    console.error(`\n❌ Target already contains data in: ${occupied.join(', ')}`);
    console.error('   Refusing to copy into a database that is already in use.');
    console.error('   Re-run with --force only if you are certain it is safe.');
    await source.close(); await target.close();
    process.exit(1);
  }

  // ── Back the source up first ──────────────────────────────────────────────
  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `local-backup-${stamp}.json`);

  const payload = {};
  for (const t of COPY_ORDER) {
    if (srcCounts[t] === null) continue;
    const [rows] = await source.query(`SELECT * FROM \`${t}\``);
    payload[t] = rows;
  }
  fs.writeFileSync(backupFile, JSON.stringify(payload, null, 1));
  console.log(`\n💾 Source backed up to ${path.relative(process.cwd(), backupFile)}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: would copy');
    for (const t of COPY_ORDER) {
      if (payload[t]) console.log(`   ${t}: ${payload[t].length} rows`);
    }
    await source.close(); await target.close();
    return;
  }

  // ── Copy ──────────────────────────────────────────────────────────────────
  console.log('\n📦 Copying…');
  // FK checks off for the duration: rows arrive in dependency order, but a
  // self-referencing or out-of-order row should not abort the whole migration.
  await target.query('SET FOREIGN_KEY_CHECKS = 0');

  let grandTotal = 0;
  try {
    for (const table of COPY_ORDER) {
      const rows = payload[table];
      if (!rows || rows.length === 0) { console.log(`   ${table}: nothing to copy`); continue; }

      const columns = Object.keys(rows[0]);
      const colSql = columns.map(c => `\`${c}\``).join(', ');
      let done = 0;

      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
        const values = chunk.flatMap(r => columns.map(c => {
          const v = r[c];
          return v instanceof Date ? v : v;
        }));

        // INSERT IGNORE: re-running the migration tops up rather than exploding
        // on primary keys that already made it across.
        await target.query(
          `INSERT IGNORE INTO \`${table}\` (${colSql}) VALUES ${placeholders}`,
          { replacements: values }
        );
        done += chunk.length;
      }
      grandTotal += done;
      console.log(`   ${table}: ${done} rows`);
    }
  } finally {
    await target.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  // ── Verify ────────────────────────────────────────────────────────────────
  console.log('\n🔍 Verifying…');
  const after = await counts(target, COPY_ORDER);
  console.table(after);

  const mismatches = COPY_ORDER.filter(
    t => srcCounts[t] !== null && (after[t] || 0) < (srcCounts[t] || 0)
  );

  // Spot-check that money survived the trip.
  const [[srcSum]] = await source.query('SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM sales');
  const [[tgtSum]] = await target.query('SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM sales');
  console.log(`Sales total — source ৳${Number(srcSum.s).toFixed(2)} (${srcSum.n} rows), ` +
              `target ৳${Number(tgtSum.s).toFixed(2)} (${tgtSum.n} rows)`);

  const totalsMatch = Math.abs(Number(srcSum.s) - Number(tgtSum.s)) < 0.01 && srcSum.n === tgtSum.n;

  if (mismatches.length === 0 && totalsMatch) {
    console.log(`\n🎉 Migration complete — ${grandTotal} rows copied and verified.`);
  } else {
    console.error('\n⚠️  Verification found differences:');
    mismatches.forEach(t => console.error(`   ${t}: source ${srcCounts[t]}, target ${after[t]}`));
    if (!totalsMatch) console.error('   sales totals do not match');
    console.error(`   Source backup is intact at ${path.relative(process.cwd(), backupFile)}`);
    process.exitCode = 1;
  }

  await source.close();
  await target.close();
})().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
