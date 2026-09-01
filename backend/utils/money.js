/**
 * The rounding rule for this system. There is exactly one.
 *
 *     round2(x) === Math.round(x * 100) / 100
 *
 * Two decimals, half away from zero at the paisa. Every taka figure the system
 * stores or returns goes through this — sale totals, discounts, refunds,
 * customer balances, report figures.
 *
 * Do not introduce a second idiom. `parseFloat(x.toFixed(2))` looks equivalent
 * and mostly is, but it rounds the decimal *string* rather than the number and
 * disagrees on some binary-float edge values. A September 2026 audit found it
 * living alone in returnController while everything else used the rule above;
 * the two agreed on every value tested, which is exactly what makes a second
 * idiom dangerous — it is wrong rarely enough that nobody notices.
 *
 * Two rules follow from having one rule:
 *
 *   1. Accumulate unrounded, round once at the end. Rounding each of three
 *      lines at 33.333 gives 99.99; rounding the sum gives 100.00.
 *   2. Round at the boundary, not at the view. An endpoint returns
 *      1606.8399999999997 only because someone downstream is expected to tidy
 *      it up — and the next consumer will not. `roundMoney` below does this for
 *      a whole response payload.
 */

/** The canonical rule. Use this everywhere a taka figure is produced. */
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Round every non-integer number in a response payload to two decimals,
 * in place of the caller doing it field by field and forgetting one.
 *
 * Integers pass through untouched, so counts, ids and quantities are safe.
 * Strings are left alone: a DECIMAL column arriving as "30.00" is already
 * exact, and parsing it here would change the response's shape.
 */
const roundMoney = (value) => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : round2(value);
  }
  if (Array.isArray(value)) return value.map(roundMoney);
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = roundMoney(v);
    return out;
  }
  return value;   // strings, null, Date, model instances — untouched
};

module.exports = { round2, roundMoney };
