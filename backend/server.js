/**
 * server.js — long-lived process entry point (local dev, containers, Render).
 *
 * The Express app itself lives in app.js so it can also be mounted as a
 * serverless function. This file adds the parts only a persistent process
 * should do: create/verify the schema, seed the first admin, and listen.
 */
require('./config/env');
const app = require('./app');
const { sequelize, User, Category, Supplier } = require('./models');
const dedupeIndexes = require('./config/dedupeIndexes');
const ensureIndexes = require('./config/ensureIndexes');
const ensureColumns = require('./config/ensureColumns');
const { reportDataIntegrity } = require('./config/dataIntegrity');

const isProd = process.env.NODE_ENV === 'production';

// ── Database seed ────────────────────────────────────────────────────────────
// Credentials come from the environment so no working password is ever
// hard-coded here.
const seedData = async () => {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@shop.com').toLowerCase();
  const staffEmail = (process.env.SEED_STAFF_EMAIL || 'staff@shop.com').toLowerCase();
  const adminPass  = process.env.SEED_ADMIN_PASSWORD;
  const staffPass  = process.env.SEED_STAFF_PASSWORD;

  if (await User.count() === 0) {
    if (!adminPass || adminPass.length < 8) {
      console.error('❌ No users exist and SEED_ADMIN_PASSWORD is unset (or under 8 chars).');
      console.error('   Set SEED_ADMIN_PASSWORD in backend/.env, then restart.');
      process.exit(1);
    }
    await User.create({ name: 'Admin User', email: adminEmail, password: adminPass, role: 'admin' });
    if (staffPass && staffPass.length >= 8) {
      await User.create({ name: 'Staff User', email: staffEmail, password: staffPass, role: 'staff' });
    }
    console.log(`✅ Created initial admin: ${adminEmail}`);
  }

  if (await Category.count() === 0) {
    await Category.bulkCreate([
      { name: 'Electronics', description: 'Electronic devices and accessories' },
      { name: 'Medicine',    description: 'Pharmaceutical products' },
      { name: 'Grocery',     description: 'Daily grocery items' },
      { name: 'Clothing',    description: 'Garments and accessories' },
      { name: 'Stationery',  description: 'Office and school supplies' },
    ]);
    console.log('✅ Default categories created');
  }

  if (await Supplier.count() === 0) {
    await Supplier.bulkCreate([
      { name: 'ABC Traders',        phone: '01711000001', company: 'ABC Trading Co.', address: 'Dhaka, Bangladesh' },
      { name: 'Rahman Enterprises', phone: '01711000002', company: 'Rahman & Co.',    address: 'Chittagong, Bangladesh' },
    ]);
    console.log('✅ Default suppliers created');
  }
};

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: false, alter: false });

    // sync() re-adds a UNIQUE index on every boot; collapse the duplicates
    // before the table hits MySQL's 64-key ceiling and startup breaks for good.
    await dedupeIndexes(sequelize);

    // Columns first: sync({ alter: false }) never adds a column to a table that
    // already exists, so the model and the schema drift apart silently — and an
    // index cannot be built on a column that is not there yet.
    await ensureColumns(sequelize);

    // sync() only applies index definitions on table creation, so pre-existing
    // tables never gained the indexes the reporting queries depend on.
    await ensureIndexes(sequelize);

    console.log('✅ Database connected & synced');

    // Say plainly, on every start, whether the numbers still agree with
    // themselves. Serverless deployments get this via /api/health/integrity
    // and the dashboard instead — see config/dataIntegrity.js.
    await reportDataIntegrity(sequelize);
    await seedData();

    // 0.0.0.0, not localhost: a container's health check comes from outside.
    const HOST = process.env.HOST || '0.0.0.0';
    const server = app.listen(PORT, HOST, () =>
      console.log(`🚀 Server listening on ${HOST}:${PORT}` + (isProd ? '' : ` — http://localhost:${PORT}`)));

    const shutdown = (sig) => async () => {
      console.log(`\n${sig} received — shutting down`);
      server.close(async () => { await sequelize.close(); process.exit(0); });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGINT',  shutdown('SIGINT'));
    process.on('SIGTERM', shutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  }
})();

module.exports = app;
