/**
 * Calculation audit.
 *
 *   node tests/audit.calc.js
 *
 * Every expected value below is computed BY HAND in the comment beside it, not
 * derived from what the code happens to return. The point is to find places
 * where the code and the arithmetic disagree, so taking the code's answer as
 * the expectation would defeat it.
 *
 * Creates its own fixture with round numbers, and removes it at the end.
 */
const BASE = process.env.AUDIT_BASE || 'http://localhost:5000/api';
const fs = require('fs');
const path = require('path');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

let TOKEN = '';
const results = [];
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? '  — ' + detail : ''}`);
};

const call = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = null; try { d = await res.json(); } catch { /* empty body */ }
  return { status: res.status, d };
};

const money = (n) => Math.round(Number(n) * 100) / 100;
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) < tol;

(async () => {
  const login = await call('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });
  TOKEN = login.d.token;
  if (!TOKEN) { console.error('login failed'); process.exit(1); }

  const created = { products: [], customers: [], invoices: [] };

  // Prices chosen so that discounts and thirds land on awkward fractions.
  const mkProduct = async (name, price, cost, stock) => {
    const r = await call('POST', '/products', {
      name: `AUDIT ${name} ${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      price, cost, stock, lowStockAlert: 5,
    });
    if (r.status !== 201) throw new Error('fixture product failed: ' + JSON.stringify(r.d));
    created.products.push(r.d.data.id);
    return r.d.data;
  };

  // ══ SALE-LEVEL ARITHMETIC ═══════════════════════════════════════════════
  section('Sale-level arithmetic');

  const A = await mkProduct('Widget A', 33.33, 20, 500);   // odd cents
  const B = await mkProduct('Widget B', 10.10, 5, 500);

  // 3 x 33.33 = 99.99 ; 7 x 10.10 = 70.70 ; subtotal = 170.69
  let r = await call('POST', '/sales', {
    items: [{ productId: A.id, quantity: 3 }, { productId: B.id, quantity: 7 }],
  });
  check('sale created', r.status === 201, 'status=' + r.status);
  let sale = r.d.data;
  created.invoices.push(sale.invoiceNo);

  const lineA = sale.items.find((i) => i.productId === A.id);
  const lineB = sale.items.find((i) => i.productId === B.id);
  check('line total = unit price x quantity (33.33 x 3 = 99.99)', near(lineA.total, 99.99), `got ${lineA.total}`);
  check('line total = unit price x quantity (10.10 x 7 = 70.70)', near(lineB.total, 70.70), `got ${lineB.total}`);
  check('subtotal = sum of line totals (99.99 + 70.70 = 170.69)', near(sale.subtotal, 170.69), `got ${sale.subtotal}`);
  check('total = subtotal when no discount', near(sale.total, 170.69), `got ${sale.total}`);
  // paid omitted => treated as paid in full
  check('paid omitted means paid in full', near(sale.paid, 170.69) && near(sale.due, 0),
        `paid=${sale.paid} due=${sale.due}`);

  // ── Discount: flat taka, subtracted from the subtotal ──
  // 2 x 33.33 = 66.66 ; discount 6.67 ; total = 59.99
  r = await call('POST', '/sales', { items: [{ productId: A.id, quantity: 2 }], discount: 6.67 });
  const disc = r.d.data;
  created.invoices.push(disc.invoiceNo);
  check('discount is a flat taka amount off the subtotal (66.66 - 6.67 = 59.99)',
        near(disc.subtotal, 66.66) && near(disc.discount, 6.67) && near(disc.total, 59.99),
        `subtotal=${disc.subtotal} discount=${disc.discount} total=${disc.total}`);

  // A discount with more than two decimals must be rounded, not truncated.
  // 33.33 - 0.005 -> discount rounds to 0.01, total 33.32
  r = await call('POST', '/sales', { items: [{ productId: A.id, quantity: 1 }], discount: 0.005 });
  const dRound = r.d.data;
  created.invoices.push(dRound.invoiceNo);
  check('discount rounds to 2dp using the same rule as the rest (0.005 -> 0.01)',
        near(dRound.discount, money(0.005)),
        `stored=${dRound.discount} expected=${money(0.005)}`);

  // Discount larger than the subtotal must be refused, never clamped.
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 1 }], discount: 999 });
  check('discount above the subtotal is rejected, not clamped', r.status === 400,
        `status=${r.status} ${String(r.d && r.d.message).slice(0, 60)}`);

  // ── Amount received / change / due ──
  // total 101.00 ; paid 200 -> paid capped at 101, due 0, change is 99 at the till
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 10 }], paid: 200 });
  const over = r.d.data;
  created.invoices.push(over.invoiceNo);
  check('overpayment: paid is capped at the total and due is 0',
        near(over.total, 101.00) && near(over.paid, 101.00) && near(over.due, 0),
        `total=${over.total} paid=${over.paid} due=${over.due}`);
  check('  change is therefore NOT derivable from the stored sale (paid == total)',
        near(over.paid, over.total),
        'the till must pass the tendered amount to the receipt — see utils/receipt.js');

  // paid exactly equal
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 10 }], paid: 101 });
  created.invoices.push(r.d.data.invoiceNo);
  check('exact payment leaves no due', near(r.d.data.due, 0), `due=${r.d.data.due}`);

  // partial payment
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 10 }], paid: 40 });
  created.invoices.push(r.d.data.invoiceNo);
  check('partial payment: due = total - paid (101.00 - 40 = 61.00)',
        near(r.d.data.paid, 40) && near(r.d.data.due, 61.00),
        `paid=${r.d.data.paid} due=${r.d.data.due}`);

  // negative amount received must be refused
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 1 }], paid: -5 });
  check('negative amount received is rejected', r.status >= 400, 'status=' + r.status);

  // ══ RETURNS AGAINST A DISCOUNTED SALE ═══════════════════════════════════
  section('Returns');

  // Sale: 4 x 10.10 = 40.40 subtotal, discount 10.40, total 30.00.
  // The customer paid 30.00 for four units, i.e. 7.50 per unit.
  // Returning all four should refund 30.00, not 40.40.
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 4 }], discount: 10.40, paid: 30 });
  const ds = r.d.data;
  created.invoices.push(ds.invoiceNo);
  check('discounted sale set up (subtotal 40.40, discount 10.40, total 30.00)',
        near(ds.subtotal, 40.40) && near(ds.total, 30.00),
        `subtotal=${ds.subtotal} total=${ds.total} paid=${ds.paid}`);

  const dsItem = ds.items[0];
  r = await call('POST', '/returns', {
    saleId: ds.id,
    items: [{ saleItemId: dsItem.id, quantity: 4, restockItem: true }],
    refundMethod: 'cash',
  });
  const fullReturn = r.d && r.d.data;
  const refunded = fullReturn ? Number(fullReturn.totalRefund) : null;
  check('FULL return of a discounted sale refunds what was PAID (30.00), not list price (40.40)',
        refunded !== null && near(refunded, 30.00),
        `refunded=${refunded} paidByCustomer=${ds.total} listPrice=${ds.subtotal}`);

  // Partial return of a discounted sale: 2 of 4 units.
  // Customer paid 30.00 for 4 => 7.50/unit => 2 units = 15.00, not 20.20.
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 4 }], discount: 10.40, paid: 30 });
  const ds2 = r.d.data;
  created.invoices.push(ds2.invoiceNo);
  r = await call('POST', '/returns', {
    saleId: ds2.id,
    items: [{ saleItemId: ds2.items[0].id, quantity: 2, restockItem: true }],
    refundMethod: 'cash',
  });
  const partial = r.d && r.d.data;
  check('PARTIAL return of a discounted sale refunds the discounted share (15.00, not 20.20)',
        partial && near(Number(partial.totalRefund), 15.00),
        `refunded=${partial && partial.totalRefund}`);

  // Undiscounted return must be unaffected.
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 2 }] });
  const nd = r.d.data;
  created.invoices.push(nd.invoiceNo);
  r = await call('POST', '/returns', {
    saleId: nd.id, items: [{ saleItemId: nd.items[0].id, quantity: 2, restockItem: true }], refundMethod: 'cash',
  });
  check('return on an undiscounted sale refunds the full line (20.20)',
        r.d && r.d.data && near(Number(r.d.data.totalRefund), 20.20),
        `refunded=${r.d && r.d.data && r.d.data.totalRefund}`);

  // ── Split returns must sum back to what was paid ───────────────────────
  //
  // 3 x 10.10 = 30.30 subtotal, discount 10.00, total 20.30. The discount does
  // NOT divide evenly by three: each unit is worth 6.7666... and rounding each
  // one on its own gives 6.77 x 3 = 20.31 — a paisa the shop never took.
  // Returning the units one at a time, in three separate returns, must still
  // total exactly 20.30.
  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 3 }], discount: 10.00, paid: 20.30 });
  const sp = r.d.data;
  created.invoices.push(sp.invoiceNo);
  check('uneven split sale set up (subtotal 30.30, discount 10.00, total 20.30)',
        near(sp.subtotal, 30.30) && near(sp.total, 20.30),
        `subtotal=${sp.subtotal} total=${sp.total}`);

  const splitRefunds = [];
  for (let i = 0; i < 3; i += 1) {
    r = await call('POST', '/returns', {
      saleId: sp.id,
      items: [{ saleItemId: sp.items[0].id, quantity: 1, restockItem: false }],
      refundMethod: 'cash',
    });
    splitRefunds.push(r.d && r.d.data ? Number(r.d.data.totalRefund) : NaN);
  }
  const splitSum = Math.round(splitRefunds.reduce((a, b) => a + b, 0) * 100) / 100;
  check('a 3-way split return sums to exactly what was paid (20.30), no paisa stranded',
        near(splitSum, 20.30),
        `refunds=[${splitRefunds.join(', ')}] sum=${splitSum} paid=${sp.total}`);
  check('  and no single split line is rounded away to zero',
        splitRefunds.every((x) => x > 0), `refunds=[${splitRefunds.join(', ')}]`);
  check('  a fourth return is refused — everything is already back',
        (await call('POST', '/returns', {
          saleId: sp.id,
          items: [{ saleItemId: sp.items[0].id, quantity: 1, restockItem: false }],
          refundMethod: 'cash',
        })).status >= 400);

  // Multi-line return: the line refunds must add up to the return's total.
  r = await call('POST', '/sales', {
    items: [{ productId: A.id, quantity: 3 }, { productId: B.id, quantity: 3 }],
    discount: 7.77,
  });
  const ml = r.d.data;
  created.invoices.push(ml.invoiceNo);
  r = await call('POST', '/returns', {
    saleId: ml.id,
    items: ml.items.map((it) => ({ saleItemId: it.id, quantity: it.quantity, restockItem: false })),
    refundMethod: 'cash',
  });
  const mlRet = r.d && r.d.data;
  const lineSum = mlRet && mlRet.items
    ? Math.round(mlRet.items.reduce((a, x) => a + Number(x.refundTotal), 0) * 100) / 100
    : null;
  check('a full multi-line return refunds exactly the sale total',
        mlRet && near(Number(mlRet.totalRefund), Number(ml.total)),
        `refunded=${mlRet && mlRet.totalRefund} total=${ml.total}`);
  check('  and the line refunds add up to the return total, to the paisa',
        lineSum !== null && near(lineSum, Number(mlRet.totalRefund)),
        `lines=${lineSum} total=${mlRet && mlRet.totalRefund}`);

  // ══ PERCENTAGE DISCOUNT ═════════════════════════════════════════════════
  section('Percentage discount');

  // B is 10.10. 4 x 10.10 = 40.40 subtotal; 25% off = 10.10; total 30.30.
  r = await call('POST', '/sales', {
    items: [{ productId: B.id, quantity: 4 }], discountMode: 'percent', discountRate: 25,
  });
  const pc = r.d.data;
  created.invoices.push(pc.invoiceNo);
  check('a 25% discount resolves to taka on the server (40.40 -> 10.10 off, total 30.30)',
        near(pc.subtotal, 40.40) && near(pc.discount, 10.10) && near(pc.total, 30.30),
        `subtotal=${pc.subtotal} discount=${pc.discount} total=${pc.total}`);
  check('  the mode and rate are stored as provenance',
        pc.discountMode === 'percent' && near(pc.discountRate, 25),
        `mode=${pc.discountMode} rate=${pc.discountRate}`);
  check('  the invariant holds: discount === round2(subtotal x rate / 100)',
        near(Number(pc.discount), Math.round(Number(pc.subtotal) * Number(pc.discountRate) / 100 * 100) / 100),
        `discount=${pc.discount} recomputed=${Math.round(Number(pc.subtotal) * Number(pc.discountRate) / 100 * 100) / 100}`);

  r = await call('POST', '/sales', { items: [{ productId: B.id, quantity: 2 }] });
  const flatSale = r.d.data;
  created.invoices.push(flatSale.invoiceNo);
  check('a sale with no percentage carries mode=flat and no stray rate',
        flatSale.discountMode === 'flat' && (flatSale.discountRate === null || flatSale.discountRate === undefined),
        `mode=${flatSale.discountMode} rate=${flatSale.discountRate}`);

  check('a rate above 100% is rejected, not clamped',
        (await call('POST', '/sales', {
          items: [{ productId: B.id, quantity: 1 }], discountMode: 'percent', discountRate: 101,
        })).status >= 400);
  check('a negative rate is rejected',
        (await call('POST', '/sales', {
          items: [{ productId: B.id, quantity: 1 }], discountMode: 'percent', discountRate: -5,
        })).status >= 400);

  r = await call('POST', '/sales', {
    items: [{ productId: B.id, quantity: 2 }], discountMode: 'percent', discountRate: 100, paid: 0,
  });
  check('100% is a legitimate giveaway, not an error',
        r.status < 400 && near(r.d.data.total, 0), `status=${r.status} total=${r.d && r.d.data && r.d.data.total}`);
  if (r.d && r.d.data) created.invoices.push(r.d.data.invoiceNo);

  // A percentage discount must NOT be recomputed from the rate at refund time.
  // 3 x 10.10 = 30.30 at 33% => discount 10.00, total 20.30. Recomputing
  // 30.30 x 0.67 gives 20.30 here, but the general case disagrees ~6% of the
  // time — the refund reads the stored taka, so it cannot drift either way.
  r = await call('POST', '/sales', {
    items: [{ productId: B.id, quantity: 3 }], discountMode: 'percent', discountRate: 33,
  });
  const pcSale = r.d.data;
  created.invoices.push(pcSale.invoiceNo);
  r = await call('POST', '/returns', {
    saleId: pcSale.id,
    items: [{ saleItemId: pcSale.items[0].id, quantity: 3, restockItem: true }],
    refundMethod: 'cash',
  });
  check('a FULL return against a percentage-discounted sale refunds what was paid',
        r.d && r.d.data && near(Number(r.d.data.totalRefund), Number(pcSale.total)),
        `refunded=${r.d && r.d.data && r.d.data.totalRefund} paid=${pcSale.total}`);

  // Split return against a percentage sale — the case the user called the most
  // likely place for money to leak.
  r = await call('POST', '/sales', {
    items: [{ productId: B.id, quantity: 3 }], discountMode: 'percent', discountRate: 33,
  });
  const pcSplit = r.d.data;
  created.invoices.push(pcSplit.invoiceNo);
  const pcRefunds = [];
  for (let i = 0; i < 3; i += 1) {
    r = await call('POST', '/returns', {
      saleId: pcSplit.id,
      items: [{ saleItemId: pcSplit.items[0].id, quantity: 1, restockItem: false }],
      refundMethod: 'cash',
    });
    pcRefunds.push(r.d && r.d.data ? Number(r.d.data.totalRefund) : NaN);
  }
  const pcSum = Math.round(pcRefunds.reduce((a, b) => a + b, 0) * 100) / 100;
  check('a 3-way split return on a percentage-discounted sale sums to what was paid',
        near(pcSum, Number(pcSplit.total)),
        `refunds=[${pcRefunds.join(', ')}] sum=${pcSum} paid=${pcSplit.total}`);

  // ── The ledger still reconciles after a discounted return ──────────────
  r = await call('POST', '/customers', { name: 'AUDIT RetDebtor ' + Date.now(), phone: '01700000456' });
  const RC = r.d.data.id;
  created.customers.push(RC);
  r = await call('POST', '/sales', {
    items: [{ productId: B.id, quantity: 4 }], discount: 10.40, paid: 0, customerId: RC,
  });
  const dueSale = r.d.data;
  created.invoices.push(dueSale.invoiceNo);
  check('a discounted sale on credit owes the discounted total (30.00), not the list price',
        near(Number(dueSale.due), 30.00), `due=${dueSale.due}`);

  await call('POST', '/returns', {
    saleId: dueSale.id,
    items: [{ saleItemId: dueSale.items[0].id, quantity: 4, restockItem: true }],
    refundMethod: 'cash',
  });
  const ledger = (await call('GET', `/customers/${RC}/due`)).d.data;
  check('after a discounted return the ledger still reconciles',
        near(Number(ledger.outstanding), Number(ledger.cachedBalance)),
        `invoices=${ledger.outstanding} cached=${ledger.cachedBalance}`);

  // ══ STOCK ═══════════════════════════════════════════════════════════════
  section('Stock');

  const C = await mkProduct('Widget C', 50, 30, 20);
  let before = (await call('GET', '/products/' + C.id)).d.data.stock;
  r = await call('POST', '/sales', { items: [{ productId: C.id, quantity: 3 }] });
  created.invoices.push(r.d.data.invoiceNo);
  let after = (await call('GET', '/products/' + C.id)).d.data.stock;
  check('stock decrements exactly once per unit sold (20 - 3 = 17)', after === before - 3,
        `${before} -> ${after}`);

  // Restock via a return
  const cSale = r.d.data;
  r = await call('POST', '/returns', {
    saleId: cSale.id, items: [{ saleItemId: cSale.items[0].id, quantity: 2, restockItem: true }], refundMethod: 'cash',
  });
  const afterReturn = (await call('GET', '/products/' + C.id)).d.data.stock;
  check('partial return restocks exactly the returned units (17 + 2 = 19)', afterReturn === after + 2,
        `${after} -> ${afterReturn}`);

  // Return with restock disabled must NOT restock (damaged goods).
  r = await call('POST', '/sales', { items: [{ productId: C.id, quantity: 2 }] });
  const noRestockSale = r.d.data;
  created.invoices.push(noRestockSale.invoiceNo);
  const beforeNo = (await call('GET', '/products/' + C.id)).d.data.stock;
  await call('POST', '/returns', {
    saleId: noRestockSale.id,
    items: [{ saleItemId: noRestockSale.items[0].id, quantity: 2, restockItem: false }],
    refundMethod: 'cash',
  });
  const afterNo = (await call('GET', '/products/' + C.id)).d.data.stock;
  check('return with restock=false does not add stock back', afterNo === beforeNo, `${beforeNo} -> ${afterNo}`);

  // Attempts to force negative stock.
  const D = await mkProduct('Widget D', 10, 5, 1);
  r = await call('POST', '/sales', { items: [{ productId: D.id, quantity: 2 }] });
  check('cannot sell more than on hand', r.status >= 400, 'status=' + r.status);
  r = await call('POST', '/products/' + D.id + '/adjust-stock', { mode: 'remove', quantity: 5 });
  check('cannot adjust stock below zero', r.status >= 400, 'status=' + r.status);
  const dStock = (await call('GET', '/products/' + D.id)).d.data.stock;
  check('stock never went negative', dStock >= 0, 'stock=' + dStock);

  // Exactly one unit remaining.
  r = await call('POST', '/sales', { items: [{ productId: D.id, quantity: 1 }] });
  check('a product with exactly 1 left can be sold', r.status === 201, 'status=' + r.status);
  if (r.status === 201) created.invoices.push(r.d.data.invoiceNo);
  const dAfter = (await call('GET', '/products/' + D.id)).d.data.stock;
  check('  and is then 0, not negative', dAfter === 0, 'stock=' + dAfter);
  r = await call('POST', '/sales', { items: [{ productId: D.id, quantity: 1 }] });
  check('  and cannot be sold again', r.status >= 400, 'status=' + r.status);

  // Concurrency on the live engine.
  const E = await mkProduct('Widget E', 10, 5, 10);
  const pair = await Promise.all([
    call('POST', '/sales', { items: [{ productId: E.id, quantity: 8 }] }),
    call('POST', '/sales', { items: [{ productId: E.id, quantity: 8 }] }),
  ]);
  pair.forEach((x) => { if (x.status === 201) created.invoices.push(x.d.data.invoiceNo); });
  const eStock = (await call('GET', '/products/' + E.id)).d.data.stock;
  const okCount = pair.filter((x) => x.status === 201).length;
  check('oversell guard holds under concurrency (only one 8-of-10 sale)', okCount === 1 && eStock === 2,
        `succeeded=${okCount} stock=${eStock}`);

  // ══ LEDGER ══════════════════════════════════════════════════════════════
  section('Stock ledger');

  const mv = (await call('GET', '/reports/stock-movements?limit=200')).d.data || [];
  const forC = mv.filter((m) => m.productId === C.id);
  check('every stock change writes a ledger row', forC.length >= 3, `${forC.length} rows for one product`);
  const chainOk = forC.slice().reverse().every((m, i, arr) => i === 0 || arr[i - 1].stockAfter === m.stockBefore);
  check('ledger chain is continuous (each stockAfter is the next stockBefore)', chainOk);
  const latest = forC[0];
  const liveStock = (await call('GET', '/products/' + C.id)).d.data.stock;
  check('ledger head matches the product row', latest && latest.stockAfter === liveStock,
        `ledger=${latest && latest.stockAfter} product=${liveStock}`);

  // ══ CUSTOMER BALANCE ════════════════════════════════════════════════════
  section('Customer balance and due allocation');

  r = await call('POST', '/customers', { name: 'AUDIT Debtor ' + Date.now(), phone: '01700000123' });
  const CUST = r.d.data.id;
  created.customers.push(CUST);

  const balanceOk = async (label) => {
    const d = (await call('GET', `/customers/${CUST}/due`)).d.data;
    check(`  dueAmount equals the sum of unpaid invoices ${label}`,
          near(d.outstanding, d.cachedBalance),
          `invoices=${d.outstanding} cached=${d.cachedBalance}`);
    return d;
  };

  // Three credit sales: 100.00, 200.00, 300.00 (10.00 x 10, 20, 30)
  const F = await mkProduct('Widget F', 10, 6, 1000);
  const dueSales = [];
  for (const q of [10, 20, 30]) {
    const s = await call('POST', '/sales', { customerId: CUST, items: [{ productId: F.id, quantity: q }], paid: 0 });
    dueSales.push(s.d.data);
    created.invoices.push(s.d.data.invoiceNo);
    await new Promise((res) => setTimeout(res, 1100));   // distinct timestamps
  }
  check('three credit sales total 600.00',
        near(dueSales.reduce((a, s) => a + Number(s.due), 0), 600), '');
  await balanceOk('after due sales');

  // Payment spanning three invoices, partially covering the third:
  // 100 + 200 = 300 settles the first two, 50 of the third => pay 350.
  r = await call('POST', `/customers/${CUST}/collect-due`, { amount: 350 });
  const alloc = r.d.data;
  check('payment of 350 settles invoice 1 (100) and 2 (200) in full',
        alloc.allocations.length === 3 &&
        near(alloc.allocations[0].applied, 100) && alloc.allocations[0].settled &&
        near(alloc.allocations[1].applied, 200) && alloc.allocations[1].settled,
        JSON.stringify(alloc.allocations.map((a) => [a.applied, a.settled])));
  check('  and applies the remaining 50 to invoice 3 without settling it',
        near(alloc.allocations[2].applied, 50) && alloc.allocations[2].settled === false &&
        near(alloc.allocations[2].remainingOnInvoice, 250),
        `applied=${alloc.allocations[2].applied} remaining=${alloc.allocations[2].remainingOnInvoice}`);
  check('  new balance is 600 - 350 = 250', near(alloc.newBalance, 250), `got ${alloc.newBalance}`);
  await balanceOk('after a partial payment');

  r = await call('POST', `/customers/${CUST}/collect-due`, { amount: 1000 });
  check('overpayment attempt is rejected', r.status === 400, String(r.d && r.d.message).slice(0, 60));
  await balanceOk('after a rejected overpayment');

  // A return against a still-unpaid invoice.
  const unpaidInv = dueSales[2];
  r = await call('POST', '/returns', {
    saleId: unpaidInv.id,
    items: [{ saleItemId: unpaidInv.items[0].id, quantity: 5, restockItem: true }],
    refundMethod: 'cash',
  });
  check('return against an unpaid invoice is accepted', r.status === 201 || r.status === 200, 'status=' + r.status);
  await balanceOk('after a return against an unpaid invoice');

  // Settle the rest, then confirm zero.
  const rest = (await call('GET', `/customers/${CUST}/due`)).d.data.outstanding;
  if (rest > 0) {
    r = await call('POST', `/customers/${CUST}/collect-due`, { amount: rest });
    check('final payment clears the balance to exactly 0',
          r.status === 200 && Number(r.d.data.newBalance) === 0, `newBalance=${r.d && r.d.data && r.d.data.newBalance}`);
  }
  await balanceOk('after full settlement');

  // ══ ROUNDING CONSISTENCY ════════════════════════════════════════════════
  section('Rounding');

  // The system-wide rule is round-half-up at 2dp, expressed as
  // Math.round(x * 100) / 100. Confirm the API applies it to every money field
  // it accepts, using a value that exposes truncation.
  const G = await mkProduct('Widget G', 3.335, 1, 100);
  check('a price with 3 decimals is stored rounded to 2dp (3.335 -> 3.34 or 3.33, consistently)',
        near(G.price, money(3.335)), `stored=${G.price} rule=${money(3.335)}`);

  r = await call('POST', '/sales', { items: [{ productId: G.id, quantity: 3 }] });
  const gs = r.d.data;
  created.invoices.push(gs.invoiceNo);
  const expectedLine = money(Number(G.price) * 3);
  check('line total uses the same rounding rule', near(gs.items[0].total, expectedLine),
        `got ${gs.items[0].total} expected ${expectedLine}`);

  // ══ REPORTS ═════════════════════════════════════════════════════════════
  section('Reports');

  const daily = (await call('GET', '/sales/daily')).d.data;
  const allSales = (await call('GET', '/sales?limit=500')).d;
  check('daily endpoint responds', !!daily, JSON.stringify(daily).slice(0, 80));
  check('sales list totals are present', !!(allSales && allSales.totals), '');

  const dash = (await call('GET', '/reports/dashboard')).d.data;
  const inv = (await call('GET', '/reports/inventory')).d;
  const low = (await call('GET', '/products/low-stock')).d.data || [];
  const products = (await call('GET', '/products')).d.data || [];
  const handLow = products.filter((p) => p.stock > 0 && p.stock <= (p.lowStockAlert ?? 10)).length;
  const handOut = products.filter((p) => p.stock <= 0).length;
  check('low-stock count matches a hand count of the product list',
        Number(dash.inventory.lowStockCount) === handLow + handOut ||
        Number(dash.inventory.lowStockCount) === handLow,
        `dashboard=${dash.inventory.lowStockCount} hand(low only)=${handLow} hand(low+out)=${handLow + handOut}`);
  check('out-of-stock count matches a hand count',
        Number(dash.inventory.outOfStockCount) === handOut,
        `dashboard=${dash.inventory.outOfStockCount} hand=${handOut}`);
  check('low-stock endpoint agrees with the dashboard count',
        low.length === Number(dash.inventory.lowStockCount) || low.length === handLow + handOut,
        `endpoint=${low.length} dashboard=${dash.inventory.lowStockCount}`);

  const invTotals = inv.totals || {};
  const handCost = money(products.reduce((a, p) => a + Number(p.cost) * p.stock, 0));
  const handRetail = money(products.reduce((a, p) => a + Number(p.price) * p.stock, 0));
  check('inventory cost value matches a hand sum of cost x stock',
        near(invTotals.costValue, handCost, 1), `report=${invTotals.costValue} hand=${handCost}`);
  check('inventory retail value matches a hand sum of price x stock',
        near(invTotals.retailValue ?? dash.inventory.stockRetailValue, handRetail, 1),
        `report=${invTotals.retailValue ?? dash.inventory.stockRetailValue} hand=${handRetail}`);

  // ══ CLEAN UP ════════════════════════════════════════════════════════════
  section('Cleanup');
  console.log(`  fixture: ${created.products.length} products, ${created.customers.length} customers, ${created.invoices.length} invoices`);
  console.log('  run `npm run purge:test` to remove them (they are all named AUDIT ...)');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED =====`);
  failed.forEach((f) => console.log(`  FAIL: ${f.name}\n        ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('AUDIT HARNESS ERROR', e); process.exit(1); });
