/**
 * Thermal receipt printing, 58mm and 80mm.
 *
 * Shops here run one of two paper widths and the difference is not cosmetic:
 * 58mm paper has about 48mm of printable width, which is roughly 32 monospace
 * characters. A four-column table that fits 80mm simply will not fit, so the
 * narrow layout drops to two lines per item rather than shrinking type nobody
 * could then read.
 *
 * Three things this has to get right that the previous version did not:
 *
 *  1. FONT. It printed in Courier New, which has no Bengali glyphs at all — a
 *     Bangla receipt would have come out as boxes. The self-hosted Hind
 *     Siliguri files are referenced by their hashed build URL, which works
 *     because the print window is same-origin.
 *
 *  2. MONEY. It rounded every amount to whole taka with its own formatter, so
 *     the printed total could disagree with the total on screen. The caller
 *     passes the app's money() now.
 *
 *  3. CLOSING THE WINDOW. It called window.print() then window.close()
 *     immediately. Chrome renders the print preview asynchronously, so closing
 *     on the next line can cancel the job. It now waits for afterprint, with a
 *     timeout for browsers that never fire it.
 *
 * No driver or helper app is involved: this is a plain HTML document sized
 * with @page, which every desktop and Android browser can send to a thermal
 * printer directly.
 */
import bnRegular from '../fonts/hind-siliguri-bengali-400.woff2';
import bnBold from '../fonts/hind-siliguri-bengali-700.woff2';

/** Shop identity on the receipt. One place to change it. */
export const SHOP = {
  name: 'Domingo Shop',
  nameBn: 'ডমিঙ্গো শপ',
  address: 'Dhaka, Bangladesh',
  addressBn: 'ঢাকা, বাংলাদেশ',
  phone: '',
};

const PAPER = {
  58: { page: '58mm', body: '54mm', base: 11, name: 13, total: 14, compact: true },
  80: { page: '80mm', body: '76mm', base: 12, name: 15, total: 16, compact: false },
};

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Builds the receipt document.
 *
 * @param inv     the sale, as returned by POST /api/sales
 * @param opts    { width, t, money, lang, cashier, tendered }
 *
 * `tendered` is the cash actually handed over. It cannot be read off the sale:
 * the server stores `paid` capped at the invoice total, because the excess is
 * change given back rather than money owed to the shop. So the till passes it
 * at print time, and when it is absent — reprinting an old invoice from Sales
 * History, say — the received/change lines are simply omitted rather than
 * invented.
 */
/**
 * The paper shell — fonts, page size, type scale, the print colour override.
 *
 * Extracted so the refund slip is physically the same document as the sale
 * receipt: same width, same embedded Bengali face, same rules. Two copies of
 * this would drift, and the first sign would be a refund slip printing Bengali
 * as boxes on the one occasion it matters.
 */
function shellOpen(p, bn, title) {
  return `<!DOCTYPE html>
<html lang="${bn ? 'bn' : 'en'}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  /* Bengali must be embedded or the receipt prints as boxes. Same-origin, so
     the hashed build URLs resolve inside the print window. */
  @font-face { font-family:'Hind Siliguri'; font-style:normal; font-weight:400;
               src:url('${bnRegular}') format('woff2'); }
  @font-face { font-family:'Hind Siliguri'; font-style:normal; font-weight:700;
               src:url('${bnBold}') format('woff2'); }

  @page { size: ${p.page} auto; margin: 0; }

  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${p.body};
    padding:3mm 2mm;
    background:#fff;
    color:#000;
    font-family:'Hind Siliguri', ui-monospace, 'Courier New', monospace;
    font-size:${p.base}px;
    line-height:1.45;
    -webkit-font-smoothing:none;
  }
  .c{text-align:center} .r{text-align:right} .b{font-weight:700}
  .shop{font-size:${p.name}px;font-weight:700;letter-spacing:.3px}
  .muted{font-size:${p.base - 1}px;color:#000;opacity:.75}
  .hr{border-top:1px dashed #000;margin:4px 0}
  .hr2{border-top:1px solid #000;margin:4px 0}
  .row{display:flex;justify-content:space-between;gap:6px;margin:1px 0}
  .row>span:last-child{white-space:nowrap}
  table{width:100%;border-collapse:collapse;margin:3px 0}
  th{font-size:${p.base - 1}px;font-weight:700;border-bottom:1px solid #000;padding:2px 1px;text-align:left}
  td{padding:2px 1px;vertical-align:top;border-bottom:1px dotted #999}
  .it{margin:3px 0;border-bottom:1px dotted #999;padding-bottom:2px}
  .it-name{font-weight:700}
  .it-line{font-size:${p.base - 1}px}
  .total{font-size:${p.total}px;font-weight:700;margin:3px 0}
  .duebox{border:2px solid #000;padding:3px 5px;margin:4px 0;font-weight:700}
  .thanks{margin-top:6px;font-size:${p.base}px;font-weight:700}
  /* Thermal paper is black on white; never let a colour scheme invert it. */
  @media print { body{-webkit-print-color-adjust:exact;print-color-adjust:exact} }
</style>
</head>
<body>`;
}

