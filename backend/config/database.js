const { Sequelize } = require('sequelize');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

/**
 * Managed MySQL providers (Aiven, Clever Cloud, PlanetScale, Railway…) require
 * TLS and usually hand out a single connection URL. Support both that and the
 * discrete DB_* variables so the same code runs locally and in production.
 */
const useSSL = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';

const common = {
  dialect: 'mysql',
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,

  // Bangladesh Standard Time. All report date boundaries assume this.
  timezone: '+06:00',

  dialectOptions: {
    timezone: '+06:00',
    // Longer than the default so a cold managed instance has time to wake.
    connectTimeout: 20000,
    ...(useSSL
      ? {
          ssl: {
            // Providers terminate TLS with their own CA. Verification can be
            // enabled by supplying DB_CA_CERT (PEM contents).
            rejectUnauthorized: process.env.DB_CA_CERT ? true : false,
            ...(process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT } : {}),
          },
        }
      : {}),
  },

  pool: {
    // Free managed tiers cap concurrent connections aggressively — staying
    // well under that cap matters more than raw throughput for a single shop.
    max: Number(process.env.DB_POOL_MAX) || (isProd ? 5 : 10),
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

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, common)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      { ...common, host: process.env.DB_HOST, port: process.env.DB_PORT || 3306 }
    );

module.exports = sequelize;
