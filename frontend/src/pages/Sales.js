import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/config';
import { Pagination, TableSkeleton } from '../components/ui';

const fmt = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(0));

export default function Sales({ darkMode, toggleDark }) {
  const [sales, setSales]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [payFilter, setPayFilter] = useState('');
  const [dueFilter, setDueFilter] = useState(false);
  const [page, setPage]           = useState(1);
  const [limit, setLimit]         = useState(50);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 });
  // Summed over every matching sale, not just the visible page.
  const [totals, setTotals]       = useState({ revenue: 0, collected: 0, due: 0, count: 0 });

  // Collect due modal state
  const [dueModal, setDueModal]       = useState(null); // sale object
  const [collectAmt, setCollectAmt]   = useState('');
  const [collecting, setCollecting]   = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (dateFrom && dateTo) { params.from = dateFrom; params.to = dateTo; }
      if (payFilter) params.paymentMethod = payFilter;
      if (dueFilter) params.dueOnly = 'true';
      const res = await api.get('/sales', { params });
      setSales(res.data.data || []);
      if (res.data.totals)     setTotals(res.data.totals);
      if (res.data.pagination) setPagination(res.data.pagination);
    } catch (err) { toast.error(errorMessage(err, 'Failed to load sales')); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, payFilter, dueFilter, page, limit]);

  useEffect(() => { loadSales(); }, [loadSales]);

  // Changing a filter should always land you back on page 1.
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, payFilter, dueFilter]);

  const totalRevenue = totals.revenue;
  const totalPaid    = totals.collected;
  const totalDue     = totals.due;
  const dueCount     = sales.filter(s => parseFloat(s.due) > 0).length;

  // Due filtering now happens server-side so the totals and paging agree with it.
  const filteredSales = sales;

  const payColor = {
    cash:  { bg: '#dcfce7', color: '#166534' },
    bkash: { bg: '#fce7f3', color: '#9d174d' },
    nagad: { bg: '#fef3c7', color: '#92400e' },
    card:  { bg: '#dbeafe', color: '#1e40af' }
  };

  // ── Collect Due ──────────────────────────────────────────────────────────────
  const openDueModal = (sale) => {
    setDueModal(sale);
    setCollectAmt(parseFloat(sale.due).toFixed(0));
  };

  const handleCollectDue = async () => {
    if (!collectAmt || parseFloat(collectAmt) <= 0) return toast.error('Enter a valid amount');
    setCollecting(true);
    try {
      await api.patch(`/sales/${dueModal.id}/collect-due`, { amount: parseFloat(collectAmt) });
      toast.success(`৳${fmt(collectAmt)} collected successfully! ✅`);
      setDueModal(null);
      setCollectAmt('');
      loadSales();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to collect payment');
    } finally { setCollecting(false); }
  };

  return (
    <Layout
      title="Sales History"
      subtitle={`${pagination.total} ${dueFilter ? 'unpaid ' : ''}transaction${pagination.total !== 1 ? 's' : ''}`}
      darkMode={darkMode} toggleDark={toggleDark}
    >
      {/* Summary Cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '16px' }}>
        <div className="stat-card green">
          <div className="stat-icon green">💰</div>
          <div className="stat-value">৳{fmt(totalRevenue)}</div>
          <div className="stat-label">Total Revenue</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue">✅</div>
          <div className="stat-value">৳{fmt(totalPaid)}</div>
          <div className="stat-label">Total Collected</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon red">⏳</div>
          <div className="stat-value" style={{ color: totalDue > 0 ? '#dc2626' : '#22c55e' }}>
            ৳{fmt(totalDue)}
          </div>
          <div className="stat-label">Total Due</div>
          {totalDue > 0 && (
            <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', fontWeight: '600' }}>
              ⚠️ {sales.filter(s => parseFloat(s.due) > 0).length} unpaid invoices
            </div>
          )}
        </div>
      </div>

      {/* Due Alert Banner */}
      {totalDue > 0 && (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🔴</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '700', color: '#dc2626', fontSize: '13px' }}>
              Outstanding Due: ৳{fmt(totalDue)} — {dueCount} invoice{dueCount !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '2px' }}>
              {dueFilter
                ? `Showing ${filteredSales.length} due invoice${filteredSales.length !== 1 ? 's' : ''} — click 💳 Collect Due to record payment`
                : 'Click the 🔴 Due Only filter above or 💳 Collect Due button to record a payment'
              }
            </div>
          </div>
          {!dueFilter && (
            <button
              onClick={() => setDueFilter(true)}
              style={{ padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              🔴 Show Due Only
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>FROM</label>
            <input type="date" className="form-control" style={{ width: '160px' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={today} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>TO</label>
            <input type="date" className="form-control" style={{ width: '160px' }} value={dateTo} onChange={e => setDateTo(e.target.value)} max={today} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>PAYMENT</label>
            <select className="form-control" style={{ width: '140px' }} value={payFilter} onChange={e => setPayFilter(e.target.value)}>
              <option value="">All Methods</option>
              <option value="cash">Cash</option>
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
              <option value="card">Card</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>DUE STATUS</label>
            <button
              onClick={() => setDueFilter(!dueFilter)}
              style={{
                height: '38px', padding: '0 16px', borderRadius: '8px', fontSize: '13px',
                fontWeight: '700', cursor: 'pointer', border: '2px solid',
                borderColor: dueFilter ? '#dc2626' : 'var(--border)',
                background: dueFilter ? '#fee2e2' : 'var(--bg)',
                color: dueFilter ? '#dc2626' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: '6px',
                transition: 'all 0.15s'
              }}
            >
              {dueFilter ? '🔴' : '⚪'} Due Only
              {dueFilter && dueCount > 0 && (
                <span style={{ background: '#dc2626', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: '800' }}>
                  {dueCount}
                </span>
              )}
            </button>
          </div>
          <button className="btn btn-outline" style={{ alignSelf: 'flex-end' }}
            onClick={() => { setDateFrom(''); setDateTo(''); setPayFilter(''); setDueFilter(false); }}>
            Clear
          </button>
        </div>
      </div>

      {/* Sales Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date & Time</th>
                  <th>Customer</th>
                  <th className="table-hide-mobile">Items</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Due</th>
                  <th>Payment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 ? (
                  <tr><td colSpan={9}>
                    <div className="empty-state">
                      <div className="empty-icon">{dueFilter ? '✅' : '🧾'}</div>
                      <div className="empty-text">{dueFilter ? 'No due invoices found!' : 'No sales found'}</div>
                    </div>
                  </td></tr>
                ) : filteredSales.map(sale => {
                  const due = parseFloat(sale.due || 0);
                  const hasDue = due > 0;
                  const pm = (sale.paymentMethod || 'cash').toLowerCase();
                  const pc = payColor[pm] || payColor.cash;
                  return (
                    <tr key={sale.id} style={{ background: hasDue ? 'rgba(220,38,38,0.08)' : 'inherit', borderLeft: hasDue ? '3px solid #dc2626' : '3px solid transparent' }}>
                      <td>
                        <span style={{ fontWeight: '700', color: 'var(--primary)', fontSize: '13px', fontFamily: 'monospace' }}>
                          {sale.invoiceNo}
                        </span>
                        {hasDue && (
                          <div style={{ marginTop: '4px' }}>
                            <span style={{
                              display: 'inline-block',
                              background: '#dc2626', color: '#fff',
                              fontSize: '9px', fontWeight: '800',
                              padding: '2px 7px', borderRadius: '10px',
                              letterSpacing: '0.5px', textTransform: 'uppercase'
                            }}>
                              ● DUE
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>
                          {new Date(sale.createdAt).toLocaleDateString('en-BD')}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {new Date(sale.createdAt).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {sale.customer?.name || 'Walk-in'}
                      </td>
                      <td>
                        <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '12px', padding: '2px 10px', fontSize: '12px', fontWeight: '600' }}>
                          {sale.items?.length || 0} items
                        </span>
                      </td>
                      <td style={{ fontWeight: '700', fontSize: '14px' }}>৳{fmt(sale.total)}</td>
                      <td style={{ fontWeight: '700', color: '#22c55e', fontSize: '14px' }}>৳{fmt(sale.paid)}</td>
                      <td>
                        {hasDue ? (
                          <span style={{ fontWeight: '800', color: '#dc2626', fontSize: '14px' }}>
                            ৳{fmt(due)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span style={{ background: pc.bg, color: pc.color, borderRadius: '6px', padding: '3px 10px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                          {sale.paymentMethod || 'CASH'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setSelected(sale)}
                            style={{ fontSize: '12px' }}
                          >
                            🧾 View
                          </button>
                          {hasDue && (
                            <button
                              onClick={() => openDueModal(sale)}
                              style={{
                                padding: '4px 10px', fontSize: '12px', fontWeight: '700',
                                background: '#dc2626', color: '#fff', border: 'none',
                                borderRadius: '6px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '4px'
                              }}
                            >
                              💳 Collect Due
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && pagination.total > 0 && (
          <Pagination
            page={pagination.page} pages={pagination.pages}
            total={pagination.total} limit={pagination.limit}
            onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }}
          />
        )}
      </div>

      {/* ── COLLECT DUE MODAL ──────────────────────────────────────────────── */}
      {dueModal && (
        <div className="modal-overlay" onClick={() => setDueModal(null)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">💳 Collect Due Payment</span>
              <button className="close-btn" onClick={() => setDueModal(null)}>✕</button>
            </div>
            <div className="modal-body">

              {/* Invoice info */}
              <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Invoice</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '13px' }}>{dueModal.invoiceNo}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Customer</span>
                  <span style={{ fontWeight: '600', fontSize: '13px' }}>{dueModal.customer?.name || 'Walk-in'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sale Total</span>
                  <span style={{ fontWeight: '700', fontSize: '14px' }}>৳{fmt(dueModal.total)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Already Paid</span>
                  <span style={{ fontWeight: '700', color: '#22c55e', fontSize: '14px' }}>৳{fmt(dueModal.paid)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#fee2e2', borderRadius: '8px', marginTop: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#dc2626' }}>Outstanding Due</span>
                  <span style={{ fontSize: '18px', fontWeight: '900', color: '#dc2626' }}>৳{fmt(dueModal.due)}</span>
                </div>
              </div>

              {/* Amount input */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '13px', fontWeight: '700' }}>
                  Amount to Collect (৳)
                </label>
                <input
                  type="number"
                  className="form-control"
                  value={collectAmt}
                  min="1"
                  max={parseFloat(dueModal.due)}
                  onChange={e => setCollectAmt(e.target.value)}
                  style={{ fontSize: '18px', fontWeight: '700', textAlign: 'right' }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    onClick={() => setCollectAmt(parseFloat(dueModal.due).toFixed(0))}
                    style={{ flex: 1, padding: '6px', background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}
                  >
                    Full Amount (৳{fmt(dueModal.due)})
                  </button>
                  <button
                    onClick={() => setCollectAmt((parseFloat(dueModal.due) / 2).toFixed(0))}
                    style={{ flex: 1, padding: '6px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}
                  >
                    Half (৳{fmt(parseFloat(dueModal.due) / 2)})
                  </button>
                </div>
              </div>

              {/* Preview */}
              {collectAmt && parseFloat(collectAmt) > 0 && (
                <div style={{ background: '#dcfce7', borderRadius: '8px', padding: '12px', marginTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                    <span style={{ color: '#166534' }}>New Paid Amount</span>
                    <span style={{ fontWeight: '700', color: '#166534' }}>
                      ৳{fmt(parseFloat(dueModal.paid) + parseFloat(collectAmt))}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#166534' }}>Remaining Due</span>
                    <span style={{ fontWeight: '700', color: parseFloat(dueModal.due) - parseFloat(collectAmt) <= 0 ? '#166534' : '#dc2626' }}>
                      ৳{fmt(Math.max(0, parseFloat(dueModal.due) - parseFloat(collectAmt)))}
                      {parseFloat(dueModal.due) - parseFloat(collectAmt) <= 0 && ' ✅ CLEARED'}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDueModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCollectDue}
                disabled={collecting || !collectAmt || parseFloat(collectAmt) <= 0}
                style={{ background: '#22c55e', borderColor: '#22c55e' }}
              >
                {collecting ? '⏳ Processing...' : `✅ Collect ৳${fmt(collectAmt || 0)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW SALE MODAL ────────────────────────────────────────────────── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🧾 {selected.invoiceNo}</span>
              <button className="close-btn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Sale info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                {[
                  ['Date', new Date(selected.createdAt).toLocaleString('en-BD')],
                  ['Customer', selected.customer?.name || 'Walk-in'],
                  ['Payment', (selected.paymentMethod || 'cash').toUpperCase()],
                  ['Items', `${selected.items?.length || 0} products`],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: 'var(--bg)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>{label}</div>
                    <div style={{ fontWeight: '600', fontSize: '13px' }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Items */}
              <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontWeight: '700', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Items Purchased
                </div>
                {selected.items?.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '13px' }}>{item.productName}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.quantity} × ৳{fmt(item.price)}</div>
                    </div>
                    <span style={{ fontWeight: '700', color: 'var(--primary)' }}>৳{fmt(item.total)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '14px' }}>
                {parseFloat(selected.discount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Discount</span>
                    <span style={{ color: '#dc2626', fontWeight: '600' }}>-৳{fmt(selected.discount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', fontWeight: '800', fontSize: '16px', marginBottom: '8px' }}>
                  <span>Total</span>
                  <span style={{ color: 'var(--primary)' }}>৳{fmt(selected.total)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Paid</span>
                  <span style={{ fontWeight: '700', color: '#22c55e' }}>৳{fmt(selected.paid)}</span>
                </div>
                {parseFloat(selected.due) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', padding: '8px 12px', background: '#fee2e2', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#dc2626', fontWeight: '700' }}>Due Amount</span>
                    <span style={{ fontWeight: '800', color: '#dc2626', fontSize: '15px' }}>৳{fmt(selected.due)}</span>
                  </div>
                )}
                {selected.note && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Note: {selected.note}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-outline"
                onClick={() => {
                  const token = localStorage.getItem('token');
                  window.open(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/pdf/invoice/${selected.id}?token=${token}`, '_blank');
                }}
              >📄 Invoice PDF</button>
              <button
                className="btn btn-outline"
                style={{ background: '#7c3aed', color: '#fff', border: 'none' }}
                onClick={() => {
                  const token = localStorage.getItem('token');
                  window.open(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/pdf/voucher/${selected.id}?token=${token}`, '_blank');
                }}
              >📋 Voucher PDF</button>
              <button
                className="btn btn-outline"
                onClick={() => {
                  // Open the backend Invoice PDF in a new tab — browser auto-prints it
                  // This prints only the clean invoice, not the whole page UI
                  const token = localStorage.getItem('token');
                  const url   = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/pdf/invoice/${selected.id}?token=${token}&print=1`;
                  window.open(url, '_blank');
                }}
              >🖨️ Print</button>
              {parseFloat(selected.due) > 0 && (
                <button
                  onClick={() => { setSelected(null); openDueModal(selected); }}
                  style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}
                >
                  💳 Collect Due
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}