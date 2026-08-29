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
