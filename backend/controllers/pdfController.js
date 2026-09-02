/**
 * pdfController.js — v3 Professional
 *
 * Uses DejaVu Sans fonts (Regular + Bold) which fully support the Bengali
 * Taka sign ৳ (U+09F3) — fixing broken characters in all PDFs.
 *
 * PDFs generated:
 *  1. Invoice (sale receipt)
 *  2. Sales Report (daily / monthly / custom range)
 *  3. Product-wise Sales Report
 *  4. Payment Voucher
 */

const path        = require('path');
const PDFDocument = require('pdfkit');
const { Sale, SaleItem, Product, Customer, User, Expense, Return, ReturnItem, sequelize } = require('../models');
const { Op } = require('sequelize');

// ── Font paths ───────────────────────────────────────────────────────────────
const FONT_DIR      = path.join(__dirname, '..', 'fonts');
const FONT_REGULAR  = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD     = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

// ── Layout constants ─────────────────────────────────────────────────────────
const A4_W   = 595.28;
const A4_H   = 841.89;
const MARGIN = 45;
const COL_W  = A4_W - MARGIN * 2;

// ── Colour palette ───────────────────────────────────────────────────────────
const C = {
  primary:   '#1e40af',
  secondary: '#1d4ed8',
  accent:    '#3b82f6',
  text:      '#111827',
  muted:     '#6b7280',
  light:     '#f3f4f6',
  border:    '#e5e7eb',
  success:   '#16a34a',
  danger:    '#dc2626',
  white:     '#ffffff',
  green_bg:  '#dcfce7',
  red_bg:    '#fee2e2',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt     = (n) => `${parseFloat(n || 0).toFixed(2)}`;
const fmtTaka = (n) => `৳ ${parseFloat(n || 0).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric'
});
const fmtDateTime = (d) => new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true
});

// ── BST helpers (UTC+6) ──────────────────────────────────────────────────────
const BST_MS = 6 * 60 * 60 * 1000;
const bstMidnightUTC = () => {
  const b = new Date(Date.now() + BST_MS); b.setUTCHours(0,0,0,0);
  return new Date(b.getTime() - BST_MS);
};
const bstMonthRange = () => {
  const b = new Date(Date.now() + BST_MS);
  const y = b.getUTCFullYear(), m = b.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m,     1,  0,  0,  0,   0) - BST_MS),
    end:   new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999) - BST_MS),
  };
};

// ── Document init ────────────────────────────────────────────────────────────
const initDoc = () => new PDFDocument({
  size: 'A4', margin: MARGIN, bufferPages: true,
  info: { Author: 'Inventory Management System', Creator: 'IMS v3' }
});

const pipeDoc = (doc, res, filename) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
};

// ── Shared drawing helpers ───────────────────────────────────────────────────
const reg  = (doc) => doc.font(FONT_REGULAR);
const bold = (doc) => doc.font(FONT_BOLD);

const rule = (doc, y, color = C.border) =>
  doc.strokeColor(color).lineWidth(0.5)
     .moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).stroke();

const drawHeader = (doc, title, subtitle = '') => {
  doc.rect(0, 0, A4_W, 88).fill(C.primary);

  bold(doc).fillColor(C.white).fontSize(18)
     .text('INVENTORY MANAGEMENT', MARGIN, 16, { width: COL_W * 0.62 });
  bold(doc).fillColor(C.white).fontSize(18)
     .text('SYSTEM', MARGIN, 36, { width: COL_W * 0.62 });
  reg(doc).fillColor('rgba(255,255,255,0.72)').fontSize(8.5)
     .text('Business ERP Solution', MARGIN, 58);

  bold(doc).fillColor(C.white).fontSize(15)
     .text(title, MARGIN, 16, { width: COL_W, align: 'right' });
  if (subtitle) {
    reg(doc).fillColor('rgba(255,255,255,0.82)').fontSize(9)
       .text(subtitle, MARGIN, 40, { width: COL_W, align: 'right' });
  }
  doc.y = 105;
};

const infoRow = (doc, label, value, x, y, w = 230) => {
  reg(doc).fillColor(C.muted).fontSize(7.5).text(label, x, y);
  bold(doc).fillColor(C.text).fontSize(9).text(value || '—', x, y + 11, { width: w });
};

const tableHeader = (doc, columns, y) => {
  doc.rect(MARGIN, y, COL_W, 20).fill(C.primary);
  let x = MARGIN + 6;
  columns.forEach(col => {
    bold(doc).fillColor(C.white).fontSize(7.5)
       .text(col.label, x, y + 6, { width: col.width - 4, align: col.align || 'left' });
    x += col.width;
  });
  return y + 20;
};

const tableRow = (doc, columns, values, y, shade = false) => {
  const ROW_H = 19;
  if (shade) doc.rect(MARGIN, y, COL_W, ROW_H).fill(C.light);
  doc.rect(MARGIN, y, COL_W, ROW_H).strokeColor(C.border).lineWidth(0.25).stroke();
  let x = MARGIN + 6;
  columns.forEach((col, i) => {
    reg(doc).fillColor(C.text).fontSize(8)
       .text(String(values[i] ?? ''), x, y + 5, { width: col.width - 6, align: col.align || 'left' });
    x += col.width;
  });
  return y + ROW_H;
};

const totalBlock = (doc, rows, startY) => {
  const tw = 225, tx = A4_W - MARGIN - tw;
  let y = startY + 10;
  rows.forEach(({ label, value, bold: isBold, large, bg }) => {
    const h = large ? 24 : 19;
    if (bg) doc.rect(tx - 6, y - 2, tw + 6, h).fill(bg);
    (isBold ? bold(doc) : reg(doc))
      .fillColor(isBold ? C.primary : C.muted)
      .fontSize(isBold ? (large ? 11 : 9) : 8)
      .text(label, tx, y, { width: 120 });
    (isBold ? bold(doc) : reg(doc))
      .fillColor(isBold ? C.primary : C.text)
      .fontSize(isBold ? (large ? 11 : 9) : 8)
      .text(value, tx + 120, y, { width: 100, align: 'right' });
    y += h;
  });
  return y;
};

const drawFooter = (doc) => {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const generated = `Generated: ${fmtDateTime(new Date())} — Inventory Management System`;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const y = A4_H - 34;
    // Draw background and rule
    doc.rect(0, y, A4_W, 34).fill(C.light);
    doc.strokeColor(C.border).lineWidth(0.5)
       .moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).stroke();
    // Left text — explicit absolute position, lineBreak:false prevents overflow to new page
    reg(doc).fillColor(C.muted).fontSize(7.5)
       .text(generated, MARGIN, y + 11, { width: COL_W * 0.7, align: 'left', lineBreak: false });
    // Right text — separate call at same Y, explicit position
    reg(doc).fillColor(C.muted).fontSize(7.5)
       .text(`Page ${i + 1} of ${total}`, MARGIN, y + 11, { width: COL_W, align: 'right', lineBreak: false });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. INVOICE PDF
// ═══════════════════════════════════════════════════════════════════════════════
exports.generateInvoicePDF = async (req, res) => {
  try {
    const printMode = req.query.print === '1'; // triggers browser print dialog
    const sale = await Sale.findByPk(req.params.id, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Customer, as: 'customer' },
        { model: User,     as: 'user', attributes: ['id', 'name'] }
      ]
    });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });

    const doc = initDoc();
    // inline disposition opens in browser tab; attachment forces download
    const disposition = printMode ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="Invoice-${sale.invoiceNo}.pdf"`);
    doc.pipe(res);
    drawHeader(doc, 'TAX INVOICE', `Invoice No: ${sale.invoiceNo}`);

    // ── Info block ───────────────────────────────────────────────────────────
    const iY = doc.y;
    bold(doc).fillColor(C.primary).fontSize(8.5).text('BILL TO', MARGIN, iY);
    rule(doc, iY + 13);
    infoRow(doc, 'Customer Name', sale.customer?.name    || 'Walk-in Customer', MARGIN, iY + 20);
    infoRow(doc, 'Phone',         sale.customer?.phone   || '—',                MARGIN, iY + 46);
    infoRow(doc, 'Address',       sale.customer?.address || '—',                MARGIN, iY + 72);

    const rx = MARGIN + COL_W / 2;
    bold(doc).fillColor(C.primary).fontSize(8.5).text('INVOICE DETAILS', rx, iY);
    rule(doc, iY + 13);
    infoRow(doc, 'Invoice No',     sale.invoiceNo,                                  rx, iY + 20, 200);
    infoRow(doc, 'Date & Time',    fmtDateTime(sale.createdAt),                     rx, iY + 46, 200);
    infoRow(doc, 'Payment Method', (sale.paymentMethod || 'cash').toUpperCase(),    rx, iY + 72, 200);
    infoRow(doc, 'Served By',      sale.user?.name || '—',                          rx, iY + 98, 200);

    doc.y = iY + 132;

    // ── Items table ──────────────────────────────────────────────────────────
    const cols = [
      { label: '#',           width: 28,  align: 'center' },
      { label: 'Product',     width: 195, align: 'left'   },
      { label: 'Qty',         width: 48,  align: 'center' },
      { label: 'Unit Price',  width: 90,  align: 'right'  },
      { label: 'Total',       width: 90,  align: 'right'  },
    ];

    let y = tableHeader(doc, cols, doc.y);
    sale.items.forEach((item, idx) => {
      if (y > A4_H - 160) { doc.addPage(); y = 80; y = tableHeader(doc, cols, y); }
      y = tableRow(doc, cols, [
        idx + 1,
        item.productName,
        item.quantity,
        fmtTaka(item.price),
        fmtTaka(item.total),
      ], y, idx % 2 !== 0);
    });

    // ── Totals ───────────────────────────────────────────────────────────────
    const duePoz = parseFloat(sale.due) > 0;
    totalBlock(doc, [
      { label: 'Subtotal',    value: fmtTaka(sale.subtotal) },
      { label: 'Discount',    value: `- ${fmtTaka(sale.discount)}` },
      { label: 'Tax / VAT',   value: `+ ${fmtTaka(sale.tax)}` },
      { label: 'GRAND TOTAL', value: fmtTaka(sale.total),  bold: true, large: true, bg: C.light },
      { label: 'Amount Paid', value: fmtTaka(sale.paid),   bold: true, bg: C.green_bg },
      { label: 'Balance Due', value: fmtTaka(sale.due),    bold: duePoz, bg: duePoz ? C.red_bg : null },
    ], y + 6);

    if (sale.note) {
      reg(doc).fillColor(C.muted).fontSize(8)
         .text(`Note: ${sale.note}`, MARGIN, y + 150, { width: COL_W * 0.6 });
    }

    // Thank-you banner
    const tyY = A4_H - 95;
    doc.rect(MARGIN, tyY, COL_W, 28).fill(C.light);
    bold(doc).fillColor(C.primary).fontSize(10)
       .text('Thank you for your business!', MARGIN, tyY + 9, { width: COL_W, align: 'center' });

    doc.flushPages();
    drawFooter(doc);
    doc.end();
  } catch (err) {
    console.error('generateInvoicePDF error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SALES REPORT PDF
// ═══════════════════════════════════════════════════════════════════════════════
exports.generateSalesReportPDF = async (req, res) => {
  try {
    const { type = 'monthly', from, to } = req.query;

    let start, end, titleLine, subtitle;
    const now = new Date();
    if (type === 'daily') {
      start     = bstMidnightUTC();
      end       = new Date(start.getTime() + 86_400_000);
      titleLine = 'Daily Sales Report';
      subtitle  = fmtDate(now);
    } else if (from && to) {
      start     = new Date(from + 'T00:00:00');
      end       = new Date(to   + 'T23:59:59');
      titleLine = 'Sales Report';
      subtitle  = `${fmtDate(start)} — ${fmtDate(end)}`;
    } else {
      ({ start, end } = bstMonthRange());
      titleLine = 'Monthly Sales Report';
      subtitle  = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }

    const sales = await Sale.findAll({
      where: { createdAt: { [Op.between]: [start, end] } },
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'name'] }],
      order: [['createdAt', 'ASC']]
    });

    // revenue = SUM(total) — consistent with reportController
    const totalRevenue   = sales.reduce((s, sl) => s + parseFloat(sl.total    || 0), 0);
    const totalCollected = sales.reduce((s, sl) => s + parseFloat(sl.paid     || 0), 0);
    const totalDiscount  = sales.reduce((s, sl) => s + parseFloat(sl.discount || 0), 0);
    const totalDue       = sales.reduce((s, sl) => s + parseFloat(sl.due      || 0), 0);

    const doc = initDoc();
    pipeDoc(doc, res, `Sales-Report-${type}-${now.toISOString().split('T')[0]}.pdf`);
    drawHeader(doc, titleLine, subtitle);

    // ── Summary cards ────────────────────────────────────────────────────────
    const sumY = doc.y;
    const cw   = COL_W / 4 - 6;
    [
      { label: 'Total Sales',    value: fmtTaka(totalRevenue),  color: C.primary  },
      { label: 'Total Discount', value: fmtTaka(totalDiscount), color: C.accent   },
      { label: 'Total Due',      value: fmtTaka(totalDue),      color: totalDue > 0 ? C.danger : C.success },
      { label: 'Transactions',   value: String(sales.length),   color: C.secondary },
    ].forEach((card, i) => {
      const cx = MARGIN + i * (cw + 8);
      doc.rect(cx, sumY, cw, 54).fillAndStroke(C.light, C.border);
      doc.rect(cx, sumY, cw, 4).fill(card.color);
      reg(doc).fillColor(C.muted).fontSize(7.5).text(card.label, cx + 7, sumY + 13);
      bold(doc).fillColor(card.color).fontSize(12)
         .text(card.value, cx + 7, sumY + 26, { width: cw - 12 });
    });
    doc.y = sumY + 64;

    // ── Sales table ──────────────────────────────────────────────────────────
    const cols = [
      { label: '#',        width: 26,  align: 'center' },
      { label: 'Invoice',  width: 102, align: 'left'   },
      { label: 'Date',     width: 84,  align: 'left'   },
      { label: 'Customer', width: 118, align: 'left'   },
      { label: 'Method',   width: 60,  align: 'center' },
      { label: 'Total',    width: 62,  align: 'right'  },
      { label: 'Paid',     width: 53,  align: 'right'  },
    ];

    let y = tableHeader(doc, cols, doc.y);
    sales.forEach((s, idx) => {
      if (y > A4_H - 100) { doc.addPage(); y = 60; y = tableHeader(doc, cols, y); }
      y = tableRow(doc, cols, [
        idx + 1,
        s.invoiceNo,
        fmtDate(s.createdAt),
        s.customer?.name || 'Walk-in',
        (s.paymentMethod || 'cash').toUpperCase(),
        fmtTaka(s.total),
        fmtTaka(s.paid),
      ], y, idx % 2 !== 0);
    });

    // Grand total bar
    y += 2;
    doc.rect(MARGIN, y, COL_W, 22).fill(C.primary);
    bold(doc).fillColor(C.white).fontSize(8.5)
       .text('TOTAL', MARGIN + 6, y + 7)
       .text(fmtTaka(totalRevenue),   A4_W - MARGIN - 53 - 62, y + 7, { width: 56, align: 'right' })
       .text(fmtTaka(totalCollected), A4_W - MARGIN - 53,      y + 7, { width: 47, align: 'right' });

    doc.flushPages();
    drawFooter(doc);
    doc.end();
  } catch (err) {
    console.error('generateSalesReportPDF error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PRODUCT-WISE SALES REPORT PDF
// ═══════════════════════════════════════════════════════════════════════════════
exports.generateProductSalesPDF = async (req, res) => {
  try {
    const { from, to } = req.query;
    const now = new Date();
    const { start: mStart, end: mEnd } = bstMonthRange();
    const start = from ? new Date(from + 'T00:00:00') : mStart;
    const end   = to   ? new Date(to   + 'T23:59:59') : mEnd;

    // Return-adjusted query with fallback
    const NET = `GREATEST(0, (si.quantity - COALESCE(ri.returnedQty, 0)))`;
    const rows = await sequelize.query(`
      SELECT
        si.productId,
        si.productName,
        COALESCE(SUM(${NET}), 0)                         AS totalQty,
        COALESCE(AVG(si.price), 0)                       AS avgPrice,
        COALESCE(SUM(${NET} * si.price), 0)              AS grossRevenue,
        COALESCE(SUM(${NET} * si.cost),  0)              AS totalCost,
        COALESCE(SUM(${NET} * (si.price - si.cost)), 0)  AS grossProfit
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      LEFT JOIN (
        SELECT ri2.saleItemId, SUM(ri2.quantity) AS returnedQty
        FROM return_items ri2
        INNER JOIN returns r2 ON ri2.returnId = r2.id
        WHERE r2.createdAt BETWEEN :start AND :end
        GROUP BY ri2.saleItemId
      ) ri ON ri.saleItemId = si.id
      WHERE s.createdAt BETWEEN :start AND :end
      GROUP BY si.productId, si.productName
      HAVING totalQty > 0
      ORDER BY grossRevenue DESC
    `, { replacements: { start, end }, type: sequelize.QueryTypes.SELECT })
    .catch(() => sequelize.query(`
      SELECT si.productName,
        SUM(si.quantity)                        AS totalQty,
        AVG(si.price)                           AS avgPrice,
        SUM(si.quantity * si.price)             AS grossRevenue,
        SUM(si.quantity * si.cost)              AS totalCost,
        SUM(si.quantity * (si.price - si.cost)) AS grossProfit
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt BETWEEN :start AND :end
      GROUP BY si.productName ORDER BY grossRevenue DESC
    `, { replacements: { start, end }, type: sequelize.QueryTypes.SELECT }));

    const totalRev    = rows.reduce((s, r) => s + parseFloat(r.grossRevenue || 0), 0);
    const totalCost   = rows.reduce((s, r) => s + parseFloat(r.totalCost    || 0), 0);
    const totalProfit = rows.reduce((s, r) => s + parseFloat(r.grossProfit  || 0), 0);

    const doc = initDoc();
    pipeDoc(doc, res, `Product-Sales-${now.toISOString().split('T')[0]}.pdf`);
    drawHeader(doc, 'Product Sales Report', `${fmtDate(start)} — ${fmtDate(end)}`);

    // Summary cards
    const sumY = doc.y;
    const cw3  = COL_W / 3 - 6;
    [
      { label: 'Total Revenue', value: fmtTaka(totalRev),    color: C.primary },
      { label: 'Total Cost',    value: fmtTaka(totalCost),   color: C.accent  },
      { label: 'Gross Profit',  value: fmtTaka(totalProfit), color: C.success },
    ].forEach((card, i) => {
      const cx = MARGIN + i * (cw3 + 9);
      doc.rect(cx, sumY, cw3, 54).fillAndStroke(C.light, C.border);
      doc.rect(cx, sumY, cw3, 4).fill(card.color);
      reg(doc).fillColor(C.muted).fontSize(7.5).text(card.label, cx + 7, sumY + 13);
      bold(doc).fillColor(card.color).fontSize(12)
         .text(card.value, cx + 7, sumY + 26, { width: cw3 - 12 });
    });
    doc.y = sumY + 64;

    const cols = [
      { label: '#',           width: 25,  align: 'center' },
      { label: 'Product',     width: 172, align: 'left'   },
      { label: 'Qty Sold',    width: 58,  align: 'center' },
      { label: 'Avg Price',   width: 72,  align: 'right'  },
      { label: 'Revenue',     width: 78,  align: 'right'  },
      { label: 'Cost',        width: 68,  align: 'right'  },
      { label: 'Profit',      width: 78,  align: 'right'  },
    ];

    let y = tableHeader(doc, cols, doc.y);
    rows.forEach((r, idx) => {
      if (y > A4_H - 100) { doc.addPage(); y = 60; y = tableHeader(doc, cols, y); }
      y = tableRow(doc, cols, [
        idx + 1,
        r.productName,
        r.totalQty,
        fmtTaka(r.avgPrice),
        fmtTaka(r.grossRevenue),
        fmtTaka(r.totalCost),
        fmtTaka(r.grossProfit),
      ], y, idx % 2 !== 0);
    });

    y += 2;
    doc.rect(MARGIN, y, COL_W, 22).fill(C.primary);
    bold(doc).fillColor(C.white).fontSize(8.5)
       .text('TOTALS', MARGIN + 6, y + 7)
       .text(fmtTaka(totalRev),    A4_W - MARGIN - 78 - 68 - 78, y + 7, { width: 72, align: 'right' })
       .text(fmtTaka(totalCost),   A4_W - MARGIN - 78 - 68,      y + 7, { width: 62, align: 'right' })
       .text(fmtTaka(totalProfit), A4_W - MARGIN - 78,           y + 7, { width: 72, align: 'right' });

    doc.flushPages();
    drawFooter(doc);
    doc.end();
  } catch (err) {
    console.error('generateProductSalesPDF error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PAYMENT VOUCHER PDF
// ═══════════════════════════════════════════════════════════════════════════════
exports.generateVoucherPDF = async (req, res) => {
  try {
    const sale = await Sale.findByPk(req.params.id, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Customer, as: 'customer' },
        { model: User,     as: 'user', attributes: ['id', 'name'] }
      ]
    });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });

    const doc = initDoc();
    pipeDoc(doc, res, `Voucher-${sale.invoiceNo}.pdf`);
    drawHeader(doc, 'PAYMENT VOUCHER', `Ref: ${sale.invoiceNo}`);

    const vy = doc.y + 8;
    doc.rect(MARGIN, vy, COL_W, 36).fillAndStroke(C.light, C.border);
    bold(doc).fillColor(C.primary).fontSize(9.5).text('VOUCHER NO:', MARGIN + 12, vy + 9);
    bold(doc).fillColor(C.text).fontSize(15).text(sale.invoiceNo, MARGIN + 130, vy + 5);
    reg(doc).fillColor(C.muted).fontSize(9).text(`Date: ${fmtDateTime(sale.createdAt)}`, A4_W - MARGIN - 190, vy + 13);

    doc.y = vy + 52;

    bold(doc).fillColor(C.primary).fontSize(9.5).text('PAYMENT FROM');
    rule(doc, doc.y + 3); doc.moveDown(0.4);
    const infoStart = doc.y;
    infoRow(doc, 'Customer / Party',  sale.customer?.name    || 'Walk-in Customer', MARGIN,           infoStart);
    infoRow(doc, 'Phone',             sale.customer?.phone   || '—',                MARGIN,           infoStart + 28);
    infoRow(doc, 'Payment Method',    (sale.paymentMethod || 'cash').toUpperCase(), MARGIN + COL_W/2, infoStart);
    infoRow(doc, 'Served By',         sale.user?.name        || '—',                MARGIN + COL_W/2, infoStart + 28);
    doc.y = infoStart + 60;

    bold(doc).fillColor(C.primary).fontSize(9.5).text('ITEMS / DESCRIPTION');
    rule(doc, doc.y + 3);
    const cols = [
      { label: 'Description', width: 242, align: 'left'   },
      { label: 'Qty',         width: 58,  align: 'center' },
      { label: 'Rate',        width: 90,  align: 'right'  },
      { label: 'Amount',      width: 110, align: 'right'  },
    ];
    let y = tableHeader(doc, cols, doc.y + 6);
    sale.items.forEach((item, idx) => {
      y = tableRow(doc, cols, [
        item.productName, item.quantity,
        fmtTaka(item.price), fmtTaka(item.total)
      ], y, idx % 2 !== 0);
    });

    const duePoz = parseFloat(sale.due) > 0;
    totalBlock(doc, [
      { label: 'Subtotal',         value: fmtTaka(sale.subtotal)  },
      { label: 'Discount Applied', value: `- ${fmtTaka(sale.discount)}` },
      { label: 'Tax / VAT',        value: `+ ${fmtTaka(sale.tax)}` },
      { label: 'TOTAL PAYABLE',    value: fmtTaka(sale.total),  bold: true, large: true, bg: C.light   },
      { label: 'AMOUNT PAID',      value: fmtTaka(sale.paid),   bold: true, bg: C.green_bg },
      { label: 'BALANCE DUE',      value: fmtTaka(sale.due),    bold: duePoz, bg: duePoz ? C.red_bg : null },
    ], y + 12);

    // Signature lines
    const sigY = A4_H - 155;
    rule(doc, sigY);
    ['Received By', 'Authorized By', 'Cashier / Accountant'].forEach((label, i) => {
      const sx = MARGIN + i * 165;
      doc.rect(sx, sigY + 14, 130, 38).strokeColor(C.border).lineWidth(0.5).stroke();
      reg(doc).fillColor(C.muted).fontSize(7.5)
         .text(label, sx, sigY + 58, { width: 130, align: 'center' });
    });

    if (sale.note) {
      reg(doc).fillColor(C.muted).fontSize(8)
         .text(`Note: ${sale.note}`, MARGIN, sigY + 82, { width: COL_W });
    }

    doc.flushPages();
    drawFooter(doc);
    doc.end();
  } catch (err) {
    console.error('generateVoucherPDF error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RETURN / REFUND RECEIPT PDF
// ═══════════════════════════════════════════════════════════════════════════════
exports.generateReturnPDF = async (req, res) => {
  try {
    const printMode = req.query.print === '1';

    const ret = await Return.findByPk(req.params.id, {
      include: [
        { model: ReturnItem, as: 'items' },
        { model: Customer,   as: 'customer' },
        { model: User,       as: 'user', attributes: ['id', 'name'] },
        { model: Sale,       as: 'sale', attributes: ['id', 'invoiceNo'] },
      ]
    });
    if (!ret) return res.status(404).json({ success: false, message: 'Return not found' });

    const doc = initDoc();

    const disposition = printMode ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="Return-${ret.returnNo}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, 'RETURN & REFUND', `Ref: ${ret.returnNo}`);

    // ── Info block ───────────────────────────────────────────────────────────
    const iY = doc.y;

    // Left: Return Details
    bold(doc).fillColor(C.primary).fontSize(8.5).text('RETURN DETAILS', MARGIN, iY);
    rule(doc, iY + 13);
    infoRow(doc, 'Return No',       ret.returnNo,                              MARGIN, iY + 20);
    infoRow(doc, 'Date & Time',     fmtDateTime(ret.createdAt),                MARGIN, iY + 46);
    infoRow(doc, 'Original Invoice',ret.sale?.invoiceNo || '—',                MARGIN, iY + 72);
    infoRow(doc, 'Reason',          ret.reason || '—',                         MARGIN, iY + 98);

    // Right: Customer & Refund
    const rx = MARGIN + COL_W / 2;
    bold(doc).fillColor(C.primary).fontSize(8.5).text('CUSTOMER & REFUND', rx, iY);
    rule(doc, iY + 13);
    infoRow(doc, 'Customer',        ret.customer?.name    || 'Walk-in',        rx, iY + 20, 200);
    infoRow(doc, 'Phone',           ret.customer?.phone   || '—',              rx, iY + 46, 200);
    infoRow(doc, 'Refund Method',   (ret.refundMethod || 'cash').toUpperCase(),rx, iY + 72, 200);
    infoRow(doc, 'Processed By',    ret.user?.name        || '—',              rx, iY + 98, 200);

    doc.y = iY + 132;

    // ── Items table ──────────────────────────────────────────────────────────
    const cols = [
      { label: '#',          width: 28,  align: 'center' },
      { label: 'Product',    width: 190, align: 'left'   },
      { label: 'Qty',        width: 48,  align: 'center' },
      { label: 'Unit Price', width: 90,  align: 'right'  },
      { label: 'Refund',     width: 95,  align: 'right'  },
    ];

    let y = tableHeader(doc, cols, doc.y);
    (ret.items || []).forEach((item, idx) => {
      if (y > A4_H - 160) { doc.addPage(); y = 80; y = tableHeader(doc, cols, y); }
      y = tableRow(doc, cols, [
        idx + 1,
        item.productName,
        item.quantity,
        fmtTaka(item.price),
        fmtTaka(item.refundTotal),
      ], y, idx % 2 !== 0);

      // Restock badge on same row right side
      const badge = item.restockItem ? '✓ Restocked' : '✗ Not restocked';
      const badgeColor = item.restockItem ? C.success : C.muted;
      reg(doc).fillColor(badgeColor).fontSize(7)
         .text(badge, MARGIN + 6, y - 12, { width: 100 });
    });

    // ── Total block ──────────────────────────────────────────────────────────
    y += 6;
    const totalRefund = parseFloat(ret.totalRefund || 0);
    const settled     = parseFloat(ret.appliedToDue || 0);
    const cashBack    = Math.round((totalRefund - settled) * 100) / 100;

    // A refund against a credit sale does two things: it cancels debt and it
    // hands over cash. The PDF showed only the total, so a customer holding it
    // could not tell how much money they actually received — which is exactly
    // the conversation this document exists to settle.
    totalBlock(doc, settled > 0 ? [
      { label: 'TOTAL REFUNDED',   value: fmtTaka(totalRefund), bold: true, large: true, bg: C.red_bg },
      { label: 'Cleared from debt', value: fmtTaka(settled) },
      { label: 'Cash handed back',  value: fmtTaka(cashBack), bold: true },
      { label: 'Refund Method',     value: (ret.refundMethod || 'cash').toUpperCase() },
    ] : [
      { label: 'TOTAL REFUNDED', value: fmtTaka(totalRefund), bold: true, large: true, bg: C.red_bg },
      { label: 'Refund Method',  value: (ret.refundMethod || 'cash').toUpperCase() },
    ], y);

    if (ret.note) {
      reg(doc).fillColor(C.muted).fontSize(8)
         .text(`Note: ${ret.note}`, MARGIN, y + 80, { width: COL_W * 0.6 });
    }

    // ── Footer message ───────────────────────────────────────────────────────
    const tyY = A4_H - 95;
    doc.rect(MARGIN, tyY, COL_W, 28).fill(C.light);
    bold(doc).fillColor(C.primary).fontSize(10)
       .text('Return processed. Thank you for your patience.', MARGIN, tyY + 9, { width: COL_W, align: 'center' });

    doc.flushPages();
    drawFooter(doc);
    doc.end();
  } catch (err) {
    console.error('generateReturnPDF error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};