/**
 * Vercel serverless entry point for the Express API.
 *
 * The catch-all filename is load-bearing: Vercel's filesystem router maps
 * `api/[...slug].js` to every path under /api and hands the function the
 * original URL, which is what lets one Express app keep its own routing table
 * instead of being sliced into a file per endpoint.
 *
 * Everything stateful — schema creation, seeding, listening — is deliberately
 * absent. See backend/app.js for why, and DEPLOYMENT.md for the one-off
 * `npm run migrate:prod` step that prepares the production database.
 */
module.exports = require('../backend/app');