const SHELL_CLOSE = `
</body>
</html>`;

export function buildReceiptHtml(inv, { width = 80, t, money, lang = 'bn', cashier = '', tendered = null } = {}) {
  const p = PAPER[width] || PAPER[80];
  const bn = lang === 'bn';

  const when = new Date(inv.createdAt || Date.now());
  const date = when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });

  const subtotal = Number(inv.total || 0) + Number(inv.discount || 0);
  const paid = Number(inv.paid || 0);
  const due = Number(inv.due || 0);
  const total = Number(inv.total || 0);
  const cash = tendered == null ? null : Number(tendered);
  const change = cash == null ? 0 : Math.max(0, Math.round((cash - total) * 100) / 100);

  const items = Array.isArray(inv.items) ? inv.items : [];

  // 80mm: four columns. 58mm: name on its own line, then qty x price … amount.
  const itemRows = p.compact
    ? items.map((it) => `
        <div class="it">
          <div class="it-name">${esc(it.productName)}</div>
          <div class="row it-line">
            <span>${esc(it.quantity)} × ${esc(money(it.price))}</span>
            <span class="b">${esc(money(it.total))}</span>
          </div>
        </div>`).join('')
    : `<table>
         <thead><tr>
           <th>${esc(t('receipt.item'))}</th>
           <th class="c">${esc(t('receipt.qty'))}</th>
           <th class="r">${esc(t('receipt.price'))}</th>
           <th class="r">${esc(t('receipt.amount'))}</th>
         </tr></thead>
         <tbody>${items.map((it) => `
           <tr>
             <td>${esc(it.productName)}</td>
             <td class="c">${esc(it.quantity)}</td>
             <td class="r">${esc(money(it.price))}</td>
             <td class="r b">${esc(money(it.total))}</td>
           </tr>`).join('')}</tbody>
       </table>`;

  const line = (label, value, cls = '') =>
    `<div class="row ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

  return shellOpen(p, bn, inv.invoiceNo || '') + `
  <div class="c">
    <div class="shop">${esc(bn ? SHOP.nameBn : SHOP.name)}</div>
    <div class="muted">${esc(bn ? SHOP.addressBn : SHOP.address)}</div>
    ${SHOP.phone ? `<div class="muted">${esc(SHOP.phone)}</div>` : ''}
  </div>

  <div class="hr"></div>
  ${line(t('receipt.invoice'), inv.invoiceNo || '')}
  ${line(t('receipt.date'), `${date} ${time}`)}
  ${cashier ? line(t('receipt.cashier'), cashier) : ''}
  ${line(t('receipt.customer'), (inv.customer && inv.customer.name) || t('pos.walkInCustomer'))}

  <div class="hr"></div>
  ${itemRows}

  <div class="hr2"></div>
  ${Number(inv.discount || 0) > 0 ? line(t('receipt.subtotal'), money(subtotal)) : ''}
  ${Number(inv.discount || 0) > 0 ? line(
      inv.discountMode === 'percent' && inv.discountRate
        ? t('receipt.discountPct', { rate: Number(inv.discountRate) })
        : t('receipt.discount'),
      `- ${money(inv.discount)}`) : ''}
  <div class="row total"><span>${esc(t('receipt.total'))}</span><span>${esc(money(inv.total))}</span></div>
  ${line(t('receipt.paymentMethod'), t(`pos.payment.${inv.paymentMethod || 'cash'}`))}
  ${cash != null ? line(t('pos.amountReceived'), money(cash), 'b') : line(t('receipt.paid'), money(paid), 'b')}
  ${change > 0 ? line(t('receipt.change'), money(change), 'b') : ''}
  ${due > 0 ? `<div class="row duebox"><span>${esc(t('receipt.due'))}</span><span>${esc(money(due))}</span></div>` : ''}

  <div class="hr"></div>
  <div class="c thanks">${esc(t('receipt.thankYou'))}</div>
  <div class="c muted">${esc(t('receipt.noExchange'))}</div>
  <div class="hr"></div>` + SHELL_CLOSE;
}

/**
 * A refund slip.
 *
 * There was no printed record of a return at all — the split showed on screen
 * and the customer walked out with nothing. A refund that settles a debt and
 * hands back cash does two things at once, and a customer who cannot see which
 * was which has only the shopkeeper's word for it. That is a dispute waiting
 * to happen, so the split is the point of this document, not a detail on it.
 */
export function buildReturnReceiptHtml(ret, { width = 80, t, money, lang = 'bn', cashier = '' } = {}) {
  const p = PAPER[width] || PAPER[80];
  const bn = lang === 'bn';

  const when = new Date(ret.createdAt || Date.now());
  const date = when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });

  const items = Array.isArray(ret.items) ? ret.items : [];
  const total = Number(ret.totalRefund || 0);
  const settled = Number(ret.appliedToDue || 0);
  const cash = ret.cashRefund != null ? Number(ret.cashRefund) : Math.max(0, total - settled);

  const line = (label, value, cls = '') =>
    `<div class="row ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

  const itemRows = p.compact
    ? items.map((it) => `
        <div class="it">
          <div class="it-name">${esc(it.productName)}</div>
          <div class="row it-line">
            <span>${esc(it.quantity)} × ${esc(money(it.price))}</span>
            <span class="b">${esc(money(it.refundTotal))}</span>
          </div>
        </div>`).join('')
    : `<table>
         <thead><tr>
           <th>${esc(t('receipt.item'))}</th>
           <th class="c">${esc(t('receipt.qty'))}</th>
           <th class="r">${esc(t('receipt.price'))}</th>
           <th class="r">${esc(t('receipt.amount'))}</th>
         </tr></thead>
         <tbody>${items.map((it) => `
           <tr>
             <td>${esc(it.productName)}</td>
             <td class="c">${esc(it.quantity)}</td>
             <td class="r">${esc(money(it.price))}</td>
             <td class="r">${esc(money(it.refundTotal))}</td>
           </tr>`).join('')}
         </tbody>
       </table>`;

  return shellOpen(p, bn, ret.returnNo || '') + `
  <div class="c">
    <div class="shop">${esc(bn ? SHOP.nameBn : SHOP.name)}</div>
    <div class="muted">${esc(bn ? SHOP.addressBn : SHOP.address)}</div>
    ${SHOP.phone ? `<div class="muted">${esc(SHOP.phone)}</div>` : ''}
  </div>

  <div class="hr"></div>
  <div class="c thanks">${esc(t('receipt.returnTitle'))}</div>
  <div class="hr"></div>

  ${line(t('receipt.returnNo'), ret.returnNo || '')}
  ${ret.sale && ret.sale.invoiceNo ? line(t('receipt.againstInvoice'), ret.sale.invoiceNo) : ''}
  ${line(t('receipt.date'), `${date} ${time}`)}
  ${cashier ? line(t('receipt.cashier'), cashier) : ''}
  ${line(t('receipt.customer'), (ret.customer && ret.customer.name) || t('pos.walkInCustomer'))}

  <div class="hr"></div>
  ${itemRows}

  <div class="hr2"></div>
  <div class="row total"><span>${esc(t('returns.totalRefunded'))}</span><span>${esc(money(total))}</span></div>

  ${settled > 0 ? `
    ${line(t('returns.settledDebt'), money(settled), 'b')}
    <div class="row duebox"><span>${esc(t('returns.cashHandedBack'))}</span><span>${esc(money(cash))}</span></div>
  ` : line(t('returns.refundVia'), t(`pos.payment.${ret.refundMethod || 'cash'}`))}

  ${ret.reason ? line(t('returns.reason'), ret.reason) : ''}

  <div class="hr"></div>
  <div class="c muted">${esc(t('receipt.returnFooter'))}</div>
  <div class="hr"></div>` + SHELL_CLOSE;
}

