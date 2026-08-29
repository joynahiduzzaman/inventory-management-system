/**
 * Loads backend/.env, wherever the process was started from.
 *
 * Plain `require('dotenv').config()` resolves ".env" against the *current
 * working directory*, so the app silently lost its entire configuration when
 * started from anywhere but backend/ — running the Vercel entry point from the
 * repo root, or a script invoked from a parent folder, would fail on the
 * JWT_SECRET guard with no hint that the file simply had not been found.
 *
 * dotenv never overwrites a variable that is already set, so a real deployment
 * (Vercel, Render, Docker) still takes its values from the platform, and a
 * missing file here is expected rather than an error.
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Pin the process timezone.
 *
 * Every report boundary in this app is a Bangladesh-local day or month, and the
 * DATETIME columns hold BST wall-clock values (config/database.js sets the
 * connection timezone to +06:00). But the report queries pass JavaScript `Date`
 * objects as SQL replacements, and Sequelize/mysql2 render those using the
 * *process* timezone rather than the configured connection timezone.
 *
 * On a laptop set to Bangladesh time the two agreed by accident. On a server
 * running UTC — which is every serverless platform, Vercel included — they did
 * not: "today" ended at 18:00 instead of midnight, so the dashboard silently
 * dropped the last six hours of every trading day, and month boundaries were
 * off by the same amount. It was reproducible exactly, on the same data:
 *
 *     TZ unset (+06:00 laptop) -> 30 sales today, gross 11535.00
 *     TZ=UTC   (Vercel)        -> 21 sales today, gross  8065.00
 *
 * Setting TZ here makes the process agree with the data everywhere at once —
 * raw queries, Sequelize `Op.between` clauses and date formatting alike —
 * rather than depending on how each call site happens to serialise a Date.
 * Bangladesh has no daylight saving, so this offset is stable year-round.
 */
// Deliberately NOT falling back to an inherited TZ: serverless hosts set
// TZ=UTC themselves, and honouring that is precisely the bug. Only an explicit
// APP_TZ may override.
process.env.TZ = process.env.APP_TZ || 'Asia/Dhaka';
