/**
 * ensureColumns.js
 *
 * `sequelize.sync({ alter: false })` creates tables that do not exist and then
 * leaves them alone forever. A column added to a model therefore never reaches
 * a database that already has the table — the model and the schema drift apart
 * silently, and the first symptom is a write failing in production.
 *
 * This adds missing columns explicitly. It is the same shape as ensureIndexes:
 * read information_schema, add what is absent, skip what is present, and never
 * touch a column that already exists — so it is safe to run on every boot and
 * safe to run against a database that is already correct.
 *
 * It deliberately does NOT alter or drop existing columns. Widening a type or
 * changing a default is a decision someone should make on purpose, with a
 * backup, not something a boot sequence does on its way past.
 */

const REQUIRED = [
  // ── Percentage discounts ────────────────────────────────────────────────
  //
  // `sales.discount` remains the resolved taka amount and remains the single
  // authority for every money calculation — refunds, reports, receipts.
  //
  // These two record what was actually agreed at the counter, which the taka
  // amount alone cannot express: "১৫% ছাড়" and "৳646 off" are the same number
  // on a ৳4,312 sale and a different promise. Nothing computes money from
  // them; recomputing a total from the rate disagrees with what the customer
  // paid on about 6% of sales, because the sale rounds at the discount and a
  // recomputation rounds at the total.
  //
  // Existing rows take mode='flat', rate=NULL, which is accurate: every
  // discount entered before this column existed was typed as taka.
  {
    table: 'sales',
    column: 'discountMode',
    definition: "ENUM('flat','percent') NOT NULL DEFAULT 'flat'",
    after: 'discount',
  },
  {
    table: 'sales',
    column: 'discountRate',
    definition: 'DECIMAL(5,2) NULL',
    after: 'discountMode',
  },
];

async function ensureColumns(sequelize, { verbose = true } = {}) {
  const dbName = sequelize.config.database;
  const log = (...a) => { if (verbose) console.log(...a); };

  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?`,
    { replacements: [dbName] }
  );

  const present = new Map();
  for (const r of rows) {
    if (!present.has(r.t)) present.set(r.t, new Set());
    present.get(r.t).add(r.c);
  }

  let added = 0;
  for (const col of REQUIRED) {
    const cols = present.get(col.table);
    if (!cols) continue;              // table does not exist yet; sync() will build it from the model
    if (cols.has(col.column)) continue;

    // AFTER is cosmetic and unsupported on some engines — try with it, then without.
    const base = `ALTER TABLE \`${col.table}\` ADD COLUMN \`${col.column}\` ${col.definition}`;
    try {
      await sequelize.query(col.after ? `${base} AFTER \`${col.after}\`` : base);
      log(`   ↳ added column ${col.table}.${col.column}`);
      added += 1;
    } catch (err) {
      if (/Duplicate column name/i.test(err.message)) continue;
      try {
        await sequelize.query(base);
        log(`   ↳ added column ${col.table}.${col.column}`);
        added += 1;
      } catch (err2) {
        log(`   ⚠️  could not add ${col.table}.${col.column}: ${err2.message}`);
      }
    }
  }

  if (added) log(`🧱 Added ${added} missing column(s)`);
  return added;
}

module.exports = ensureColumns;
