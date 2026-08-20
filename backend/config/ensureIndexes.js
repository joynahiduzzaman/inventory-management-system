/**
 * ensureIndexes.js
 *
 * `sequelize.sync()` only applies index definitions when it creates a table, so
 * tables that already exist never gain them. The `returns` / `return_items`
 * tables were originally created by a hand-written script and ended up with no
 * index at all on the columns every report joins and filters on:
 *
 *   - return_items.saleItemId  → joined on every COGS / top-product / profit
 *     query and summed in getReturnableItems; without an index each one is a
 *     full table scan that gets slower with every refund the shop processes.
 *   - returns.saleId, returns.createdAt → filtered on constantly.
 *   - sales.createdAt, sale_items.productId → the reporting hot path.
 *
 * Adding an index is safe and idempotent: we check first and skip if present.
 */

const REQUIRED = [
  { table: 'return_items', name: 'ri_sale_item', columns: ['saleItemId'] },
  { table: 'return_items', name: 'ri_product',   columns: ['productId'] },
  { table: 'returns',      name: 'ret_sale',     columns: ['saleId'] },
  { table: 'returns',      name: 'ret_created',  columns: ['createdAt'] },
  { table: 'sales',        name: 'sales_created', columns: ['createdAt'] },
  { table: 'sales',        name: 'sales_due',     columns: ['due'] },
  { table: 'sale_items',   name: 'si_product',    columns: ['productId'] },
  { table: 'products',     name: 'prod_active_stock', columns: ['isActive', 'stock'] },
  { table: 'products',     name: 'prod_name',     columns: ['name'] },
  { table: 'expenses',     name: 'exp_date',      columns: ['date'] },
];

async function ensureIndexes(sequelize, { verbose = true } = {}) {
  const dbName = sequelize.config.database;
  const log = (...a) => { if (verbose) console.log(...a); };

  const [existing] = await sequelize.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i, COLUMN_NAME AS c, SEQ_IN_INDEX AS s
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?`,
    { replacements: [dbName] }
  );

  // Map "table" -> Set of "col1,col2" already covered by some index (as a prefix).
  const covered = new Map();
  const byIndex = new Map();
  for (const r of existing) {
    const key = `${r.t}::${r.i}`;
    if (!byIndex.has(key)) byIndex.set(key, { table: r.t, cols: [] });
    byIndex.get(key).cols.push(r.c);
  }
  for (const { table, cols } of byIndex.values()) {
    if (!covered.has(table)) covered.set(table, new Set());
    // An index on (a,b) also serves lookups on (a).
    for (let n = 1; n <= cols.length; n++) covered.get(table).add(cols.slice(0, n).join(','));
  }

  const [tables] = await sequelize.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    { replacements: [dbName] }
  );
  const tableSet = new Set(tables.map(r => r.t));

  let added = 0;
  for (const idx of REQUIRED) {
    if (!tableSet.has(idx.table)) continue;
    const sig = idx.columns.join(',');
    if (covered.get(idx.table)?.has(sig)) continue;
    try {
      await sequelize.query(
        `ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` (${idx.columns.map(c => `\`${c}\``).join(', ')})`
      );
      log(`   ↳ added index ${idx.table}(${sig})`);
      added++;
    } catch (err) {
      if (!/Duplicate key name/i.test(err.message)) {
        log(`   ⚠️  could not add index on ${idx.table}(${sig}): ${err.message}`);
      }
    }
  }

  if (added) log(`⚡ Added ${added} missing index(es) on reporting hot paths`);
  return added;
}

module.exports = ensureIndexes;
