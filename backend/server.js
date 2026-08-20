require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { sequelize, User, Category, Supplier } = require('./models');
const dedupeIndexes = require('./config/dedupeIndexes');
const ensureIndexes = require('./config/ensureIndexes');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ── Proxy awareness ──────────────────────────────────────────────────────────
// Render, Railway, Fly and friends terminate TLS at a load balancer and forward
// the real client IP in X-Forwarded-For. Without this, express-rate-limit sees
// every request as coming from the proxy's single IP and would lock out the
// whole shop the moment one person retried a login. TRUST_PROXY is opt-in so a
// bare-metal deploy cannot be tricked into trusting a spoofed header.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? 1 : v);
}

// ── Fail fast on missing secrets ─────────────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET is missing or shorter than 32 characters. Set a strong value in backend/.env');
  process.exit(1);
}
// Either a full connection URL or the discrete DB_* variables must be present.
if (!process.env.DATABASE_URL && !process.env.DB_NAME) {
  console.error('❌ No database configured. Set DATABASE_URL, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.');
  console.error('   Copy backend/.env.example to backend/.env and fill it in.');
  process.exit(1);
}

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Product images are served from this API; in production that is the
      // deployed API origin, not localhost.
      'img-src': ["'self'", 'data:', 'blob:', 'http://localhost:5000', 'http://localhost:3000',
        ...(process.env.PUBLIC_API_URL ? [process.env.PUBLIC_API_URL] : [])],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
// FRONTEND_URL accepts a comma-separated list so a staging and a production
// frontend can share one API. Vercel preview deployments get a fresh subdomain
// per commit, so they are matched by pattern rather than listed one by one.
const allowedOrigins = [
  ...(process.env.FRONTEND_URL || '').split(',').map(o => o.trim()).filter(Boolean),
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// e.g. inventory-management-system-abc123-joynahiduzzaman.vercel.app
const VERCEL_PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

const isAllowedOrigin = (origin) =>
  allowedOrigins.includes(origin) ||
  (process.env.ALLOW_VERCEL_PREVIEWS === 'true' && VERCEL_PREVIEW.test(origin));

app.use(cors({
  origin: (origin, cb) => {
    // No Origin header: same-origin, curl, or a mobile app — not a browser CSRF risk.
    if (!origin) return cb(null, true);
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Rate limiting ────────────────────────────────────────────────────────────
// Must be registered AFTER cors(): a limiter that replies before the CORS
// middleware runs sends a 429 with no Access-Control-Allow-Origin header, and
// the browser then reports a confusing CORS failure instead of "slow down".
// Preflights are skipped so an OPTIONS request never burns a client's quota.
const skipPreflight = (req) => req.method === 'OPTIONS';

// Tight on login (credential stuffing).
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: skipPreflight,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
}));

// Loose but present everywhere else, so a runaway client cannot flatten the
// till during trading hours. Sized for a busy shop: several staff behind one
// NAT address still sit far below this.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  skip: skipPreflight,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — please slow down.' },
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Static files ─────────────────────────────────────────────────────────────
// UPLOAD_DIR lets a host mount a persistent disk somewhere outside the repo.
// On a platform with an ephemeral filesystem, uploaded images are lost on
// redeploy unless this points at a mounted volume — see DEPLOYMENT.md.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/products',   require('./routes/products'));
app.use('/api/returns',    require('./routes/returns'));
app.use('/api/sales',      require('./routes/sales'));
app.use('/api/customers',  require('./routes/customers'));
app.use('/api/expenses',   require('./routes/expenses'));
app.use('/api/suppliers',  require('./routes/suppliers'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/reports',    require('./routes/reports'));
app.use('/api/pdf',        require('./routes/pdf'));

app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// ── Unknown API route ────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// ── Global error handler ─────────────────────────────────────────────────────
// Never leaks a stack trace or driver message to the client in production.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unhandled error:', err.stack || err.message);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  res.status(err.status || 500).json({
    success: false,
    message: isProd ? 'Something went wrong on the server' : (err.message || 'Internal server error'),
  });
});

// ── Database seed ────────────────────────────────────────────────────────────
// Credentials come from .env so no working password is ever hard-coded here.
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

    // sync() only applies index definitions on table creation, so pre-existing
    // tables never gained the indexes the reporting queries depend on.
    await ensureIndexes(sequelize);

    console.log('✅ Database connected & synced');
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
