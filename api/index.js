/**
 * Vercel serverless entry point for the Express API.
 *
 * One function backs every API route. Everything stateful — schema creation,
 * seeding, listening — is deliberately absent; see backend/app.js for why, and
 * DEPLOYMENT.md for the one-off `npm run migrate:prod` step.
 *
 * ── Why the path is rebuilt from a query parameter ──────────────────────────
 *
 * This started as `api/[...slug].js`, the filesystem catch-all. It routed
 * `/api/health` correctly and 404'd `/api/auth/login` at the platform level —
 * only the first path segment ever matched, so every nested route was
 * unreachable. (Two things likely contributed: `[` and `]` are glob
 * metacharacters, so the `functions` key in vercel.json never cleanly matched
 * the file it named.)
 *
 * Rather than depend on how a rewrite treats `req.url` — which is exactly the
 * assumption that broke — vercel.json captures the real path into `__vpath`
 * and this handler puts it back. The reconstruction is explicit and identical
 * for every route, however deep.
 */
const app = require('../backend/app');

module.exports = (req, res) => {
  // 'http://internal' is a throwaway base; only the path and query are used.
  const parsed = new URL(req.url, 'http://internal');
  const carried = parsed.searchParams.get('__vpath');

  if (carried !== null) {
    parsed.searchParams.delete('__vpath');
    const query = parsed.searchParams.toString();
    // `__vpath` is captured without a leading slash by the rewrite.
    req.url = `/${carried}${query ? `?${query}` : ''}`;
  }

  return app(req, res);
};
