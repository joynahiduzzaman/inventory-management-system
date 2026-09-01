/**
 * reportController.js — v5
 *
 * ── Revenue definition ────────────────────────────────────────────────────
 *  revenue   = SUM(sales.total) - SUM(returns.totalRefund)
 *
 *  `sales.total` is set at sale-creation time as:
 *    total = subtotal - discount + tax
 *  and is NEVER updated afterward, regardless of payment status or returns.
 *  Net revenue subtracts returns at query time — the return ledger is the
 *  single source of truth for what was refunded.
 *
 * ── All canonical field names ─────────────────────────────────────────────
 *   grossRevenue = SUM(sales.total)        full invoiced amount
 *   totalReturns = SUM(returns.totalRefund)
 *   revenue      = grossRevenue - totalReturns   (net revenue)
 *   collected    = SUM(sales.paid)         cash actually received
 *   due          = SUM(sales.due)          outstanding balance
 *   cogs         = SUM((qty - returned) * cost)
 *   grossProfit  = revenue - cogs
 *   netProfit    = grossProfit - expenses
 *
 * ── Frontend field aliases (backward-compat) ──────────────────────────────
 *   salesChart rows  → `total`        (Reports.js reads d.total)
 *   topProducts rows → `totalRevenue` (Reports.js + Dashboard.js)
 *   getProfitReport  → `expense`      (Reports.js reads profit.expense)
 *
 * ── Timezone ──────────────────────────────────────────────────────────────
 *   All date boundaries computed in BST (UTC+6).
 *   MySQL connection timezone is also set to +06:00 in database.js, so
 *   DATE(createdAt) grouping in chart queries uses the correct local day.
 */

const { Sale, SaleItem, Product, Expense, Customer, sequelize } = require('../models');
const { Op, QueryTypes } = require('sequelize');
const { roundMoney } = require('../utils/money');

/**
 * Every report response goes out through here.
 *
 * These figures are built by subtracting one SUM from another — grossRevenue
 * minus returns, revenue minus COGS — and binary floats leak straight through:
 * gross profit came back as 1606.8399999999997. Nothing displayed it wrongly,
 * because this app's UI happens to round for display, but rounding belongs at
 * the boundary where the number leaves the server, not in whichever client
 * happens to read it next.
 */
const send = (res, payload) => res.json(roundMoney(payload));

// ─────────────────────────────────────────────────────────────────────────────
// Timezone helpers  (BST = UTC+6)
// ─────────────────────────────────────────────────────────────────────────────
const BST_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Returns a UTC Date that equals 00:00:00 BST of the current day. */
const bstMidnightUTC = () => {
  const nowBST = new Date(Date.now() + BST_OFFSET_MS);
  nowBST.setUTCHours(0, 0, 0, 0);
  return new Date(nowBST.getTime() - BST_OFFSET_MS);
};

const todayRange = () => {
  const start = bstMidnightUTC();
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

const currentMonthRange = () => {
  const nowBST = new Date(Date.now() + BST_OFFSET_MS);
  const y = nowBST.getUTCFullYear();
  const m = nowBST.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m,     1,  0,  0,  0,   0) - BST_OFFSET_MS),
    end:   new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999) - BST_OFFSET_MS),
  };
};

