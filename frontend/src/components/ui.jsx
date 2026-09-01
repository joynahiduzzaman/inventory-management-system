/**
 * Shared UI primitives.
 *
 * These exist so the same interaction does not get reinvented per page with
 * slightly different behaviour — in particular destructive confirmations, which
 * were plain window.confirm() dialogs that a cashier can dismiss by reflex and
 * which cannot explain what is about to be lost.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useT } from '../i18n';
import { fileUrl } from '../utils/config';

/* ── Button ───────────────────────────────────────────────────────────────── */
/**
 * The one button.
 *
 * Every page was styling its own with an inline gradient, its own padding and
 * its own height — which is why the audit found 146 of 158 controls under the
 * 44px touch floor on a single page. This enforces the floor, and gives
 * `loading` real meaning: the button disables itself while a request is in
 * flight, which is what stops a double-tap becoming a double sale on a slow
 * connection.
 */
export const Button = React.forwardRef(function Button({
  variant = 'secondary', size = 'md', loading = false, disabled = false,
  icon, iconRight, block = false, type = 'button', className = '', children, ...rest
}, ref) {
  const { t } = useT();
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-btn ui-btn--${variant} ui-btn--${size}${block ? ' ui-btn--block' : ''}${loading ? ' is-loading' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ui-btn-spinner" aria-hidden="true" />}
      {!loading && icon && <span className="ui-btn-icon" aria-hidden="true">{icon}</span>}
      <span className="ui-btn-label">{loading ? t('common.loading') : children}</span>
      {!loading && iconRight && <span className="ui-btn-icon" aria-hidden="true">{iconRight}</span>}
    </button>
  );
});

/* ── Icon button ──────────────────────────────────────────────────────────── */
/**
 * An icon-only control that is still readable.
 *
 * The row actions used to be bare emoji in a 30px box with only a `title`
 * tooltip — invisible on a touch screen, and meaningless to someone who does
 * not read English. `label` is mandatory here: it becomes the accessible name,
 * the tooltip, and (on wide screens, when `showLabel` is set) visible text.
 *
 * `variant="danger"` is styled to look destructive rather than identical to
 * Edit, so archiving cannot be confused with editing at a glance.
 */
export function IconButton({
  icon, label, variant = 'ghost', size = 'md', showLabel = false,
  loading = false, disabled = false, className = '', ...rest
}) {
  if (process.env.NODE_ENV !== 'production' && !label) {
    console.warn('[ui] IconButton needs a `label` — it is the accessible name.');
  }
  return (
    <button
      type="button"
      className={`ui-iconbtn ui-iconbtn--${variant} ui-iconbtn--${size}${showLabel ? ' has-label' : ''}${loading ? ' is-loading' : ''} ${className}`}
      title={label}
      aria-label={label}
      disabled={disabled || loading}
      {...rest}
    >
      <span className="ui-iconbtn-icon" aria-hidden="true">{icon}</span>
      {showLabel && <span className="ui-iconbtn-label">{label}</span>}
    </button>
  );
}

/* ── Product avatar ───────────────────────────────────────────────────────── */
/**
 * Muted palette for generated placeholders.
 *
 * Deliberately contains no green, amber or red: those three carry stock and
 * payment meaning everywhere else in this interface, and a product tile tinted
 * red because of how its category name happens to hash would read as "out of
 * stock" at a glance.
 */
const AVATAR_TONES = [
  { bg: '#e7edf5', fg: '#3c5573' },   // slate blue
  { bg: '#e9e9f4', fg: '#4a4a72' },   // muted indigo
  { bg: '#eae7f2', fg: '#574a72' },   // dusty violet
  { bg: '#e4eff0', fg: '#375d61' },   // deep teal
  { bg: '#f0ebe4', fg: '#6b5741' },   // warm taupe
  { bg: '#ece9e6', fg: '#5a5148' },   // stone
  { bg: '#e6eef0', fg: '#3f5b64' },   // steel
  { bg: '#efe9ee', fg: '#5f4657' },   // plum grey
];

/** Stable hash so the same category always gets the same tone. */
const toneFor = (seed) => {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};

/** Up to two initials, working for Bangla names as well as Latin. */
const initialsOf = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

/**
 * A product's picture, or a clean stand-in for one.
 *
 * Replaces the category emoji (👕 for clothing, 💊 for medicine) that used to
 * fill this slot. An emoji says nothing about *which* shirt, renders
 * differently on every platform, and sat next to real photographs looking
 * unfinished. Initials on a category-derived tone are at least consistent and
 * distinguishable, and never pretend to be a photograph.
 */
