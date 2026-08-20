/**
 * Shared UI primitives.
 *
 * These exist so the same interaction does not get reinvented per page with
 * slightly different behaviour — in particular destructive confirmations, which
 * were plain window.confirm() dialogs that a cashier can dismiss by reflex and
 * which cannot explain what is about to be lost.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';

/* ── Confirm dialog ───────────────────────────────────────────────────────── */
/**
 * Replaces window.confirm for destructive actions.
 * - Explains the consequence, not just "are you sure".
 * - Cancel is focused by default so Enter never destroys anything.
 * - Optional `requireText` forces the user to type a word for the worst cases.
 */
export function ConfirmDialog({
  open, title, message, detail, confirmLabel = 'Delete', cancelLabel = 'Cancel',
  tone = 'danger', requireText, busy, onConfirm, onCancel,
}) {
  const [typed, setTyped] = useState('');
  const cancelRef = useRef(null);

  useEffect(() => { if (open) { setTyped(''); setTimeout(() => cancelRef.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  const blocked = requireText ? typed.trim().toLowerCase() !== requireText.toLowerCase() : false;

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
           onClick={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <div className={`confirm-icon ${tone}`} aria-hidden="true">{tone === 'danger' ? '!' : '?'}</div>
          <div style={{ minWidth: 0 }}>
            <h3 id="confirm-title" className="confirm-title">{title}</h3>
            <p className="confirm-message">{message}</p>
            {detail && <div className="confirm-detail">{detail}</div>}
            {requireText && (
              <label className="confirm-typebox">
                <span>Type <b>{requireText}</b> to confirm</span>
                <input className="form-control" value={typed} autoComplete="off"
                       onChange={(e) => setTyped(e.target.value)} />
              </label>
            )}
          </div>
        </div>
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn btn-outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                  onClick={onConfirm} disabled={busy || blocked}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hook that wires a ConfirmDialog to any async action. */
export function useConfirm() {
  const [state, setState] = useState({ open: false });
  const [busy, setBusy] = useState(false);

  const ask = useCallback((opts) => setState({ open: true, ...opts }), []);
  const close = useCallback(() => { setBusy(false); setState({ open: false }); }, []);

  const dialog = (
    <ConfirmDialog
      {...state}
      busy={busy}
      onCancel={close}
      onConfirm={async () => {
        setBusy(true);
        try { await state.onConfirm?.(); close(); }
        catch { setBusy(false); }
      }}
    />
  );
  return { ask, close, dialog };
}

/* ── Stock status badge ───────────────────────────────────────────────────── */
/** One consistent read on stock health, so "LOW STOCK" looks the same everywhere. */
export function StockBadge({ stock, lowStockAlert = 10, unit = '', showCount = true }) {
  const n = Number(stock) || 0;
  const threshold = Number(lowStockAlert) || 0;
  let cls = 'ok', label = 'In stock';
  if (n <= 0) { cls = 'out'; label = 'Out of stock'; }
  else if (n <= threshold) { cls = 'low'; label = 'Low stock'; }

  return (
    <span className={`stock-badge ${cls}`} title={`${n} ${unit} in stock (alert at ${threshold})`}>
      <span className="stock-dot" aria-hidden="true" />
      {showCount && <b>{n}</b>}
      <span>{showCount ? (unit || '') : label}</span>
      {showCount && cls !== 'ok' && <span className="stock-tag">{cls === 'out' ? 'OUT' : 'LOW'}</span>}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}

/* ── States ───────────────────────────────────────────────────────────────── */
export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-icon" aria-hidden="true">{icon}</div>
      <div className="ui-empty-title">{title}</div>
      {message && <div className="ui-empty-msg">{message}</div>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-icon" aria-hidden="true">⚠️</div>
      <div className="ui-empty-title">Could not load this</div>
      <div className="ui-empty-msg">{message}</div>
      {onRetry && <div className="ui-empty-action"><button className="btn btn-outline" onClick={onRetry}>Try again</button></div>}
    </div>
  );
}

/** Skeleton rows — keeps table height stable instead of collapsing to a spinner. */
export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="skeleton-table" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <div className="skeleton-cell" key={c} style={{ width: `${[28, 16, 14, 18, 12, 12][c % 6]}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="loading-page">
      <div className="spinner" />
      {label && <p>{label}</p>}
    </div>
  );
}

/* ── Pagination ───────────────────────────────────────────────────────────── */
export function Pagination({ page, pages, total, limit, onPage, onLimit }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing <b>{from}–{to}</b> of <b>{total}</b>
      </div>
      <div className="pagination-controls">
        {onLimit && (
          <select className="form-control pagination-size" value={limit}
                  onChange={(e) => onLimit(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">«</button>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span className="pagination-page">Page {page} of {pages || 1}</span>
        <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Last page">»</button>
      </div>
    </div>
  );
}

/* ── Debounce ─────────────────────────────────────────────────────────────── */
/** Keeps typing responsive by not firing a request on every keystroke. */
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/* ── Sortable table header ────────────────────────────────────────────────── */
export function SortHeader({ label, field, sort, onSort, align = 'left', width }) {
  const active = sort.field === field;
  return (
    <th style={{ textAlign: align, width, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => onSort(field)}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}
      <span className={`sort-arrow ${active ? 'active' : ''}`} aria-hidden="true">
        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}

/** Client-side sorting shared by the list pages. */
export function useSort(initialField, initialDir = 'asc') {
  const [sort, setSort] = useState({ field: initialField, dir: initialDir });
  const onSort = useCallback((field) => {
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  }, []);
  const apply = useCallback((rows, accessors = {}) => {
    const get = accessors[sort.field] || ((r) => r[sort.field]);
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      const an = typeof av === 'number' || (!Number.isNaN(parseFloat(av)) && typeof av !== 'object');
      const cmp = an && typeof bv !== 'object'
        ? (parseFloat(av) || 0) - (parseFloat(bv) || 0)
        : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [sort]);
  return { sort, onSort, apply };
}
