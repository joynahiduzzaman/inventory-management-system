/**
 * app.js — builds the Express application.
 *
 * Deliberately does NOT listen on a port, sync the schema, or seed. That lets
 * the same app object back two very different runtimes:
 *
 *   server.js       long-lived process (local dev, or any container host)
 *   ../api/index.js Vercel serverless function
 *
 * A serverless invocation must not run sync()/seed on every cold start — it is
 * slow, and two concurrent cold starts racing to create the same table is a
 * real way to corrupt a schema. Production schema creation is a deliberate,
 * one-off step: `npm run migrate:prod` (see DEPLOYMENT.md).
 */
require('./config/env');
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ── Proxy awareness ──────────────────────────────────────────────────────────
// Vercel, Render, Railway and friends terminate TLS at a load balancer and
// forward the real client IP in X-Forwarded-For. Without this, express-rate-limit
// sees every request as coming from the proxy's single IP and would lock out
// the whole shop the moment one person retried a login. Serverless always sits
// behind a proxy, so trust it there without needing the opt-in variable.
if (process.env.TRUST_PROXY || process.env.VERCEL) {
  const v = process.env.TRUST_PROXY || '1';
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? 1 : v);
}

// ── Fail fast on missing secrets ─────────────────────────────────────────────
// Throwing (rather than process.exit) matters on serverless: an exit code is
// invisible in the function log, whereas the thrown message is surfaced.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is missing or shorter than 32 characters. Set a strong value in the environment.');
}
if (!process.env.DATABASE_URL && !process.env.DB_NAME) {
  throw new Error('No database configured. Set DATABASE_URL, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.');
}

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Product images are served from this API; in production that is the
      // deployed origin, not localhost.
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

app.use(cors((req, cb) => {
  const origin = req.headers.origin;

  // No Origin header: same-origin GET, curl, or a mobile app — not a CSRF risk.
  if (!origin) return cb(null, { origin: true, credentials: true });

  // When the SPA and the API share one deployment (the Vercel setup), the
  // browser still sends Origin on writes. Such a request is same-origin by
  // definition, so match it against the host we were actually reached on
  // rather than requiring FRONTEND_URL to track the domain by hand.
  const selfOrigin = req.headers.host ? `${req.protocol}://${req.headers.host}` : null;

  const ok = (selfOrigin && origin === selfOrigin)
    || allowedOrigins.includes(origin)
    || (process.env.ALLOW_VERCEL_PREVIEWS === 'true' && VERCEL_PREVIEW.test(origin));

  if (ok) return cb(null, { origin: true, credentials: true });
  cb(new Error('Not allowed by CORS'));
}));

// ── Uploaded product images ──────────────────────────────────────────────────
// Images live in the database (see routes/uploads.js) so they survive on hosts
// with no writable disk. The static mount stays in front of it to keep serving
// files written by earlier releases that stored them on local disk.
//
// Mounted at both paths, and ahead of the rate limiter: a serverless host can
// only route a request to a function under /api, so a page full of product
// photos would otherwise burn the shop's whole API quota loading pictures.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
const UPLOAD_MOUNTS = ['/uploads', '/api/uploads'];
app.use(UPLOAD_MOUNTS, express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }));
app.use(UPLOAD_MOUNTS, require('./routes/uploads'));

// ── Rate limiting ────────────────────────────────────────────────────────────
// Must be registered AFTER cors(): a limiter that replies before the CORS
// middleware runs sends a 429 with no Access-Control-Allow-Origin header, and
// the browser then reports a confusing CORS failure instead of "slow down".
// Preflights are skipped so an OPTIONS request never burns a client's quota.
//
// NOTE: the counters live in the process, so on serverless they are per
// instance rather than global. That still blunts a burst from one client; it
// is not, and is not relied on as, a hard global cap.
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

app.get('/api/health', async (req, res) => {
  const body = { status: 'OK', timestamp: new Date() };
  // On serverless the usual failure is "the app booted but cannot reach the
  // database", which a static OK would hide.
  if (req.query.db === '1') {
    try {
      await require('./models').sequelize.authenticate();
      body.database = 'connected';
    } catch {
      return res.status(503).json({ ...body, status: 'DEGRADED', database: 'unreachable' });
    }
  }
  res.json(body);
});

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

module.exports = app;
