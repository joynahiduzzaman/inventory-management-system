/**
 * dataIntegrity.js — the standing check.
 *
 * Some facts about this data are supposed to be true forever, and nothing in
 * the normal running of the shop would tell you if one stopped being true. A
 * test suite catches drift the day someone runs it; this catches drift the day
 * it appears.
 *
 * ── Why it does not live only at boot ──────────────────────────────────────
 *
 * On Vercel the API is a serverless function: `server.js` never runs, so a
 * boot-time check would cover local development and containers and be entirely
 * absent from the deployment that actually holds the shop's money. So this is
 * wired in three places, deliberately:
 *
 *   1. boot          — server.js, for long-lived deployments
 *   2. on demand     — GET /api/health/integrity, for a human or a scheduler
 *   3. daily use     — the dashboard runs the bounded variant and flags drift
 *                      where the shopkeeper already looks every morning
 *
 * (3) is the one that catches a problem six months from now, so it is kept
 * cheap: it is scoped to a date range and every column it touches is indexed.
 *
 * Each check returns `{ key, ok, count, detail }`. A check that cannot run —
 * a column not yet added, a table missing — returns ok:true with a `skipped`
 * note rather than failing; an absent feature is not corrupt data.
 */

const { QueryTypes } = require('sequelize');

/** Money agreement tolerance: half a paisa. */
const EPS = 0.005;

/**
 * The percentage-discount invariant.
 *
 * `discount` is the authority; `discountRate` is provenance. They are redundant
 * on purpose, and redundancy drifts unless something checks it. When a sale was
 * taken as a percentage, the stored taka must be exactly what that rate
 * resolves to against the stored subtotal:
 *
 *     discount === ROUND(subtotal * rate / 100, 2)
 *
 * If this ever fails, the receipt and the ledger disagree about what was
 * actually given away, and the refund path — which trusts the taka — will be
 * refunding against a discount nobody agreed to.
 */
const discountInvariant = (where = '') => `
  SELECT COUNT(*) AS n
    FROM sales
   WHERE discountMode = 'percent'
     AND discountRate IS NOT NULL
     AND ABS(discount - ROUND(subtotal * discountRate / 100, 2)) > ${EPS}
     ${where}
`;

const CHECKS = [
  {
    key: 'percentDiscountResolves',
    label: 'percentage discounts match their stored rate',
    sql: () => discountInvariant(),
    bounded: (range) => discountInvariant('AND createdAt >= :start AND createdAt < :end'),
    needs: ['sales.discountMode', 'sales.discountRate'],
  },
  {
    key: 'percentRatePresent',
    label: 'every percentage sale records the rate it used',
    sql: () => `
      SELECT COUNT(*) AS n FROM sales
       WHERE discountMode = 'percent' AND (discountRate IS NULL OR discountRate <= 0)`,
    needs: ['sales.discountMode', 'sales.discountRate'],
  },
  {
    key: 'flatHasNoRate',
    label: 'flat discounts carry no stray rate',
    sql: () => `
      SELECT COUNT(*) AS n FROM sales
       WHERE discountMode = 'flat' AND discountRate IS NOT NULL`,
    needs: ['sales.discountMode', 'sales.discountRate'],
  },
  {
    key: 'discountWithinSubtotal',
    label: 'no discount exceeds the sale it was given on',
    sql: () => 'SELECT COUNT(*) AS n FROM sales WHERE discount > subtotal + ' + EPS,
  },
  {
    key: 'saleTotalsAddUp',
    label: 'every sale total equals subtotal minus discount plus tax',
    sql: () => `
      SELECT COUNT(*) AS n FROM sales
       WHERE ABS(total - (subtotal - discount + tax)) > ${EPS}`,
  },
  {
    // ── REDEFINED, deliberately ─────────────────────────────────────────────
    //
    // was:  paid + due == total
    // now:  paid + due + (refunds applied to that sale's due) == total
    //
    // A refund on a credit sale now settles what is owed before any cash is
    // handed over, so `due` falls without `paid` rising. The old equation
    // described a world with two ways for money to leave an invoice; there are
    // three. Inflating `paid` to preserve the old form was rejected because
    // `paid` is what `collected` reports as cash taken.
    //
    // Old rows are unaffected: appliedToDue defaults to 0, so the sum term
    // vanishes and the assertion reduces to exactly the previous equation.
    key: 'paidPlusDue',
    label: 'paid + due + refunds-applied-to-due equals the total on every sale',
    sql: () => `
      SELECT COUNT(*) AS n FROM sales s
       WHERE ABS((s.paid + s.due
                  + COALESCE((SELECT SUM(r.appliedToDue) FROM returns r WHERE r.saleId = s.id), 0)
                 ) - s.total) > ${EPS}`,
    needs: ['returns.appliedToDue'],
  },
  {
    key: 'appliedNeverExceedsRefund',
    label: 'no return settled more debt than it refunded',
    sql: () => `
      SELECT COUNT(*) AS n FROM returns
       WHERE appliedToDue > totalRefund + ${EPS} OR appliedToDue < -${EPS}`,
    needs: ['returns.appliedToDue'],
  },
  {
    key: 'noNegativeDue',
    label: 'no sale has been pushed into negative due by a return',
    sql: () => 'SELECT COUNT(*) AS n FROM sales WHERE due < -' + EPS,
  },
  {
    key: 'refundsWithinSale',
    label: 'no sale has been refunded more than it was sold for',
    sql: () => `
      SELECT COUNT(*) AS n FROM (
        SELECT s.id, s.total, COALESCE(SUM(r.totalRefund), 0) AS refunded
          FROM sales s JOIN returns r ON r.saleId = s.id
         GROUP BY s.id, s.total
        HAVING refunded > s.total + ${EPS}
      ) x`,
  },
  {
    key: 'noNegativeStock',
    label: 'no product sits at negative stock',
    sql: () => 'SELECT COUNT(*) AS n FROM products WHERE stock < 0',
  },
  {
    key: 'customerBalances',
    label: 'cached customer balances match their unpaid invoices',
    sql: () => `
      SELECT COUNT(*) AS n FROM (
        SELECT c.id
          FROM customers c
          LEFT JOIN sales s ON s.customerId = c.id
         GROUP BY c.id, c.dueAmount
        HAVING ABS(COALESCE(SUM(s.due), 0) - c.dueAmount) > ${EPS}
      ) x`,
  },
];

