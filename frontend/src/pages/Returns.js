import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { pdfUrl } from '../utils/config';

const fmt  = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(0));

const REASONS = [
  'Defective / Damaged',
  'Wrong item received',
  'Customer changed mind',
  'Expired product',
  'Duplicate purchase',
  'Other',
];

const REFUND_METHODS = [
  { id: 'cash',         label: '💵 Cash',         color: '#22c55e' },
  { id: 'bkash',        label: '📱 bKash',        color: '#e91e8c' },
  { id: 'nagad',        label: '🧡 Nagad',        color: '#f59e0b' },
  { id: 'card',         label: '💳 Card',         color: '#3b82f6' },
  { id: 'store_credit', label: '🏪 Store Credit', color: '#8b5cf6' },
];

export default function Returns({ darkMode, toggleDark }) {
  const [returns,    setReturns]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [selected,   setSelected]   = useState(null);

  // ── Wizard state ─────────────────────────────────────────────────────────
  const [wizardOpen,    setWizardOpen]    = useState(false);
  const [wizardStep,    setWizardStep]    = useState(1);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [saleData,      setSaleData]      = useState(null);
  const [saleLoading,   setSaleLoading]   = useState(false);
  const [returnItems,   setReturnItems]   = useState([]);
  const [refundMethod,  setRefundMethod]  = useState('cash');
  const [reason,        setReason]        = useState('Defective / Damaged');
  const [note,          setNote]          = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [successData,   setSuccessData]   = useState(null);

  const today = new Date().toISOString().split('T')[0];

  // ── Load returns ──────────────────────────────────────────────────────────
  const loadReturns = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/returns?';
      if (dateFrom) url += `from=${dateFrom}&`;
      if (dateTo)   url += `to=${dateTo}&`;
      const res = await api.get(url);
      setReturns(res.data.data);
    } catch { toast.error('Failed to load returns'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { loadReturns(); }, [loadReturns]);

  const totalRefunded = returns.reduce((s, r) => s + parseFloat(r.totalRefund || 0), 0);
  const totalItems    = returns.reduce((s, r) => s + (r.items?.length || 0), 0);



  // ── Wizard helpers ────────────────────────────────────────────────────────
  const openWizard = () => {
    setWizardOpen(true);
    setWizardStep(1);
    setInvoiceSearch('');
    setSaleData(null);
    setReturnItems([]);
    setRefundMethod('cash');
    setReason('Defective / Damaged');
    setNote('');
    setSuccessData(null);
  };

  const closeWizard = () => { setWizardOpen(false); setSuccessData(null); };

  const searchInvoice = async () => {
    if (!invoiceSearch.trim()) return toast.error('Enter an invoice number');
    setSaleLoading(true);
    try {
      // Direct lookup by invoice number — no need to fetch all sales
      const saleRes = await api.get(`/sales/by-invoice/${invoiceSearch.trim()}`);
      const sale = saleRes.data.data;
      const res = await api.get(`/returns/sale/${sale.id}`);
      const { sale: saleDetail, items } = res.data.data;
      if (items.length === 0) {
        toast.error('All items from this invoice have already been returned');
        return;
      }
      setSaleData({ sale: saleDetail, items });
      setReturnItems(items.map(i => ({ saleItemId: i.id, qty: 0, restock: true })));
      setWizardStep(2);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invoice not found');
    } finally { setSaleLoading(false); }
  };

  const updateReturnQty = (saleItemId, qty) => {
    setReturnItems(prev => prev.map(r =>
      r.saleItemId === saleItemId ? { ...r, qty: Math.max(0, qty) } : r
    ));
  };

  const toggleRestock = (saleItemId) => {
    setReturnItems(prev => prev.map(r =>
      r.saleItemId === saleItemId ? { ...r, restock: !r.restock } : r
    ));
  };

  const selectedItems  = returnItems.filter(r => r.qty > 0);
  // Calculate proportional refund — only refund what was actually paid
  const paidRatio = saleData
    ? Math.min(1, parseFloat(saleData.sale.paid || 0) / Math.max(1, parseFloat(saleData.sale.total || 1)))
    : 1;
  const totalRefundAmt = selectedItems.reduce((s, r) => {
    const item = saleData?.items.find(i => i.id === r.saleItemId);
    const full = item ? parseFloat(item.price) * r.qty : 0;
    return s + Math.round(full * paidRatio * 100) / 100;
  }, 0);

  const handleSubmitReturn = async () => {
    if (selectedItems.length === 0) return toast.error('Select at least one item to return');
    setSubmitting(true);
    try {
      const payload = {
        saleId: saleData.sale.id,
        refundMethod, reason, note,
        items: selectedItems.map(r => ({
          saleItemId:  r.saleItemId,
          quantity:    r.qty,
          restockItem: r.restock,
        })),
      };
      const res = await api.post('/returns', payload);
      setSuccessData(res.data.data);
      setWizardStep(4);
      loadReturns();
      toast.success('Return processed successfully! ✅');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to process return');
    } finally { setSubmitting(false); }
  };

  const refundColor = { cash: '#22c55e', bkash: '#e91e8c', nagad: '#f59e0b', card: '#3b82f6', store_credit: '#8b5cf6' };
  const methodLabel = (m) => REFUND_METHODS.find(x => x.id === m)?.label || m;

  return (
    <Layout
      title="Returns & Refunds"
      subtitle={`${returns.length} return record${returns.length !== 1 ? 's' : ''}`}
      darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openWizard}>+ New Return</button>}
    >

      {/* ── SUMMARY CARDS ──────────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: '20px' }}>
        <div className="stat-card red">
          <div className="stat-icon red">🔄</div>
          <div className="stat-value">{returns.length}</div>
          <div className="stat-label">Total Returns</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-icon amber">💸</div>
          <div className="stat-value">৳{fmt(totalRefunded)}</div>
          <div className="stat-label">Total Refunded</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue">📦</div>
          <div className="stat-value">{totalItems}</div>
          <div className="stat-label">Items Returned</div>
        </div>
      </div>

      {/* ── FILTERS + EXPORT ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>FROM</label>
              <input type="date" className="form-control" style={{ width: '160px' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={today} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>TO</label>
              <input type="date" className="form-control" style={{ width: '160px' }} value={dateTo} onChange={e => setDateTo(e.target.value)} max={today} />
            </div>
            <button className="btn btn-outline" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</button>
          </div>

        </div>
      </div>

      {/* ── RETURNS TABLE ──────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="loading-page"><div className="spinner" /></div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Return #</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Refund Amt</th>
                  <th>Method</th>
                  <th>Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {returns.length === 0 ? (
                  <tr><td colSpan={9}>
                    <div className="empty-state">
                      <div className="empty-icon">🔄</div>
                      <div className="empty-text">No returns found</div>
                      <div className="empty-sub">Click "+ New Return" to process a refund</div>
                    </div>
                  </td></tr>
                ) : returns.map(r => {
                  const mc = refundColor[r.refundMethod] || '#94a3b8';
                  return (
                    <tr key={r.id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: '700', color: '#ef4444', fontSize: '13px' }}>
                          {r.returnNo}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--primary)', fontWeight: '600' }}>
                          {r.sale?.invoiceNo || '—'}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>{new Date(r.createdAt).toLocaleDateString('en-BD')}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(r.createdAt).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{r.customer?.name || 'Walk-in'}</td>
                      <td>
                        <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '12px', padding: '2px 10px', fontSize: '12px', fontWeight: '600' }}>
                          {r.items?.length || 0} items
                        </span>
                      </td>
                      <td style={{ fontWeight: '800', color: '#ef4444', fontSize: '14px' }}>৳{fmt(r.totalRefund)}</td>
                      <td>
                        <span style={{ background: mc + '20', color: mc, borderRadius: '6px', padding: '3px 10px', fontSize: '11px', fontWeight: '700' }}>
                          {methodLabel(r.refundMethod)}
                        </span>
                      </td>
                      {/* Ellipsised on purpose — a reason can be a paragraph —
                          but the full text has to stay reachable, or the column
                          silently eats the end of every sentence. */}
                      <td title={r.reason || ''}
                          style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.reason || '—'}
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => setSelected(r)}>🔍 View</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ══ WIZARD MODAL ══════════════════════════════════════════════════════ */}
      {wizardOpen && (
        <div className="modal-overlay" onClick={wizardStep === 4 ? closeWizard : undefined}>
          <div className="modal modal-lg" style={{ maxWidth: '680px' }} onClick={e => e.stopPropagation()}>

            <div className="modal-header">
              <div>
                <div className="modal-title">🔄 Process Return / Refund</div>
                {wizardStep < 4 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                    Step {wizardStep} of 3 —&nbsp;
                    {wizardStep === 1 ? 'Find Invoice' : wizardStep === 2 ? 'Select Items' : 'Confirm & Refund'}
                  </div>
                )}
              </div>
              <button className="close-btn" onClick={closeWizard}>✕</button>
            </div>

            {wizardStep < 4 && (
              <div style={{ height: '3px', background: 'var(--border)' }}>
                <div style={{ height: '100%', background: 'var(--primary)', width: `${(wizardStep / 3) * 100}%`, transition: 'width 0.3s ease', borderRadius: '0 3px 3px 0' }} />
              </div>
            )}

            <div className="modal-body">

              {/* Step 1: Search Invoice */}
              {wizardStep === 1 && (
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>🧾</div>
                    <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '6px' }}>Find the Original Invoice</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Enter the invoice number from the original sale</div>
                  </div>
                  <div style={{ maxWidth: '400px', margin: '0 auto' }}>
                    <div className="form-group">
                      <label className="form-label">Invoice Number</label>
                      <input
                        className="form-control"
                        placeholder="e.g. INV-260429-1234"
                        value={invoiceSearch}
                        onChange={e => setInvoiceSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchInvoice()}
                        style={{ fontFamily: 'monospace', fontSize: '15px', textAlign: 'center', letterSpacing: '1px' }}
                        autoFocus
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={searchInvoice}
                      disabled={saleLoading || !invoiceSearch.trim()}
                      style={{ width: '100%', padding: '13px', fontSize: '14px' }}
                    >
                      {saleLoading ? '🔍 Searching...' : '🔍 Find Invoice'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Select Items */}
              {wizardStep === 2 && saleData && (
                <div>
                  <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '14px', marginBottom: '16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Invoice</div><div style={{ fontFamily: 'monospace', fontWeight: '700', color: 'var(--primary)' }}>{saleData.sale.invoiceNo}</div></div>
                    <div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Date</div><div style={{ fontWeight: '600', fontSize: '13px' }}>{new Date(saleData.sale.createdAt).toLocaleDateString('en-BD')}</div></div>
                    <div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customer</div><div style={{ fontWeight: '600', fontSize: '13px' }}>{saleData.sale.customer?.name || 'Walk-in'}</div></div>
                    <div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Original Total</div><div style={{ fontWeight: '800', fontSize: '14px', color: 'var(--primary)' }}>৳{fmt(saleData.sale.total)}</div></div>
                  </div>

                  {parseFloat(saleData.sale.due || 0) > 0 && (
                    <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#92400e' }}>
                      <strong>⚠️ Partial Payment Notice:</strong> This invoice has an outstanding due of ৳{fmt(saleData.sale.due)}.
                      Refund will be based on the amount paid (৳{fmt(saleData.sale.paid)}) — {Math.round(paidRatio * 100)}% of total.
                    </div>
                  )}
                  <div style={{ fontWeight: '700', fontSize: '13px', marginBottom: '10px' }}>Select items to return:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                    {saleData.items.map(item => {
                      const ri = returnItems.find(r => r.saleItemId === item.id);
                      const isSelected = ri?.qty > 0;
                      return (
                        <div key={item.id} style={{ background: isSelected ? 'rgba(239,68,68,0.06)' : 'var(--bg)', border: `1.5px solid ${isSelected ? '#ef4444' : 'var(--border)'}`, borderRadius: '10px', padding: '12px 14px', transition: 'all 0.15s' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '140px' }}>
                              <div style={{ fontWeight: '700', fontSize: '13px' }}>{item.productName}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                ৳{fmt(item.price)} × {item.quantity} sold
                                {item.alreadyReturned > 0 && <span style={{ color: '#f59e0b', marginLeft: '6px' }}>({item.alreadyReturned} already returned)</span>}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Qty:</span>
                              <button onClick={() => updateReturnQty(item.id, (ri?.qty || 0) - 1)} style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1.5px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: '16px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>−</button>
                              <input type="number" min="0" max={item.maxReturnable} value={ri?.qty || 0} onChange={e => updateReturnQty(item.id, parseInt(e.target.value) || 0)} style={{ width: '44px', textAlign: 'center', border: '1.5px solid var(--border)', borderRadius: '6px', padding: '3px', fontSize: '13px', fontWeight: '700', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                              <button onClick={() => updateReturnQty(item.id, Math.min(item.maxReturnable, (ri?.qty || 0) + 1))} style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1.5px solid #6366f1', background: '#6366f1', cursor: 'pointer', fontSize: '16px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>+</button>
                              <button onClick={() => updateReturnQty(item.id, item.maxReturnable)} style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', cursor: 'pointer', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>All</button>
                            </div>
                            {ri?.qty > 0 && (
                              <button onClick={() => toggleRestock(item.id)} style={{ padding: '3px 10px', fontSize: '11px', fontWeight: '700', borderRadius: '6px', border: '1.5px solid', borderColor: ri.restock ? '#22c55e' : 'var(--border)', background: ri.restock ? '#dcfce7' : 'var(--bg)', color: ri.restock ? '#166534' : 'var(--text-muted)', cursor: 'pointer' }}>
                                {ri.restock ? '📦 Restock ✓' : '📦 No Restock'}
                              </button>
                            )}
                            {ri?.qty > 0 && (
                              <div style={{ fontWeight: '800', color: '#ef4444', fontSize: '13px', minWidth: '60px', textAlign: 'right' }}>
                                -৳{fmt(parseFloat(item.price) * ri.qty)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {totalRefundAmt > 0 && (
                    <div style={{ marginTop: '12px', padding: '10px 16px', background: '#fee2e2', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: '600', color: '#dc2626', fontSize: '13px' }}>{selectedItems.length} item type{selectedItems.length !== 1 ? 's' : ''} selected</span>
                      <span style={{ fontWeight: '800', color: '#dc2626', fontSize: '16px' }}>Refund: ৳{fmt(totalRefundAmt)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Confirm */}
              {wizardStep === 3 && (
                <div>
                  <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                    <div style={{ fontWeight: '700', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Items Being Returned</div>
                    {selectedItems.map(r => {
                      const item = saleData?.items.find(i => i.id === r.saleItemId);
                      if (!item) return null;
                      return (
                        <div key={r.saleItemId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: '600', fontSize: '13px' }}>{item.productName}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {r.qty} × ৳{fmt(item.price)} &nbsp;·&nbsp;
                              <span style={{ color: r.restock ? '#22c55e' : '#94a3b8' }}>{r.restock ? '📦 Will restock' : '🚫 No restock'}</span>
                            </div>
                          </div>
                          <span style={{ fontWeight: '700', color: '#ef4444' }}>-৳{fmt(Math.round(parseFloat(item.price) * r.qty * paidRatio * 100) / 100)}</span>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '1px solid var(--border)', fontWeight: '800', fontSize: '16px', marginTop: '6px' }}>
                      <span>Total Refund</span>
                      <span style={{ color: '#ef4444' }}>৳{fmt(totalRefundAmt)}</span>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: '700' }}>Refund Method</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px' }}>
                      {REFUND_METHODS.map(m => (
                        <button key={m.id} onClick={() => setRefundMethod(m.id)} style={{ padding: '9px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `2px solid ${refundMethod === m.id ? m.color : 'var(--border)'}`, background: refundMethod === m.id ? m.color + '20' : 'var(--bg)', color: refundMethod === m.id ? m.color : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: '700' }}>Return Reason *</label>
                    <select className="form-control" value={reason} onChange={e => setReason(e.target.value)}>
                      {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Additional Note</label>
                    <input className="form-control" placeholder="Optional note..." value={note} onChange={e => setNote(e.target.value)} />
                  </div>
                </div>
              )}

              {/* Step 4: Success */}
              {wizardStep === 4 && successData && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '56px', marginBottom: '10px' }}>✅</div>
                  <div style={{ fontSize: '20px', fontWeight: '800', color: '#22c55e', marginBottom: '4px' }}>Return Processed!</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>{successData.returnNo}</div>
                  <div style={{ background: 'var(--bg)', borderRadius: '12px', padding: '16px', textAlign: 'left', marginBottom: '16px' }}>
                    <div style={{ fontWeight: '700', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Refund Details</div>
                    {successData.items?.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '7px', fontSize: '13px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: '600' }}>{item.productName}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {item.quantity} × ৳{fmt(item.price)} &nbsp;·&nbsp;
                            <span style={{ color: item.restockItem ? '#22c55e' : '#94a3b8' }}>{item.restockItem ? '📦 Restocked' : '🚫 Not restocked'}</span>
                          </div>
                        </div>
                        <span style={{ fontWeight: '700', color: '#ef4444' }}>-৳{fmt(item.refundTotal)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '1px solid var(--border)', marginTop: '6px' }}>
                      <span style={{ fontWeight: '800', fontSize: '15px' }}>Total Refunded</span>
                      <span style={{ fontWeight: '900', fontSize: '18px', color: '#ef4444' }}>৳{fmt(successData.totalRefund)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      <span>Refund via</span>
                      <span style={{ fontWeight: '700' }}>{methodLabel(successData.refundMethod)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {wizardStep === 2 && <button className="btn btn-outline" onClick={() => setWizardStep(1)}>← Back</button>}
                {wizardStep === 3 && <button className="btn btn-outline" onClick={() => setWizardStep(2)}>← Back</button>}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {wizardStep < 4 && <button className="btn btn-outline" onClick={closeWizard}>Cancel</button>}
                {wizardStep === 2 && (
                  <button className="btn btn-primary" onClick={() => setWizardStep(3)} disabled={selectedItems.length === 0} style={{ background: '#ef4444', borderColor: '#ef4444' }}>
                    Next → Confirm ({selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''})
                  </button>
                )}
                {wizardStep === 3 && (
                  <button className="btn btn-primary" onClick={handleSubmitReturn} disabled={submitting} style={{ background: '#ef4444', borderColor: '#ef4444', minWidth: '160px' }}>
                    {submitting ? '⏳ Processing...' : `✅ Refund ৳${fmt(totalRefundAmt)}`}
                  </button>
                )}
                {wizardStep === 4 && (
                  <>
                    <button
                      className="btn btn-outline"
                      onClick={() => {
                        window.open(pdfUrl(`return/${successData?.id}`, { print: 1 }), '_blank');
                      }}
                    >🖨️ Print Receipt</button>
                    <button className="btn btn-primary" onClick={openWizard}>🔄 New Return</button>
                    <button className="btn btn-outline" onClick={closeWizard}>Close</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ VIEW RETURN MODAL ════════════════════════════════════════════════ */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">🔄 {selected.returnNo}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Original: {selected.sale?.invoiceNo}</div>
              </div>
              <button className="close-btn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                {[
                  ['Date', new Date(selected.createdAt).toLocaleString('en-BD')],
                  ['Customer', selected.customer?.name || 'Walk-in'],
                  ['Refund Method', methodLabel(selected.refundMethod)],
                  ['Processed by', selected.user?.name || '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: 'var(--bg)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>{label}</div>
                    <div style={{ fontWeight: '600', fontSize: '13px' }}>{val}</div>
                  </div>
                ))}
              </div>
              {selected.reason && (
                <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px' }}>
                  <strong>Reason:</strong> {selected.reason}
                  {selected.note && <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>Note: {selected.note}</div>}
                </div>
              )}
              <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ fontWeight: '700', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Returned Items</div>
                {selected.items?.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '13px' }}>{item.productName}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {item.quantity} × ৳{fmt(item.price)} &nbsp;·&nbsp;
                        <span style={{ color: item.restockItem ? '#22c55e' : '#94a3b8' }}>{item.restockItem ? '📦 Restocked' : '🚫 Not restocked'}</span>
                      </div>
                    </div>
                    <span style={{ fontWeight: '700', color: '#ef4444' }}>-৳{fmt(item.refundTotal)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '1px solid var(--border)', fontWeight: '800', fontSize: '16px', marginTop: '6px' }}>
                  <span>Total Refunded</span>
                  <span style={{ color: '#ef4444' }}>৳{fmt(selected.totalRefund)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-outline"
                onClick={() => {
                  window.open(pdfUrl(`return/${selected?.id}`, { print: 1 }), '_blank');
                }}
              >🖨️ Print</button>
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}