/** Print a refund slip. Same window handling as a sale receipt. */
export function printReturnReceipt(ret, opts = {}) {
  return printHtml(buildReturnReceiptHtml(ret, opts));
}

/**
 * Opens the receipt in its own window and prints it.
 *
 * Returns false when the pop-up was blocked, so the caller can say so rather
 * than leaving the cashier waiting for a printer that was never asked.
 */
export function printReceipt(inv, opts = {}) {
  return printHtml(buildReceiptHtml(inv, opts));
}

/** Opens a document in its own window and prints it. */
function printHtml(html) {
  const win = window.open('', '_blank', 'width=380,height=640');
  if (!win) return false;

  win.document.open();
  win.document.write(html);
  win.document.close();

  // Wait for the embedded font before printing, or the first receipt of the
  // session prints in the fallback face while the woff2 is still loading.
  const go = () => {
    const done = () => { try { win.close(); } catch { /* already gone */ } };
    win.addEventListener('afterprint', done, { once: true });
    win.focus();
    win.print();
    // Some browsers never fire afterprint; do not leave a window stranded.
    setTimeout(done, 60000);
  };

  const fonts = win.document.fonts;
  if (fonts && fonts.ready) fonts.ready.then(go).catch(go);
  else win.setTimeout(go, 400);

  return true;
}

/** The width the shop last printed at — a shop has one printer. */
const WIDTH_KEY = 'domingo.receiptWidth';
export const savedReceiptWidth = () => {
  try { return Number(localStorage.getItem(WIDTH_KEY)) === 58 ? 58 : 80; } catch { return 80; }
};
export const saveReceiptWidth = (w) => {
  try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* storage off */ }
};
