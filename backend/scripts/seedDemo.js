/**
 * seedDemo.js — realistic demo data for testing dashboards, reports and filters.
 *
 *   node scripts/seedDemo.js          # add demo data alongside whatever exists
 *   node scripts/seedDemo.js --reset  # delete previous demo data first
 *
 * Everything it creates is tagged so it can be removed again cleanly:
 *   - products  → SKU starts with "DEMO-"
 *   - customers → name ends with " (demo)"
 *   - sales     → note starts with "[demo]"
 *   - expenses  → note starts with "[demo]"
 *
 * It never touches rows it did not create, so it is safe to run against a
 * database that already holds real shop data.
 */

require('dotenv').config();
const {
  sequelize, Product, Category, Supplier, Customer,
  Sale, SaleItem, Expense, User, StockMovement,
} = require('../models');

const DEMO_SKU_PREFIX = 'DEMO-';
const DEMO_CUST_SUFFIX = ' (demo)';
const DEMO_NOTE = '[demo]';

const CATALOGUE = [
  // name, category, supplier, cost, price, openingStock, lowStockAlert, unit
  // Opening stock is sized so that after ~45 days of simulated selling the
  // catalogue lands on a realistic mix: mostly healthy, a handful low, a few out.
  ['Panadol Extra 500mg (strip of 10)', 'Medicine',    'Rahman Enterprises',   28,   35, 900, 40, 'strip'],
  ['Napa Extend 665mg (strip of 10)',   'Medicine',    'Rahman Enterprises',   22,   30, 700, 40, 'strip'],
  ['Savlon Antiseptic Liquid 250ml',    'Medicine',    'Rahman Enterprises',  145,  190, 180, 10, 'pcs'],
  ['Hand Sanitiser 100ml',              'Medicine',    'Rahman Enterprises',   55,   85,  60, 12, 'pcs'],

  ['USB-C Fast Charger 33W',            'Electronics', 'ABC Traders',         620,  899, 150,  8, 'pcs'],
  ['USB-C Cable 1m Braided',            'Electronics', 'ABC Traders',         110,  199, 600, 25, 'pcs'],
  ['Power Bank 10000mAh',               'Electronics', 'ABC Traders',        1180, 1650,  90,  5, 'pcs'],
  ['Bluetooth Earbuds TWS',             'Electronics', 'ABC Traders',         890, 1390,  55,  6, 'pcs'],
  ['LED Bulb 12W Daylight',             'Electronics', 'ABC Traders',          95,  145, 800, 30, 'pcs'],
  ['Extension Socket 4-way',            'Electronics', 'ABC Traders',         260,  380,  40,  6, 'pcs'],

  ['Fresh Soybean Oil 5L',              'Grocery',     'ABC Traders',         820,  910, 120,  8, 'pcs'],
  ['Miniket Rice 5kg',                  'Grocery',     'ABC Traders',         380,  445, 250, 15, 'bag'],
  ['Red Lentil (Masoor Dal) 1kg',       'Grocery',     'ABC Traders',         118,  145, 350, 20, 'kg'],
  ['Sugar 1kg',                         'Grocery',     'ABC Traders',         118,  138, 520, 25, 'kg'],
  ['Tea Bags 100pcs',                   'Grocery',     'ABC Traders',         210,  285,  70, 12, 'box'],
  ['Instant Noodles (pack of 8)',       'Grocery',     'ABC Traders',         130,  168, 300, 20, 'pack'],

  ['Cotton T-Shirt (M)',                'Clothing',    'Rahman Enterprises',  260,  495, 130,  8, 'pcs'],
  ['Denim Jeans (32)',                  'Clothing',    'Rahman Enterprises',  780, 1290,  70,  5, 'pcs'],
  ['Cotton Socks (pair)',               'Clothing',    'Rahman Enterprises',   55,   99,  70, 10, 'pair'],

  ['A4 Paper Ream 500 sheets',          'Stationery',  'ABC Traders',         390,  470, 110,  6, 'ream'],
  ['Ball Pen Blue (box of 10)',         'Stationery',  'ABC Traders',          62,   95, 450, 20, 'box'],
  ['Notebook 200 pages',                'Stationery',  'ABC Traders',          48,   80, 260, 15, 'pcs'],

  // Deliberately left at/near zero so out-of-stock and low-stock UI has data.
  ['Stapler Medium',                    'Stationery',  'ABC Traders',         135,  210,   4,  6, 'pcs'],
  ['Wall Clock Silent',                 'Electronics', 'ABC Traders',         340,  520,   0,  4, 'pcs'],
];

const CUSTOMERS = [
  ['Karim Uddin',      '01712345601', 'karim.uddin@example.com',  'Mirpur 10, Dhaka'],
  ['Nusrat Jahan',     '01812345602', 'nusrat.j@example.com',     'Dhanmondi 27, Dhaka'],
  ['Abdul Rahim',      '01912345603', null,                       'Gulshan 2, Dhaka'],
  ['Shirin Akter',     '01612345604', 'shirin.akter@example.com', 'Uttara Sector 7, Dhaka'],
  ['Mohammad Faruk',   '01512345605', null,                       'Bashundhara R/A, Dhaka'],
  ['Tanvir Hasan',     '01722345606', 'tanvir.h@example.com',     'Mohakhali, Dhaka'],
];

