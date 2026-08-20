/**
 * Inventory — stock health and the movement ledger.
 *
 * Two things a shop owner could not previously see anywhere:
 *   1. What the stock on the shelves is actually worth.
 *   2. Why a stock number is what it is — every sale, return and adjustment
 *      that moved it, with who did it and when.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { money, num, dateTime, errorMessage, todayISO } from '../utils/config';
import {
  StockBadge, Badge, EmptyState, ErrorState, TableSkeleton,
  Pagination, useDebounced, SortHeader, useSort,
} from '../components/ui';

const MOVEMENT_TYPES = {
  initial:    { label: 'Opening',    tone: 'neutral' },
  sale:       { label: 'Sale',       tone: 'blue' },
  return:     { label: 'Return',     tone: 'violet' },
  purchase:   { label: 'Purchase',   tone: 'green' },
  adjustment: { label: 'Adjustment', tone: 'amber' },
  damage:     { label: 'Damage',     tone: 'red' },
  correction: { label: 'Recount',    tone: 'amber' },
};

export default function Inventory({ darkMode, toggleDark }) {
  const [tab, setTab] = useState('stock');

  // ── Stock tab ─────────────────────────────────────────────────────────────
  const [rows, setRows]         = useState([]);
  const [totals, setTotals]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const debouncedSearch = useDebounced(search, 250);
  const { sort, onSort, apply } = useSort('status');

  const loadStock = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get('/reports/inventory');
      setRows(res.data.data || []);
      setTotals(res.data.totals || null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the inventory report'));
    } finally { setLoading(false); }
  }, []);

  // ── Movements tab ─────────────────────────────────────────────────────────
  const [moves, setMoves]       = useState([]);
  const [movePage, setMovePage] = useState(1);
  const [moveLimit, setMoveLimit] = useState(50);
  const [movePagination, setMovePagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 });
  const [moveType, setMoveType] = useState('');
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo]     = useState('');
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState(null);

  const loadMoves = useCallback(async () => {
    setMoveLoading(true); setMoveError(null);
    try {
      const params = { page: movePage, limit: moveLimit };
      if (moveType) params.type = moveType;
      if (moveFrom && moveTo) { params.from = moveFrom; params.to = moveTo; }
      const res = await api.get('/reports/stock-movements', { params });
      setMoves(res.data.data || []);
      setMovePagination(res.data.pagination || { page: 1, pages: 1, total: 0, limit: moveLimit });
    } catch (err) {
      setMoveError(errorMessage(err, 'Could not load stock history'));
    } finally { setMoveLoading(false); }
  }, [movePage, moveLimit, moveType, moveFrom, moveTo]);

  useEffect(() => { loadStock(); }, [loadStock]);
  useEffect(() => { if (tab === 'movements') loadMoves(); }, [tab, loadMoves]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const counts = {
    all: rows.length,
    out: rows.filter(r => r.status === 'out').length,
    low: rows.filter(r => r.status === 'low').length,
  };

  const q = debouncedSearch.trim().toLowerCase();
  const filtered = apply(
    rows.filter(r => {
      const matchQ = !q ||
        r.name.toLowerCase().includes(q) ||
        (r.sku && r.sku.toLowerCase().includes(q)) ||
        (r.categoryName && r.categoryName.toLowerCase().includes(q));
      const matchS = statusFilter === 'all' || r.status === statusFilter;
      return matchQ && matchS;
    }),
    {
      // Out-of-stock first, then low, then healthy — the order a shopkeeper cares about.
      status: (r) => ({ out: 0, low: 1, ok: 2 }[r.status]),
      value:  (r) => parseFloat(r.stockRetailValue),
    }
  );

  const exportCsv = () => {
    const head = ['Product', 'SKU', 'Category', 'Supplier', 'Stock', 'Unit', 'Alert at', 'Cost', 'Price', 'Stock cost value', 'Stock retail value', 'Status'];
    const body = filtered.map(r => [
      r.name, r.sku || '', r.categoryName || '', r.supplierName || '',
      r.stock, r.unit || '', r.lowStockAlert, r.cost, r.price,
      r.stockCostValue, r.stockRetailValue, r.status,
    ]);
    const csv = [head, ...body]
      .map(line => line.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Inventory exported');
  };

  return (
    <Layout
      title="Stock & History"
      subtitle="What is on the shelves, and every movement behind it"
      darkMode={darkMode} toggleDark={toggleDark}
      actions={
        <button className="btn btn-outline" onClick={exportCsv} disabled={!filtered.length}>
          ⬇ Export CSV
        </button>
      }
    >
      {/* ── Valuation KPIs ────────────────────────────────────────────────── */}
      {totals && (
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Stock value (cost)</div>
            <div className="kpi-value">{money(totals.costValue)}</div>
            <div className="kpi-sub">What the stock cost you</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Stock value (retail)</div>
            <div className="kpi-value">{money(totals.retailValue)}</div>
            <div className="kpi-sub">
              Margin locked up: {money(totals.retailValue - totals.costValue)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Units on hand</div>
            <div className="kpi-value">{num(totals.units)}</div>
            <div className="kpi-sub">Across {totals.productCount} products</div>
          </div>
          <div
            className={`kpi clickable ${totals.out > 0 ? 'is-critical' : ''}`}
            onClick={() => { setTab('stock'); setStatusFilter('out'); }}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && (setTab('stock'), setStatusFilter('out'))}
          >
            <div className="kpi-label">Out of stock</div>
            <div className="kpi-value">{totals.out}</div>
            <div className="kpi-sub">{totals.out ? 'Cannot be sold right now' : 'Nothing is out'}</div>
          </div>
          <div
            className={`kpi clickable ${totals.low > 0 ? 'is-warning' : ''}`}
            onClick={() => { setTab('stock'); setStatusFilter('low'); }}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && (setTab('stock'), setStatusFilter('low'))}
          >
            <div className="kpi-label">Low stock</div>
            <div className="kpi-value">{totals.low}</div>
            <div className="kpi-sub">{totals.low ? 'Reorder soon' : 'All above threshold'}</div>
          </div>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="chip-row" style={{ marginBottom: 14 }}>
        <button className={`chip ${tab === 'stock' ? 'active' : ''}`} onClick={() => setTab('stock')}>
          📦 Stock levels<span className="chip-count">{rows.length}</span>
        </button>
        <button className={`chip ${tab === 'movements' ? 'active' : ''}`} onClick={() => setTab('movements')}>
          🧾 Stock history
        </button>
      </div>

      {/* ── Stock levels ──────────────────────────────────────────────────── */}
      {tab === 'stock' && (
        <div className="card">
          <div className="toolbar">
            <div className="toolbar-search">
              <span className="toolbar-search-icon" aria-hidden="true">🔍</span>
              <input
                className="form-control"
                placeholder="Search by product, SKU or category…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search inventory"
              />
              {search && (
                <button className="toolbar-clear" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
              )}
            </div>
            <div className="chip-row">
              <button className={`chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
                All<span className="chip-count">{counts.all}</span>
              </button>
              <button className={`chip ${statusFilter === 'out' ? 'active danger' : ''}`} onClick={() => setStatusFilter('out')}>
                Out of stock<span className="chip-count">{counts.out}</span>
              </button>
              <button className={`chip ${statusFilter === 'low' ? 'active warn' : ''}`} onClick={() => setStatusFilter('low')}>
                Low stock<span className="chip-count">{counts.low}</span>
              </button>
            </div>
            <span className="toolbar-count">{filtered.length} shown</span>
          </div>

          {loading ? <TableSkeleton rows={8} cols={6} />
            : error ? <ErrorState message={error} onRetry={loadStock} />
            : filtered.length === 0 ? (
              <EmptyState
                icon={statusFilter === 'out' ? '✅' : '🔍'}
                title={statusFilter === 'out' ? 'Nothing is out of stock' : 'No products match'}
                message={
                  statusFilter === 'out' ? 'Every active product has at least one unit on the shelf.'
                  : statusFilter === 'low' ? 'No product has dropped to its low-stock threshold.'
                  : 'Try a different search term or clear the filters.'
                }
                action={(search || statusFilter !== 'all') && (
                  <button className="btn btn-outline" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
                    Clear filters
                  </button>
                )}
              />
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader label="Product"  field="name"   sort={sort} onSort={onSort} />
                      <SortHeader label="Category" field="categoryName" sort={sort} onSort={onSort} />
                      <SortHeader label="Stock"    field="stock"  sort={sort} onSort={onSort} align="right" />
                      <SortHeader label="Status"   field="status" sort={sort} onSort={onSort} />
                      <SortHeader label="Cost val." field="stockCostValue" sort={sort} onSort={onSort} align="right" />
                      <SortHeader label="Retail val." field="value" sort={sort} onSort={onSort} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.name}</div>
                          <div className="mono" style={{ color: 'var(--text-muted)' }}>
                            {r.sku || '—'}{r.supplierName ? ` · ${r.supplierName}` : ''}
                          </div>
                        </td>
                        <td>{r.categoryName || <span style={{ color: 'var(--text-muted)' }}>Uncategorised</span>}</td>
                        <td className="num">
                          <b>{num(r.stock)}</b> <span style={{ color: 'var(--text-muted)' }}>{r.unit}</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>alert at {r.lowStockAlert}</div>
                        </td>
                        <td><StockBadge stock={r.stock} lowStockAlert={r.lowStockAlert} showCount={false} /></td>
                        <td className="num">{money(r.stockCostValue)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(r.stockRetailValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                      <td colSpan={4} style={{ padding: '12px 16px' }}>Total ({filtered.length} products shown)</td>
                      <td className="num" style={{ padding: '12px 16px' }}>
                        {money(filtered.reduce((s, r) => s + parseFloat(r.stockCostValue || 0), 0))}
                      </td>
                      <td className="num" style={{ padding: '12px 16px' }}>
                        {money(filtered.reduce((s, r) => s + parseFloat(r.stockRetailValue || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── Movement ledger ───────────────────────────────────────────────── */}
      {tab === 'movements' && (
        <div className="card">
          <div className="toolbar">
            <select
              className="form-control" style={{ width: 'auto', minWidth: 160 }}
              value={moveType}
              onChange={(e) => { setMoveType(e.target.value); setMovePage(1); }}
              aria-label="Filter by movement type"
            >
              <option value="">All movement types</option>
              {Object.entries(MOVEMENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <input type="date" className="form-control" style={{ width: 'auto' }}
                   value={moveFrom} onChange={(e) => { setMoveFrom(e.target.value); setMovePage(1); }}
                   aria-label="From date" />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>to</span>
            <input type="date" className="form-control" style={{ width: 'auto' }}
                   value={moveTo} onChange={(e) => { setMoveTo(e.target.value); setMovePage(1); }}
                   aria-label="To date" />
            {(moveType || moveFrom || moveTo) && (
              <button className="btn btn-outline btn-sm"
                      onClick={() => { setMoveType(''); setMoveFrom(''); setMoveTo(''); setMovePage(1); }}>
                Clear
              </button>
            )}
          </div>

          {moveLoading ? <TableSkeleton rows={8} cols={6} />
            : moveError ? <ErrorState message={moveError} onRetry={loadMoves} />
            : moves.length === 0 ? (
              <EmptyState
                icon="🧾"
                title="No stock movements yet"
                message="Every sale, return and stock adjustment from now on will be recorded here — showing who changed what, when, and the level before and after."
              />
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Product</th>
                        <th>Type</th>
                        <th className="num">Change</th>
                        <th className="num">Before → After</th>
                        <th>Reference</th>
                        <th>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moves.map((m) => {
                        const meta = MOVEMENT_TYPES[m.type] || { label: m.type, tone: 'neutral' };
                        const inbound = m.quantity > 0;
                        return (
                          <tr key={m.id}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{dateTime(m.createdAt)}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{m.productName}</div>
                              {m.product?.sku && <div className="mono" style={{ color: 'var(--text-muted)' }}>{m.product.sku}</div>}
                            </td>
                            <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                            <td className={`num ${inbound ? 'delta-in' : 'delta-out'}`}>
                              {inbound ? '+' : ''}{num(m.quantity)}
                            </td>
                            <td className="num" style={{ color: 'var(--text-secondary)' }}>
                              {num(m.stockBefore)} → <b style={{ color: 'var(--text-primary)' }}>{num(m.stockAfter)}</b>
                            </td>
                            <td>
                              <div className="mono">{m.reference || '—'}</div>
                              {m.note && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.note}</div>}
                            </td>
                            <td style={{ fontSize: 12 }}>{m.userName || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={movePagination.page} pages={movePagination.pages}
                  total={movePagination.total} limit={movePagination.limit}
                  onPage={setMovePage}
                  onLimit={(n) => { setMoveLimit(n); setMovePage(1); }}
                />
              </>
            )}
        </div>
      )}
    </Layout>
  );
}
