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
    // Free managed tiers cap concurrent connections aggressively, and every
    // warm serverless instance holds a pool of its own — so the ceiling that
    // matters is (instances x max), not max. Three is enough for one shop's
    // concurrency and leaves room for many instances under a ~20 connection cap.
    max: Number(process.env.DB_POOL_MAX) || (isProd ? 3 : 10),
    min: 0,
    acquire: 30000,
    idle: 10000,
    evict: 10000,
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
