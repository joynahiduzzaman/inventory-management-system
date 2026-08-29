/**
 * checkCredentials.js — pre-flight for the production migration.
 *
 *   node scripts/checkCredentials.js
 *
 * Confirms that CLOUDINARY_URL and TARGET_DATABASE_URL are present, correctly
 * shaped, and actually reach the services they name, BEFORE any migration
 * touches data.
 *
 * Nothing sensitive is ever written to stdout: values are reported only as
 * present/absent and valid/malformed, hosts are shown without credentials, and
 * every error message is scrubbed of anything resembling a secret before it is
 * printed — driver and SDK errors routinely quote the whole connection string
 * back at you, which is how credentials end up in CI logs.
 */
require('../config/env');
const { Sequelize } = require('sequelize');
const { parseDbUrl, sslOptions } = require('../config/parseDbUrl');

/** Strips anything that could be a credential out of a message. */
const scrub = (text) => String(text || '')
  .replace(/\/\/[^\s@/]+:[^\s@/]+@/g, '//<redacted>@')   // user:pass@ in any URL
  .replace(/cloudinary:\/\/\S+/gi, 'cloudinary://<redacted>')
  .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<redacted>');      // long opaque tokens

const ok   = (m) => console.log(`  ✅ ${m}`);
const bad  = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`     ${m}`);

let failures = 0;

(async () => {
  // ── Cloudinary ────────────────────────────────────────────────────────────
  console.log('\nCloudinary');
  const CDN = require('../config/cloudinary');
  const rawCdn = (process.env.CLOUDINARY_URL || '').trim();

  if (!rawCdn && !CDN.urlWasMalformed && !CDN.isConfigured()) {
    bad('CLOUDINARY_URL is not set in backend/.env');
    failures++;
  } else if (!CDN.isConfigured()) {
    bad('CLOUDINARY_URL is set but malformed');
    info('expected: cloudinary://<api_key>:<api_secret>@<cloud_name>');
    info('the "@<cloud_name>" suffix is the part most often missing');
    failures++;
  } else {
    ok('CLOUDINARY_URL is present and correctly shaped');
    info(`cloud name: ${CDN.cloudinary.config().cloud_name}`);
    try {
      const res = await CDN.cloudinary.api.ping();
      if (res && res.status === 'ok') ok('Cloudinary API reachable and credentials accepted');
      else { bad(`Cloudinary ping returned: ${scrub(JSON.stringify(res))}`); failures++; }
    } catch (err) {
      bad(`Cloudinary rejected the credentials: ${scrub(err.message)}`);
      if (err.error && err.error.http_code === 401) info('401 — api_key/api_secret pair is wrong');
      failures++;
    }
  }

  // ── Aiven MySQL ───────────────────────────────────────────────────────────
  console.log('\nTarget database');
  const raw = process.env.TARGET_DATABASE_URL || '';
  if (!raw) {
    bad('TARGET_DATABASE_URL is not set in backend/.env');
    failures++;
  } else {
    const { url, ssl } = parseDbUrl(raw);
    let host = '(unparseable)', port = '', db = '';
    try {
      const u = new URL(url);
      host = u.hostname; port = u.port || '3306'; db = u.pathname.replace(/^\//, '');
    } catch { /* reported below */ }

    ok('TARGET_DATABASE_URL is present');
    info(`host: ${host}:${port}   database: ${db}`);
    info(`TLS: ${ssl ? 'requested by the URL' : 'not requested by the URL — will still be enabled by default'}`);

    const target = new Sequelize(url, {
      dialect: 'mysql',
      logging: false,
      dialectOptions: { connectTimeout: 30000, ssl: sslOptions(process.env.TARGET_DB_CA_CERT) },
      pool: { max: 2, min: 0, acquire: 40000, idle: 10000 },
    });

    try {
      await target.authenticate();
      const [v] = await target.query('SELECT VERSION() AS v', { type: target.QueryTypes.SELECT });
      ok(`Connected over TLS — MySQL ${v.v}`);

      const [[grants]] = await target.query('SHOW GRANTS');
      info(`privileges: ${Object.values(grants)[0].replace(/IDENTIFIED BY.*/i, '').slice(0, 90)}`);

      const tables = await target.query('SHOW TABLES', { type: target.QueryTypes.SELECT });
      info(`existing tables: ${tables.length}`);

      const [maxc] = await target.query("SHOW VARIABLES LIKE 'max_connections'", { type: target.QueryTypes.SELECT });
      if (maxc) info(`max_connections: ${maxc.Value}  (app pool is capped at 3 per instance)`);

      // Writability — the migration is worthless if the user is read-only.
      await target.query('CREATE TABLE IF NOT EXISTS _preflight_check (id INT PRIMARY KEY)');
      await target.query('DROP TABLE _preflight_check');
      ok('Write access confirmed (created and dropped a temporary table)');
    } catch (err) {
      bad(`Cannot use the target database: ${scrub(err.message)}`);
      const m = String(err.message);
      if (/handshake|SSL|secure/i.test(m)) info('looks like a TLS problem — check ssl-mode on the URI');
      if (/ENOTFOUND|EAI_AGAIN/i.test(m))  info('hostname did not resolve — check the host portion');
      if (/Access denied/i.test(m))        info('credentials rejected — check user and password');
      if (/ETIMEDOUT|ECONNREFUSED/i.test(m)) info('no route — check the port and any IP allow-list');
      failures++;
    } finally {
      try { await target.close(); } catch { /* already closed */ }
    }
  }

  console.log(failures === 0
    ? '\n🎉 Both services verified — safe to migrate.\n'
    : `\n⛔ ${failures} problem(s) above. Nothing has been migrated.\n`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('Pre-flight failed:', scrub(err.message));
  process.exit(1);
});