const EXPENSE_KINDS = [
  ['Shop rent',          'Rent',       9000],
  ['Electricity bill',   'Utilities',  1900],
  ['Staff salary',       'Salary',    11000],
  ['Internet bill',      'Utilities',   900],
  ['Delivery fuel',      'Transport',  1400],
  ['Packaging supplies', 'Supplies',    700],
];

const PAYMENT_METHODS = ['cash', 'cash', 'cash', 'bkash', 'bkash', 'nagad', 'card'];

// Deterministic PRNG so repeated runs produce comparable-looking data.
let seed = 20260819;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

async function reset() {
  console.log('🧹 Removing previous demo data…');
  const demoProducts = await Product.findAll({ where: { sku: { [require('sequelize').Op.like]: `${DEMO_SKU_PREFIX}%` } } });
  const pids = demoProducts.map(p => p.id);

  const demoSales = await Sale.findAll({ where: { note: { [require('sequelize').Op.like]: `${DEMO_NOTE}%` } } });
  const sids = demoSales.map(s => s.id);

  if (sids.length) {
    await sequelize.query('DELETE ri FROM return_items ri JOIN returns r ON ri.returnId=r.id WHERE r.saleId IN (:sids)', { replacements: { sids } });
    await sequelize.query('DELETE FROM returns WHERE saleId IN (:sids)', { replacements: { sids } });
    await SaleItem.destroy({ where: { saleId: sids } });
    await Sale.destroy({ where: { id: sids } });
  }
  if (pids.length) {
    await StockMovement.destroy({ where: { productId: pids } });
    await Product.destroy({ where: { id: pids } });
  }
  await Customer.destroy({ where: { name: { [require('sequelize').Op.like]: `%${DEMO_CUST_SUFFIX}` } } });
  await Expense.destroy({ where: { note: { [require('sequelize').Op.like]: `${DEMO_NOTE}%` } } });
  console.log(`   removed ${pids.length} products, ${sids.length} sales`);
}