const lastNDaysRange = (n) => {
  const start = bstMidnightUTC();
  start.setTime(start.getTime() - (n - 1) * 86_400_000);
  return { start, end: new Date() };
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared SQL fragments — used identically in every product-level query
// ─────────────────────────────────────────────────────────────────────────────

/** Net (return-adjusted) quantity for a sale_item row. Alias `ri` required. */
const NET_QTY = `GREATEST(0, (si.quantity - COALESCE(ri.returnedQty, 0)))`;

/** LEFT JOIN that exposes returnedQty per sale_item, scoped to a date range.
 *  Only counts returns whose return record falls within the same window as the
 *  sales query — prevents orphaned return_items rows from reducing NET_QTY.
 *  Alias: ri. Pass the same :start/:end or :from/:to replacements as the outer query.
 */
const returnsJoin = (startParam = 'start', endParam = 'end') => `
  LEFT JOIN (
    SELECT ri2.saleItemId, SUM(ri2.quantity) AS returnedQty
    FROM return_items ri2
    INNER JOIN returns r2 ON ri2.returnId = r2.id
    WHERE r2.createdAt BETWEEN :${startParam} AND :${endParam}
    GROUP BY ri2.saleItemId
  ) ri ON ri.saleItemId = si.id
`;

// ─────────────────────────────────────────────────────────────────────────────
// COGS helper
// ─────────────────────────────────────────────────────────────────────────────
const getCOGS = async (start, end) => {
  try {
    const [row] = await sequelize.query(`
      SELECT COALESCE(SUM(${NET_QTY} * si.cost), 0) AS cogs
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      ${returnsJoin()}
      WHERE s.createdAt BETWEEN :start AND :end
        AND ${NET_QTY} > 0
    `, { replacements: { start, end }, type: QueryTypes.SELECT });
    return parseFloat(row?.cogs ?? 0);
  } catch (err) {
    const isTableMissing = err.message && (
      err.message.includes("return_items") &&
      (err.message.includes("doesn't exist") || err.message.includes("does not exist") || err.message.includes("ER_NO_SUCH_TABLE"))
    );
    if (!isTableMissing) throw err;

    const [row] = await sequelize.query(`
      SELECT COALESCE(SUM(si.quantity * si.cost), 0) AS cogs
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt BETWEEN :start AND :end
    `, { replacements: { start, end }, type: QueryTypes.SELECT });
    return parseFloat(row?.cogs ?? 0);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Expense helper  (expenses.date is a DATE column, not DATETIME)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a UTC Date to a YYYY-MM-DD string in BST (UTC+6).
 * NEVER use .toISOString() here — that returns the UTC date string, which
 * can be one calendar day behind BST.
 */
const toBSTDateString = (utcDate) => {
  const bst = new Date(new Date(utcDate).getTime() + BST_OFFSET_MS);
  const y   = bst.getUTCFullYear();
  const mo  = String(bst.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(bst.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
};

const getExpenses = async (start, end) => {
  const s = toBSTDateString(start);
  const e = toBSTDateString(end);
  const [row] = await sequelize.query(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE date BETWEEN :s AND :e
  `, { replacements: { s, e }, type: QueryTypes.SELECT });
  return parseFloat(row?.total ?? 0);
};


// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const { start: todayStart, end: todayEnd } = todayRange();
    const { start: monthStart, end: monthEnd } = currentMonthRange();

    const salesTotals = (start, end) => sequelize.query(`
      SELECT
        COALESCE(SUM(total), 0) AS revenue,
        COALESCE(SUM(paid),  0) AS collected,
        COALESCE(SUM(due),   0) AS due,
        COALESCE(COUNT(id),  0) AS count
      FROM sales
      WHERE createdAt BETWEEN :start AND :end
    `, { replacements: { start, end }, type: QueryTypes.SELECT });

    const returnsTotals = (start, end) => sequelize.query(`
      SELECT COALESCE(SUM(totalRefund), 0) AS totalReturns
      FROM returns
      WHERE createdAt BETWEEN :start AND :end
    `, { replacements: { start, end }, type: QueryTypes.SELECT });

    const [todayRows, monthRows, todayRetRows, monthRetRows, monthCOGS, monthExpenses, totalProducts, lowRows, totalCustomers, dueRows] =
      await Promise.all([
        salesTotals(todayStart, todayEnd),
        salesTotals(monthStart, monthEnd),
        returnsTotals(todayStart, todayEnd),
        returnsTotals(monthStart, monthEnd),
        getCOGS(monthStart, monthEnd),
        getExpenses(monthStart, monthEnd),
        Product.count({ where: { isActive: true } }),
        sequelize.query(
          `SELECT
             SUM(stock <= lowStockAlert)          AS lowCnt,
             SUM(stock = 0)                       AS outCnt,
             COALESCE(SUM(stock * cost), 0)       AS stockCost,
             COALESCE(SUM(stock * price), 0)      AS stockRetail
           FROM products WHERE isActive = 1`,
          { type: QueryTypes.SELECT }
        ),
        Customer.count(),
        // Everything customers still owe, across all time — not just this month.
        sequelize.query(
          `SELECT COALESCE(SUM(due), 0) AS totalDue, COUNT(*) AS dueInvoices
             FROM sales WHERE due > 0`,
          { type: QueryTypes.SELECT }
        ),
      ]);

    const today = todayRows[0];
    const month = monthRows[0];

    const todayReturns  = parseFloat(todayRetRows[0]?.totalReturns ?? 0);
    const monthReturns  = parseFloat(monthRetRows[0]?.totalReturns ?? 0);
    const monthRevenue  = parseFloat(month?.revenue ?? 0) - monthReturns;
    const grossProfit   = monthRevenue - monthCOGS;
    const netProfit     = grossProfit  - monthExpenses;

    send(res, {
      success: true,
      data: {
        today: {
          revenue:      parseFloat(today?.revenue ?? 0) - todayReturns,
          grossRevenue: parseFloat(today?.revenue ?? 0),
          totalReturns: todayReturns,
          collected:    parseFloat(today?.collected ?? 0),
          due:          parseFloat(today?.due       ?? 0),
          count:        parseInt(today?.count       ?? 0),
        },
        month: {
          revenue:      monthRevenue,
          grossRevenue: parseFloat(month?.revenue ?? 0),
          totalReturns: monthReturns,
          collected:    parseFloat(month?.collected ?? 0),
          due:          parseFloat(month?.due       ?? 0),
          count:        parseInt(month?.count       ?? 0),
          cogs:         monthCOGS,
          expenses:     monthExpenses,
          grossProfit,
          netProfit,
        },
        inventory: {
          totalProducts,
          lowStockCount:   parseInt(lowRows[0]?.lowCnt ?? 0),
          outOfStockCount: parseInt(lowRows[0]?.outCnt ?? 0),
          stockCostValue:   parseFloat(lowRows[0]?.stockCost   ?? 0),
          stockRetailValue: parseFloat(lowRows[0]?.stockRetail ?? 0),
          totalCustomers,
        },
        receivables: {
          totalDue:    parseFloat(dueRows[0]?.totalDue ?? 0),
          dueInvoices: parseInt(dueRows[0]?.dueInvoices ?? 0),
        },
      },
    });
  } catch (err) {
    console.error('getDashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales Chart
// ─────────────────────────────────────────────────────────────────────────────
exports.getSalesChart = async (req, res) => {
  try {
    const days  = Math.min(parseInt(req.query.days) || 30, 365);
    const start = bstMidnightUTC();
    start.setTime(start.getTime() - (days - 1) * 86_400_000);

    const rows = await sequelize.query(`
      SELECT
        DATE(createdAt)         AS date,
        COALESCE(SUM(total), 0) AS total,
        COALESCE(SUM(paid),  0) AS collected,
        COALESCE(COUNT(id),  0) AS count
      FROM sales
      WHERE createdAt >= :start
      GROUP BY DATE(createdAt)
      ORDER BY DATE(createdAt) ASC
    `, { replacements: { start }, type: QueryTypes.SELECT });

    send(res, { success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Top Products
// ─────────────────────────────────────────────────────────────────────────────
exports.getTopProducts = async (req, res) => {
  try {
    const { start: defaultStart } = lastNDaysRange(30);
    const from = req.query.from ? new Date(req.query.from + 'T00:00:00') : defaultStart;
    const to   = req.query.to   ? new Date(req.query.to   + 'T23:59:59') : new Date();

    const data = await sequelize.query(`
      SELECT
        si.productId,
        si.productName,
        COALESCE(SUM(${NET_QTY}), 0)                         AS totalQty,
        COALESCE(SUM(${NET_QTY} * si.price), 0)              AS totalRevenue,
        COALESCE(SUM(${NET_QTY} * si.cost),  0)              AS totalCost,
        COALESCE(SUM(${NET_QTY} * (si.price - si.cost)), 0)  AS profit
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      ${returnsJoin('from', 'to')}
      WHERE s.createdAt BETWEEN :from AND :to
      GROUP BY si.productId, si.productName
      HAVING totalQty > 0
      ORDER BY totalRevenue DESC
      LIMIT 10
    `, { replacements: { from, to }, type: QueryTypes.SELECT })
    .catch((err) => {
      const isTableMissing = err.message && (
        err.message.includes("return_items") &&
        (err.message.includes("doesn't exist") || err.message.includes("does not exist") || err.message.includes("ER_NO_SUCH_TABLE"))
      );
      if (!isTableMissing) throw err;
      return sequelize.query(`
        SELECT
          si.productId,
          si.productName,
          SUM(si.quantity)                            AS totalQty,
          SUM(si.quantity * si.price)                 AS totalRevenue,
          SUM(si.quantity * si.cost)                  AS totalCost,
          SUM(si.quantity * (si.price - si.cost))     AS profit
        FROM sale_items si
        INNER JOIN sales s ON si.saleId = s.id
        WHERE s.createdAt BETWEEN :from AND :to
        GROUP BY si.productId, si.productName
        ORDER BY totalRevenue DESC
        LIMIT 10
      `, { replacements: { from, to }, type: QueryTypes.SELECT });
    });

    send(res, { success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Profit Report
// ─────────────────────────────────────────────────────────────────────────────
exports.getProfitReport = async (req, res) => {
  try {
    const { start: defaultStart } = lastNDaysRange(30);
    const start = req.query.from ? new Date(req.query.from + 'T00:00:00') : defaultStart;
    const end   = req.query.to   ? new Date(req.query.to   + 'T23:59:59') : new Date();

    const [[revenueRow], [returnsRow], cogs, expense] = await Promise.all([
      sequelize.query(`
        SELECT
          COALESCE(SUM(total), 0) AS grossRevenue,
          COALESCE(SUM(paid),  0) AS collected,
          COALESCE(SUM(due),   0) AS due
        FROM sales WHERE createdAt BETWEEN :start AND :end
      `, { replacements: { start, end }, type: QueryTypes.SELECT }),
      sequelize.query(`
        SELECT COALESCE(SUM(totalRefund), 0) AS totalReturns
        FROM returns WHERE createdAt BETWEEN :start AND :end
      `, { replacements: { start, end }, type: QueryTypes.SELECT }),
      getCOGS(start, end),
      getExpenses(start, end),
    ]);

    const grossRevenue  = parseFloat(revenueRow?.grossRevenue ?? 0);
    const totalReturns  = parseFloat(returnsRow?.totalReturns ?? 0);
    const revenue       = grossRevenue - totalReturns;
    const collected     = parseFloat(revenueRow?.collected ?? 0);
    const due           = parseFloat(revenueRow?.due       ?? 0);
    const grossProfit   = revenue - cogs;
    const netProfit     = grossProfit - expense;

    send(res, {
      success: true,
      data: {
        grossRevenue, totalReturns,
        revenue, collected, due,
        cogs, expense,
        grossProfit, netProfit,
        period: { from: start, to: end },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales Summary  (PDF export)
// FIX: now subtracts returns from revenue — consistent with dashboard & profit report
// ─────────────────────────────────────────────────────────────────────────────
exports.getSalesSummary = async (req, res) => {
  try {
    const { type = 'monthly', from, to } = req.query;

    let start, end;
    if (type === 'daily') {
      ({ start, end } = todayRange());
    } else if (from && to) {
      start = new Date(from + 'T00:00:00');
      end   = new Date(to   + 'T23:59:59');
    } else {
      ({ start, end } = currentMonthRange());
    }

    const [[totalsRow], [returnsRow], cogs, expenses, sales] = await Promise.all([
      sequelize.query(`
        SELECT
          COALESCE(SUM(total),    0) AS grossRevenue,
          COALESCE(SUM(paid),     0) AS collected,
          COALESCE(SUM(due),      0) AS due,
          COALESCE(SUM(discount), 0) AS discount,
          COALESCE(COUNT(id),     0) AS count
        FROM sales WHERE createdAt BETWEEN :start AND :end
      `, { replacements: { start, end }, type: QueryTypes.SELECT }),

      sequelize.query(`
        SELECT COALESCE(SUM(totalRefund), 0) AS totalReturns
        FROM returns WHERE createdAt BETWEEN :start AND :end
      `, { replacements: { start, end }, type: QueryTypes.SELECT }),

      getCOGS(start, end),
      getExpenses(start, end),

      Sale.findAll({
        where: { createdAt: { [Op.between]: [start, end] } },
        include: [
          { model: SaleItem,  as: 'items' },
          { model: Customer,  as: 'customer', attributes: ['id', 'name', 'phone'] },
        ],
        order: [['createdAt', 'DESC']],
      }),
    ]);

    const grossRevenue = parseFloat(totalsRow?.grossRevenue ?? 0);
    const totalReturns = parseFloat(returnsRow?.totalReturns ?? 0);
    const revenue      = grossRevenue - totalReturns;
    const collected    = parseFloat(totalsRow?.collected ?? 0);
    const due          = parseFloat(totalsRow?.due       ?? 0);
    const discount     = parseFloat(totalsRow?.discount  ?? 0);
    const count        = parseInt(totalsRow?.count       ?? 0);
    const grossProfit  = revenue - cogs;
    const netProfit    = grossProfit - expenses;

    send(res, {
      success: true,
      data: {
        sales,
        grossRevenue, totalReturns,
        revenue, collected, due, discount, count,
        cogs, expenses, grossProfit, netProfit,
        period: { start, end, type },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Product-wise Sales Report
// ─────────────────────────────────────────────────────────────────────────────
exports.getProductSalesReport = async (req, res) => {
  try {
    const { start: defaultStart } = lastNDaysRange(30);
    const start = req.query.from ? new Date(req.query.from + 'T00:00:00') : defaultStart;
    const end   = req.query.to   ? new Date(req.query.to   + 'T23:59:59') : new Date();

    const rows = await sequelize.query(`
      SELECT
        si.productId,
        si.productName,
        COALESCE(SUM(${NET_QTY}), 0)                          AS totalQty,
        COALESCE(AVG(si.price), 0)                            AS avgPrice,
        COALESCE(SUM(${NET_QTY} * si.price), 0)               AS grossRevenue,
        COALESCE(SUM(${NET_QTY} * si.cost),  0)               AS totalCost,
        COALESCE(SUM(${NET_QTY} * (si.price - si.cost)), 0)   AS grossProfit
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      ${returnsJoin()}
      WHERE s.createdAt BETWEEN :start AND :end
      GROUP BY si.productId, si.productName
      HAVING totalQty > 0
      ORDER BY grossRevenue DESC
    `, { replacements: { start, end }, type: QueryTypes.SELECT })
    .catch((err) => {
      const isTableMissing = err.message && (
        err.message.includes("return_items") &&
        (err.message.includes("doesn't exist") || err.message.includes("does not exist") || err.message.includes("ER_NO_SUCH_TABLE"))
      );
      if (!isTableMissing) throw err;
      return sequelize.query(`
        SELECT
          si.productId,
          si.productName,
          SUM(si.quantity)                             AS totalQty,
          AVG(si.price)                                AS avgPrice,
          SUM(si.quantity * si.price)                  AS grossRevenue,
          SUM(si.quantity * si.cost)                   AS totalCost,
          SUM(si.quantity * (si.price - si.cost))      AS grossProfit
        FROM sale_items si
        INNER JOIN sales s ON si.saleId = s.id
        WHERE s.createdAt BETWEEN :start AND :end
        GROUP BY si.productId, si.productName
        ORDER BY grossRevenue DESC
      `, { replacements: { start, end }, type: QueryTypes.SELECT });
    });

    send(res, { success: true, data: rows, period: { start, end } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// Stock Movement Ledger  (audit trail across all products)
// ─────────────────────────────────────────────────────────────────────────────
exports.getStockMovements = async (req, res) => {
  try {
    const { StockMovement, Product } = require('../models');
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

    const where = {};
    if (req.query.productId) where.productId = parseInt(req.query.productId);
    if (req.query.type)      where.type      = req.query.type;
    if (req.query.from && req.query.to) {
      where.createdAt = {
        [Op.between]: [new Date(req.query.from + 'T00:00:00'), new Date(req.query.to + 'T23:59:59.999')],
      };
    }

    const { rows, count } = await StockMovement.findAndCountAll({
      where,
      include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'sku', 'unit'], required: false }],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    send(res, {
      success: true,
      data: rows,
      pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load stock history' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales split by payment method — tells the owner what to expect in the till
// versus in each mobile-money account at close of day.
// ─────────────────────────────────────────────────────────────────────────────
exports.getPaymentBreakdown = async (req, res) => {
  try {
    const { start: defaultStart } = lastNDaysRange(30);
    const start = req.query.from ? new Date(req.query.from + 'T00:00:00') : defaultStart;
    const end   = req.query.to   ? new Date(req.query.to   + 'T23:59:59.999') : new Date();

    const rows = await sequelize.query(`
      SELECT paymentMethod,
             COUNT(id)               AS count,
             COALESCE(SUM(total), 0) AS total,
             COALESCE(SUM(paid),  0) AS collected,
             COALESCE(SUM(due),   0) AS due
        FROM sales
       WHERE createdAt BETWEEN :start AND :end
       GROUP BY paymentMethod
       ORDER BY total DESC
    `, { replacements: { start, end }, type: QueryTypes.SELECT });

    send(res, { success: true, data: rows, period: { start, end } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load payment breakdown' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Inventory status report — what is out, what is running low, what it is worth.
// ─────────────────────────────────────────────────────────────────────────────
exports.getInventoryReport = async (req, res) => {
  try {
    const rows = await sequelize.query(`
      SELECT p.id, p.name, p.sku, p.unit, p.stock, p.lowStockAlert,
             p.cost, p.price,
             (p.stock * p.cost)  AS stockCostValue,
             (p.stock * p.price) AS stockRetailValue,
             c.name AS categoryName,
             s.name AS supplierName,
             CASE WHEN p.stock = 0 THEN 'out'
                  WHEN p.stock <= p.lowStockAlert THEN 'low'
                  ELSE 'ok' END AS status
        FROM products p
        LEFT JOIN categories c ON p.categoryId = c.id
        LEFT JOIN suppliers  s ON p.supplierId = s.id
       WHERE p.isActive = 1
       ORDER BY (p.stock = 0) DESC, (p.stock <= p.lowStockAlert) DESC, p.name ASC
    `, { type: QueryTypes.SELECT });

    const totals = rows.reduce((a, r) => ({
      costValue:   a.costValue   + parseFloat(r.stockCostValue   || 0),
      retailValue: a.retailValue + parseFloat(r.stockRetailValue || 0),
      units:       a.units       + parseInt(r.stock || 0),
      out:         a.out + (r.status === 'out' ? 1 : 0),
      low:         a.low + (r.status === 'low' ? 1 : 0),
    }), { costValue: 0, retailValue: 0, units: 0, out: 0, low: 0 });

    send(res, { success: true, data: rows, totals: { ...totals, productCount: rows.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load inventory report' });
  }
};