export function ProductAvatar({ product, size = 44, rounded = 'var(--radius-sm)', className = '' }) {
  const src = product && product.image ? fileUrl(product.image) : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  const name = (product && product.name) || '';
  const seed = (product && product.category && product.category.name) || product?.categoryId || name;
  const tone = useMemo(() => toneFor(seed), [seed]);

  const box = {
    width: size, height: size, borderRadius: rounded, flex: `0 0 ${size}px`,
  };

  if (src && !failed) {
    return (
      <img
        className={`ui-avatar ${className}`}
        style={box}
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`ui-avatar ui-avatar--generated ${className}`}
      style={{ ...box, background: tone.bg, color: tone.fg, fontSize: Math.round(size * 0.36) }}
      role="img"
      aria-label={name}
      title={name}
    >
      {initialsOf(name)}
    </div>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────────────────── */
/**
 * One figure, stated once.
 *
 * The dashboard used six `stat-card` colour variants — blue, green, amber, red
 * — assigned by taste rather than meaning, so a green "Monthly Sales" sat
 * beside a green "Stock Value" and a red "Out of Stock", and the red was the
 * only one that meant anything. Colour here is a `tone`, and a tone is only
 * ever set from the data: `danger` when something cannot be sold or is owed,
 * `warn` when it needs attention this week, `ok` when a number that is usually
 * a problem currently is not. Everything else is neutral, which is most of it.
 *
 * `onActivate` makes the whole tile a button — the low-stock and dues figures
 * are questions ("which ones?"), and the answer should be one tap away.
 */
export function Kpi({
  icon, value, label, sub, tone = 'neutral', onActivate, actionLabel, emphasis = false,
}) {
  const inner = (
    <>
      <span className={`kpi-icon tone-${tone}`} aria-hidden="true">{icon}</span>
      <span className={`kpi-value${emphasis ? ' is-emphasis' : ''} tone-${tone}`}>{value}</span>
      <span className="kpi-label">{label}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </>
  );

  if (!onActivate) return <div className={`kpi tone-${tone}`}>{inner}</div>;

  return (
    <button type="button" className={`kpi tone-${tone} is-clickable`} onClick={onActivate}
            aria-label={actionLabel || `${label}: ${value}`}>
      {inner}
      <span className="kpi-go" aria-hidden="true">→</span>
    </button>
  );
}

/* ── Confirm dialog ───────────────────────────────────────────────────────── */
/**
 * Replaces window.confirm for destructive actions.
 * - Explains the consequence, not just "are you sure".
 * - Cancel is focused by default so Enter never destroys anything.
 * - Optional `requireText` forces the user to type a word for the worst cases.
 */
export function ConfirmDialog({
  open, title, message, detail, confirmLabel, cancelLabel,
  tone = 'danger', requireText, busy, onConfirm, onCancel,
}) {
  const { t } = useT();
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
                <span>{t('common.confirm')}: <b>{requireText}</b></span>
                <input className="form-control" value={typed} autoComplete="off"
                       onChange={(e) => setTyped(e.target.value)} />
              </label>
            )}
          </div>
        </div>
        <div className="confirm-actions">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel || t('common.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'}
                  onClick={onConfirm} disabled={blocked} loading={busy}>
            {confirmLabel || t('common.delete')}
          </Button>
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
  const { t } = useT();
  const n = Number(stock) || 0;
  const threshold = Number(lowStockAlert) || 0;
  let cls = 'ok', label = t('status.inStock');
  if (n <= 0) { cls = 'out'; label = t('status.outOfStock'); }
  else if (n <= threshold) { cls = 'low'; label = t('status.lowStock'); }

  return (
    <span className={`stock-badge ${cls}`} title={`${label} — ${n} ${unit}`}>
      <span className="stock-dot" aria-hidden="true" />
      {showCount && <b>{n}</b>}
      <span>{showCount ? (unit || '') : label}</span>
      {showCount && cls !== 'ok' && <span className="stock-tag">{label}</span>}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}

/* ── States ───────────────────────────────────────────────────────────────── */
export function EmptyState({ icon, title, message, action }) {
  const { t } = useT();
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty-icon" aria-hidden="true">{icon}</div>}
      <div className="ui-empty-title">{title || t('empty.nothingHere')}</div>
      {message && <div className="ui-empty-msg">{message}</div>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  const { t } = useT();
  return (
    <div className="ui-empty ui-empty--error">
      <div className="ui-empty-icon" aria-hidden="true">!</div>
      <div className="ui-empty-title">{t('error.generic')}</div>
      {message && <div className="ui-empty-msg">{message}</div>}
      {onRetry && (
        <div className="ui-empty-action">
          <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button>
        </div>
      )}
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

/**
 * Placeholder tiles for a grid whose shape is already known.
 *
 * A spinner says "wait" and nothing else; the layout then appears all at once
 * and everything shifts. Drawing the tiles that are coming keeps the page
 * still and tells the cashier what is arriving.
 */
export function GridSkeleton({ count = 24 }) {
  return (
    <div className="pos-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="pos-tile-skeleton">
          <span className="sk-line sk-name" />
          <span className="sk-line sk-name sk-short" />
          <span className="sk-foot">
            <span className="sk-line sk-price" />
            <span className="sk-line sk-stock" />
          </span>
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
  const { t, num } = useT();
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="pagination">
      <div className="pagination-info">
        <b>{num(from)}–{num(to)}</b> {t('common.of')} <b>{num(total)}</b>
      </div>
      <div className="pagination-controls">
        {onLimit && (
          <select className="form-control pagination-size" value={limit}
                  onChange={(e) => onLimit(Number(e.target.value))} aria-label={t('common.page')}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / {t('common.page')}</option>)}
          </select>
        )}
        <IconButton icon="«" label={t('common.previous')} variant="outline" size="sm"
                    disabled={page <= 1} onClick={() => onPage(1)} />
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('common.previous')}
        </Button>
        <span className="pagination-page">{t('common.page')} {num(page)} {t('common.of')} {num(pages || 1)}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
        </Button>
        <IconButton icon="»" label={t('common.next')} variant="outline" size="sm"
                    disabled={page >= pages} onClick={() => onPage(pages)} />
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
