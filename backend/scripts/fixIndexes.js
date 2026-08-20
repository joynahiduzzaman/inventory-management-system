/**
 * Standalone duplicate-index cleanup.
 *
 *     npm run db:fix-indexes
 *
 * The server already runs this on every boot, but it is exposed separately so
 * an existing database can be repaired without starting the app — useful if the
 * table has already hit MySQL's 64-key ceiling and sync() itself fails.
 *
 * See config/dedupeIndexes.js for why the duplicates accumulate.
 */
require('dotenv').config();
const sequelize = require('../config/database');
const dedupeIndexes = require('../config/dedupeIndexes');
const ensureIndexes = require('../config/ensureIndexes');

(async () => {
  try {
    await sequelize.authenticate();
    console.log(`Connected to ${process.env.DB_NAME}`);

    const before = await indexCount(sequelize);
    console.table(before);

    const dropped = await dedupeIndexes(sequelize);
    const added = await ensureIndexes(sequelize);

    if (dropped === 0 && added === 0) {
      console.log('✅ Indexes are already correct — nothing to do.');
    } else {
      console.log('\nAfter cleanup:');
      console.table(await indexCount(sequelize));
    }
    await sequelize.close();
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }
})();

async function indexCount(s) {
  const [rows] = await s.query(
    `SELECT TABLE_NAME AS tableName, COUNT(DISTINCT INDEX_NAME) AS indexes
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      GROUP BY TABLE_NAME
      ORDER BY indexes DESC`,
    { replacements: [process.env.DB_NAME] }
  );
  return rows;
}
