/**
 * How long a parked sale lives. One constant, one function, one place.
 *
 * ── Why 4am and not midnight ───────────────────────────────────────────────
 *
 * The obvious rule is "expires at the end of the business day", and the
 * obvious implementation is the BST midnight the reports already use. It is
 * wrong here. Shops in Dhaka trade until 11pm and often past it, so a cart
 * parked at 11:40pm would vanish forty minutes later with the customer still
 * in the shop — a defensible rule producing an indefensible outcome.
 *
 * So the boundary is moved to a time when nobody is selling. A cart parked at
 * any point during a trading day survives that whole day and the tail of it,
 * and is gone before the next one starts.
 *
 * This is the ONLY place the lifetime is expressed. The expiry query, the API
 * response and the words on screen all derive from here — a date calculation
 * repeated in three places is three places to disagree.
 */

/** Hour of the BST day at which parked sales expire. */
const HOLD_EXPIRY_HOUR = 4;

/** Dhaka is UTC+6 year round; no daylight saving to reason about. */
const BST_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * The instant a cart parked at `createdAt` expires: the next occurrence of
 * HOLD_EXPIRY_HOUR, Dhaka time, strictly after it.
 */
function holdExpiresAt(createdAt) {
  const t = new Date(createdAt).getTime();
  const bst = new Date(t + BST_OFFSET_MS);          // shift so UTC getters read as BST
  const boundary = Date.UTC(
    bst.getUTCFullYear(), bst.getUTCMonth(), bst.getUTCDate(), HOLD_EXPIRY_HOUR, 0, 0, 0
  ) - BST_OFFSET_MS;                                 // shift back to a real instant
  // Parked before 4am today: it dies at 4am today. Parked after: tomorrow's.
  return new Date(boundary > t ? boundary : boundary + 24 * 60 * 60 * 1000);
}

/** The cutoff for a sweep run now: anything created at or before this is stale. */
function staleBefore(now = new Date()) {
  // Work backwards from the same rule so the sweep and the per-row expiry can
  // never disagree: a row is stale exactly when its own expiry has passed.
  const t = now.getTime();
  const bst = new Date(t + BST_OFFSET_MS);
  const boundary = Date.UTC(
    bst.getUTCFullYear(), bst.getUTCMonth(), bst.getUTCDate(), HOLD_EXPIRY_HOUR, 0, 0, 0
  ) - BST_OFFSET_MS;
  // The most recent boundary that has already passed.
  return new Date(boundary <= t ? boundary : boundary - 24 * 60 * 60 * 1000);
}

module.exports = { HOLD_EXPIRY_HOUR, holdExpiresAt, staleBefore };
