const { Sequelize } = require('sequelize');
require('./env');
const { parseDbUrl, sslOptions } = require('./parseDbUrl');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Managed MySQL providers (Aiven, Clever Cloud, Railway…) require TLS and hand
 * out a single connection URL. Support both that and the discrete DB_*
 * variables, so the same code runs against local MySQL and in production.
 *
 * TLS is enabled by DB_SSL, or inferred from an `ssl-mode=REQUIRED` style
 * parameter in the URL itself — see parseDbUrl.js for why that parameter has
 * to be translated rather than passed through.
 */
const { url: DB_URL, ssl: urlWantsSSL } = parseDbUrl(process.env.DATABASE_URL);
const useSSL = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' || urlWantsSSL;

const common = {
  dialect: 'mysql',

  // Hand Sequelize the driver rather than letting it find one.
  //
  // Sequelize resolves the dialect with a bare `require('mysql2')` at
  // construction time. A bundler that traces imports statically — Vercel's
  // does — cannot see through that, so mysql2 and its dependency tree were
  // left out of the deployed function and every request died with
  // "Please install mysql2 package manually". Requiring it here is a static
  // reference the tracer follows, and it removes the runtime lookup entirely.
  dialectModule: require('mysql2'),

  logging: process.env.DB_LOGGING === 'true' ? console.log : false,

  // Bangladesh Standard Time. All report date boundaries assume this.
  timezone: '+06:00',

  dialectOptions: {
    timezone: '+06:00',
    // Longer than the default so a cold managed instance has time to wake.
    connectTimeout: 20000,
    // Providers terminate TLS with their own CA. Verification can be enabled by
    // supplying that CA as PEM in DB_CA_CERT.
    ...(useSSL ? { ssl: sslOptions(process.env.DB_CA_CERT) } : {}),
  },

  pool: {
    // Three per instance, and the reason has changed with the database.
    //
    // On a capped provider (Aiven reported max_connections=76) the binding
    // constraint was the ceiling: every warm serverless instance holds its own
    // pool, so what matters is (instances x max), not max.
    //
    // TiDB Serverless reports max_connections=0 — no server-side cap — and
    // accepted 40 concurrent connections from one client without complaint, so
    // that ceiling is no longer what limits us. Three is kept anyway because a
    // serverless function serves very little concurrency per instance, so a
    // larger pool would be idle sockets rather than throughput.
    //
    // What DOES cost something on TiDB is opening a connection: measured at
    // ~703ms cold against ~80ms for a query on an already-open one. Hence the
    // longer idle window below — a warm instance should reuse its connection
    // between invocations rather than pay that again. The server's own
    // wait_timeout is 8 hours, so it will not drop them first.
    max: Number(process.env.DB_POOL_MAX) || (isProd ? 3 : 10),
    min: 0,
    acquire: 30000,
    idle: 60000,
    evict: 60000,
  },

  retry: {
    // Managed databases drop idle connections; reconnect instead of 500-ing.
    max: 3,
    match: [/ETIMEDOUT/, /ECONNRESET/, /ECONNREFUSED/, /PROTOCOL_CONNECTION_LOST/, /EHOSTUNREACH/],
  },
};

const sequelize = DB_URL
  ? new Sequelize(DB_URL, common)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      { ...common, host: process.env.DB_HOST, port: process.env.DB_PORT || 3306 }
    );

module.exports = sequelize;
