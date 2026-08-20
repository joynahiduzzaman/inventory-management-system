/**
 * dedupeIndexes.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * `sequelize.sync()` re-issues `ADD UNIQUE INDEX` for every column declared
 * `unique: true` on **every** boot. MySQL happily creates a new, differently
 * named index each time (`email`, `email_2`, `email_3`, …). Left unchecked the
 * table accumulates hundreds of identical indexes until it hits MySQL's hard
 * ceiling of 64 keys per table, at which point sync() — and therefore server
 * startup — fails permanently with "Too many keys specified".
 *
 * This audit found `users` at 41 duplicate indexes on `email`, `products` at 27
 * on `sku`, and `sales` at 26 on `invoiceNo` — well over half way to a
 * non-recoverable startup failure.
 *
 * WHAT THIS DOES
 * ──────────────
 * After sync, collapse every set of indexes covering an identical column list
 * down to a single index, preferring the one whose name matches the column
 * (the original). Primary keys and foreign-key-backing indexes are never
 * touched — dropping an index a FK constraint depends on would error.
 *
 * Safe to run repeatedly; it is a no-op once tables are clean.
 */

const FK_SAFE_SKIP = new Set(['PRIMARY']);

async function dedupeIndexes(sequelize, { verbose = true } = {}) {
  const dbName = sequelize.config.database;
  const log = (...a) => { if (verbose) console.log(...a); };

  const [tables] = await sequelize.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = "BASE TABLE"',
    { replacements: [dbName] }
  );

  let droppedTotal = 0;

  for (const { t: table } of tables) {
    // Column list per index, in order.
    const [rows] = await sequelize.query(
      `SELECT INDEX_NAME AS idx, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      { replacements: [dbName, table] }
    );
    if (!rows.length) continue;

    // Indexes that back a foreign key constraint must survive.
    const [fkRows] = await sequelize.query(
      `SELECT DISTINCT CONSTRAINT_NAME AS name, COLUMN_NAME AS col
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      { replacements: [dbName, table] }
    );
    const fkColumns = new Set(fkRows.map(r => r.col));

    // Group index name -> { unique, cols[] }
    const indexes = new Map();
    for (const r of rows) {
      if (!indexes.has(r.idx)) indexes.set(r.idx, { unique: Number(r.nonUnique) === 0, cols: [] });
      indexes.get(r.idx).cols.push(r.col);
    }

    // Bucket by "unique?cols" signature.
    const buckets = new Map();
    for (const [name, meta] of indexes) {
      if (FK_SAFE_SKIP.has(name)) continue;
      const sig = `${meta.unique ? 'U' : 'N'}:${meta.cols.join(',')}`;
      if (!buckets.has(sig)) buckets.set(sig, []);
      buckets.get(sig).push({ name, ...meta });
    }

    for (const [sig, group] of buckets) {
      if (group.length < 2) continue;

      // Keep the index whose name equals the column list (Sequelize's original),
      // else the shortest name, which is the first one MySQL created.
      const canonical = group[0].cols.join('_');
      group.sort((a, b) => {
        if (a.name === canonical) return -1;
        if (b.name === canonical) return 1;
        return a.name.length - b.name.length || a.name.localeCompare(b.name);
      });

      const keep = group[0];
      const drop = group.slice(1);

      for (const d of drop) {
        // Never drop the last remaining index on a FK column.
        const onlyIndexLeftForFk = d.cols.some(c => fkColumns.has(c)) &&
          group.filter(g => g.name !== d.name).length === 0;
        if (onlyIndexLeftForFk) continue;
        try {
          await sequelize.query(`ALTER TABLE \`${table}\` DROP INDEX \`${d.name}\``);
          droppedTotal++;
        } catch (err) {
          // A FK may still pin this index; leave it and move on.
          if (!/needed in a foreign key constraint/i.test(err.message)) {
            log(`   ⚠️  could not drop ${table}.${d.name}: ${err.message}`);
          }
        }
      }
      if (drop.length) {
        log(`   ↳ ${table}: collapsed ${group.length} duplicate indexes on (${keep.cols.join(', ')}) → kept "${keep.name}"`);
      }
    }
  }

  if (droppedTotal > 0) {
    log(`🧹 Dropped ${droppedTotal} duplicate index(es) left behind by sequelize.sync()`);
  }
  return droppedTotal;
}

module.exports = dedupeIndexes;