async function main() {
  const doReset = process.argv.includes('--reset');
  await sequelize.authenticate();
  await sequelize.sync({ force: false });

  if (doReset) await reset();

  const admin = await User.findOne({ where: { role: 'admin' } });
  if (!admin) { console.error('❌ No admin user — start the server once first.'); process.exit(1); }

  // ── Categories & suppliers ────────────────────────────────────────────────
  const catNames = [...new Set(CATALOGUE.map(c => c[1]))];
  const catMap = {};
  for (const name of catNames) {
    const [c] = await Category.findOrCreate({ where: { name }, defaults: { description: `${name} products` } });
    catMap[name] = c.id;
  }
  const supNames = [...new Set(CATALOGUE.map(c => c[2]))];
  const supMap = {};
  for (const name of supNames) {
    const [s] = await Supplier.findOrCreate({
      where: { name },
      defaults: { company: name, phone: `0171100000${Object.keys(supMap).length + 1}`, address: 'Dhaka, Bangladesh' },
    });
    supMap[name] = s.id;
  }

  // ── Products ──────────────────────────────────────────────────────────────
  const products = [];
  let n = 1000;
  for (const [name, cat, sup, cost, price, stock, low, unit] of CATALOGUE) {
    const sku = `${DEMO_SKU_PREFIX}${String(n).padStart(4, '0')}`;
    const barcode = `880${String(n).padStart(9, '0')}`;
    n++;
    const existing = await Product.findOne({ where: { sku } });
    if (existing) { products.push(existing); continue; }

    const p = await Product.create({
      name, sku, barcode,
      categoryId: catMap[cat], supplierId: supMap[sup],
      cost, price, stock, lowStockAlert: low, unit,
      description: `${name} — demo catalogue item`,
      isActive: true,
    });
    if (stock > 0) {
      await StockMovement.create({
        productId: p.id, productName: p.name, type: 'initial',
        quantity: stock, stockBefore: 0, stockAfter: stock,
        reference: 'Opening stock', note: 'Demo seed',
        userId: admin.id, userName: admin.name,
      });
    }
    products.push(p);
  }
  console.log(`✅ ${products.length} demo products`);

  // ── Customers ─────────────────────────────────────────────────────────────
  const customers = [];
  for (const [name, phone, email, address] of CUSTOMERS) {
    const [c] = await Customer.findOrCreate({
      where: { name: name + DEMO_CUST_SUFFIX },
      defaults: { phone, email, address },
    });
    customers.push(c);
  }
  console.log(`✅ ${customers.length} demo customers`);

  // ── Sales spread over the last 45 days ────────────────────────────────────
  // Written with the same arithmetic the API uses, and stock is drawn down
  // through the ledger, so dashboards and the audit trail stay consistent.
  const DAYS = 45;
  let salesMade = 0, itemsSold = 0;

  for (let d = DAYS; d >= 0; d--) {
    // Busier at weekends (Fri/Sat in BD), quieter midweek.
    const when = new Date(Date.now() - d * 86400000);
    const dow = when.getDay();
    const base = (dow === 5 || dow === 6) ? between(6, 11) : between(2, 7);

    for (let k = 0; k < base; k++) {
      const lineCount = between(1, 4);
      const chosen = new Map();
      for (let i = 0; i < lineCount; i++) {
        const p = pick(products);
        if (p.stock <= 0) continue;
        const qty = Math.min(between(1, 4), p.stock - (chosen.get(p.id)?.qty || 0));
        if (qty <= 0) continue;
        chosen.set(p.id, { product: p, qty: (chosen.get(p.id)?.qty || 0) + qty });
      }
      if (chosen.size === 0) continue;

      const t = await sequelize.transaction();
      try {
        let subtotal = 0;
        const lines = [];
        for (const { product, qty } of chosen.values()) {
          const fresh = await Product.findByPk(product.id, { transaction: t, lock: t.LOCK.UPDATE });
          if (!fresh || fresh.stock < qty) continue;
          const price = parseFloat(fresh.price);
          const total = Math.round(price * qty * 100) / 100;
          subtotal += total;
          lines.push({ fresh, qty, price, cost: parseFloat(fresh.cost), total });
        }
        if (!lines.length) { await t.rollback(); continue; }

        subtotal = Math.round(subtotal * 100) / 100;
        const discount = rnd() < 0.25 ? Math.min(Math.round(subtotal * 0.05), subtotal) : 0;
        const total = Math.round((subtotal - discount) * 100) / 100;

        // 1 in 8 sales goes partly on credit, so the Due workflow has data.
        const onCredit = rnd() < 0.125;
        const paid = onCredit ? Math.round(total * 0.4 * 100) / 100 : total;
        const due  = Math.round((total - paid) * 100) / 100;

        const useCustomer = onCredit || rnd() < 0.45;
        const customer = useCustomer ? pick(customers) : null;

        const ts = new Date(when);
        ts.setHours(between(9, 21), between(0, 59), between(0, 59), 0);

        const ymd = `${ts.getFullYear().toString().slice(-2)}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}`;
        const seq = String(++salesMade).padStart(4, '0');

        const sale = await Sale.create({
          invoiceNo: `INV-${ymd}-D${seq}`,
          customerId: customer ? customer.id : null,
          userId: admin.id,
          subtotal, discount, tax: 0, total, paid, due,
          paymentMethod: pick(PAYMENT_METHODS),
          status: 'completed',
          note: `${DEMO_NOTE} generated sale`,
          createdAt: ts, updatedAt: ts,
        }, { transaction: t, silent: true });

        for (const l of lines) {
          await SaleItem.create({
            saleId: sale.id, productId: l.fresh.id, productName: l.fresh.name,
            quantity: l.qty, price: l.price, cost: l.cost, total: l.total,
            createdAt: ts, updatedAt: ts,
          }, { transaction: t, silent: true });

          const before = l.fresh.stock;
          await l.fresh.update({ stock: before - l.qty }, { transaction: t });
          await StockMovement.create({
            productId: l.fresh.id, productName: l.fresh.name, type: 'sale',
            quantity: -l.qty, stockBefore: before, stockAfter: before - l.qty,
            reference: sale.invoiceNo, note: 'Demo seed sale',
            userId: admin.id, userName: admin.name, createdAt: ts,
          }, { transaction: t, silent: true });
          itemsSold += l.qty;
        }

        if (customer) {
          await customer.update({
            totalPurchase: Math.round((parseFloat(customer.totalPurchase || 0) + total) * 100) / 100,
            dueAmount: Math.round((parseFloat(customer.dueAmount || 0) + due) * 100) / 100,
          }, { transaction: t });
        }

        await t.commit();
      } catch (err) {
        await t.rollback();
      }
    }
  }
  console.log(`✅ ${salesMade} demo sales covering ${itemsSold} units over ${DAYS} days`);

  // ── Expenses for the last two months ──────────────────────────────────────
  let expCount = 0;
  for (let m = 1; m >= 0; m--) {
    const d = new Date();
    d.setMonth(d.getMonth() - m, 5);
    for (const [title, category, amount] of EXPENSE_KINDS) {
      const date = new Date(d);
      date.setDate(between(1, 26));
      const iso = date.toISOString().slice(0, 10);
      const [, created] = await Expense.findOrCreate({
        where: { title, date: iso },
        defaults: {
          category,
          amount: Math.round(amount * (0.9 + rnd() * 0.2)),
          note: `${DEMO_NOTE} recurring expense`,
          userId: admin.id,
        },
      });
      if (created) expCount++;
    }
  }
  console.log(`✅ ${expCount} demo expenses`);

  const [[val]] = await sequelize.query(
    'SELECT COUNT(*) products, COALESCE(SUM(stock*price),0) retail FROM products WHERE isActive=1'
  );
  console.log(`\n📊 Active catalogue: ${val.products} products, retail value ৳${Number(val.retail).toLocaleString()}`);
  console.log('🎉 Demo data ready. Reload the dashboard.');

  await sequelize.close();
}

main().catch(async (e) => { console.error('❌', e); process.exit(1); });