/** Which of the columns the checks depend on actually exist right now. */
async function availableColumns(sequelize) {
  const rows = await sequelize.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = :db`,
    { type: QueryTypes.SELECT, replacements: { db: sequelize.config.database } }
  );
  return new Set(rows.map((r) => `${r.t}.${r.c}`));
}

/**
 * Run the checks.
 *
 * @param {object}  sequelize
 * @param {object} [opts.range]  { start, end } — run the bounded variant where a
 *                               check has one, so the dashboard can afford it.
 */
async function checkDataIntegrity(sequelize, { range = null } = {}) {
  const have = await availableColumns(sequelize);
  const findings = [];

  for (const check of CHECKS) {
    if (check.needs && !check.needs.every((c) => have.has(c))) {
      // paidPlusDue is the one check that must never be skipped: before the
      // column exists the OLD equation is the correct one, so fall back to it
      // rather than reporting a clean bill of health on an unchecked table.
      if (check.key === 'paidPlusDue') {
        const [row] = await sequelize.query(
          `SELECT COUNT(*) AS n FROM sales WHERE ABS((paid + due) - total) > ${EPS}`,
          { type: QueryTypes.SELECT }
        );
        const count = Number(row?.n ?? 0);
        findings.push({ key: check.key, label: 'paid + due equals the total (pre-appliedToDue form)',
          ok: count === 0, count, scope: 'all' });
        continue;
      }
      findings.push({ key: check.key, label: check.label, ok: true, count: 0, skipped: 'column not present yet' });
      continue;
    }
    const useBounded = range && check.bounded;
    const sql = useBounded ? check.bounded(range) : check.sql();
    try {
      const [row] = await sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: useBounded ? { start: range.start, end: range.end } : {},
      });
      const count = Number(row?.n ?? 0);
      findings.push({ key: check.key, label: check.label, ok: count === 0, count, scope: useBounded ? 'range' : 'all' });
    } catch (err) {
      // A check that cannot run is not a clean bill of health — say so.
      findings.push({ key: check.key, label: check.label, ok: false, count: null, error: err.message });
    }
  }

  const problems = findings.filter((f) => !f.ok);
  return { ok: problems.length === 0, checked: findings.length, problems, findings };
}

/** Boot-time wrapper: never throws, but says so loudly when something is wrong. */
async function reportDataIntegrity(sequelize, { verbose = true } = {}) {
  try {
    const result = await checkDataIntegrity(sequelize);
    if (result.ok) {
      if (verbose) console.log(`🔎 Data integrity: ${result.checked} checks, all clean`);
      return result;
    }
    console.error(`❗ Data integrity: ${result.problems.length} of ${result.checked} checks FAILED`);
    for (const p of result.problems) {
      console.error(`   ✗ ${p.label} — ${p.error ? p.error : `${p.count} row(s) affected`}`);
    }
    console.error('   These are silent-money problems. Investigate before they compound.');
    return result;
  } catch (err) {
    console.error('⚠️  Data integrity check could not run:', err.message);
    return { ok: false, checked: 0, problems: [], findings: [], error: err.message };
  }
}

module.exports = { checkDataIntegrity, reportDataIntegrity };
