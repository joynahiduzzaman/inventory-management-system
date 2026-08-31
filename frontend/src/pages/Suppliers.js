import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useT } from '../i18n';
import { errorMessage } from '../utils/config';
import { useConfirm, Button } from '../components/ui';

const emptyForm = { name: '', phone: '', email: '', company: '', address: '' };

export default function Suppliers({ darkMode, toggleDark }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [suppliers, setSuppliers]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [modalOpen, setModalOpen]     = useState(false);
  const [editItem, setEditItem]       = useState(null);
  const [form, setForm]               = useState(emptyForm);
  const [saving, setSaving]           = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailData, setDetailData]   = useState(null);
  const [search, setSearch]           = useState('');

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/suppliers');
      setSuppliers(res.data.data);
    } catch (err) { toast.error('Failed to load suppliers'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  // ── Filter suppliers by search ──────────────────────────────────────────────
  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase();
    return (
      !search ||
      s.name?.toLowerCase().includes(q) ||
      s.company?.toLowerCase().includes(q) ||
      s.phone?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.address?.toLowerCase().includes(q)
    );
  });

  const openAdd  = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (s) => {
    setEditItem(s);
    setForm({ name: s.name, phone: s.phone || '', email: s.email || '', company: s.company || '', address: s.address || '' });
    setModalOpen(true);
  };

  const openDetail = async (s) => {
    setDetailModal(s);
    setDetailData(null);
    try {
      const res = await api.get(`/suppliers/${s.id}`);
      setDetailData(res.data.data);
    } catch (err) { toast.error('Failed to load supplier details'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editItem) { await api.put(`/suppliers/${editItem.id}`, form); toast.success('Supplier updated'); }
      else { await api.post('/suppliers', form); toast.success('Supplier added'); }
      setModalOpen(false);
      loadSuppliers();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = (sup) => {
    const doDelete = async (force) => {
      const res = await api.delete(`/suppliers/${sup.id}${force ? '?force=true' : ''}`);
      toast.success(res.data.message || 'Supplier deleted');
      loadSuppliers();
    };
    confirm.ask({
      title: `Delete "${sup.name}"?`,
      message: 'Products supplied by them are not deleted.',
      confirmLabel: 'Delete supplier',
      onConfirm: async () => {
        try { await doDelete(false); }
        catch (err) {
          const d = err.response && err.response.data;
          if (d && d.requiresConfirmation) {
            confirm.ask({
              title: 'This supplier is in use',
              message: d.message,
              detail: 'Those products will be left without a supplier.',
              confirmLabel: 'Delete anyway',
              onConfirm: async () => {
                try { await doDelete(true); }
                catch (e2) { toast.error(errorMessage(e2, 'Could not delete the supplier')); throw e2; }
              },
            });
            return;
          }
          toast.error(errorMessage(err, 'Could not delete the supplier'));
          throw err;
        }
      },
    });
  };

  return (
    <Layout
      title="Suppliers"
      subtitle={`${filtered.length}${search ? ` of ${suppliers.length}` : ''} supplier${suppliers.length !== 1 ? 's' : ''}`}
      darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Supplier</button>}
    >

      {/* ── Search Bar ──────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', pointerEvents: 'none' }}>🔍</span>
            <input
              className="form-control"
              style={{ paddingLeft: '36px' }}
              placeholder="Search by name, company, phone, email or address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="btn btn-outline"
              style={{ whiteSpace: 'nowrap', fontSize: '13px' }}
            >
              ✕ Clear
            </button>
          )}
        </div>

        {/* Search result hint */}
        {search && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {filtered.length === 0
              ? `No suppliers match "${search}"`
              : `Showing ${filtered.length} result${filtered.length !== 1 ? 's' : ''} for "${search}"`}
          </div>
        )}
      </div>

      {/* ── Suppliers Table ──────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="loading-page"><div className="spinner" /></div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Address</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-icon">{search ? '🔍' : '🏭'}</div>
                      <div className="empty-text">
                        {search ? `No suppliers found for "${search}"` : 'No suppliers found'}
                      </div>
                    </div>
                  </td></tr>
                ) : filtered.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: '600' }}>
                      <Highlight text={s.name} query={search} />
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {s.company ? <Highlight text={s.company} query={search} /> : '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {s.phone ? <Highlight text={s.phone} query={search} /> : '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                      {s.email ? <Highlight text={s.email} query={search} /> : '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.address ? <Highlight text={s.address} query={search} /> : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openDetail(s)}>📦 Products</button>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(s)}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add/Edit Modal ───────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? '✏️ Edit Supplier' : '➕ Add Supplier'}</span>
              <button className="close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Supplier Name *</label>
                    <input className="form-control" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contact person name" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Company Name</label>
                    <input className="form-control" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Company / Business name" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input className="form-control" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="01XXXXXXXXX" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-control" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Address</label>
                  <input className="form-control" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
                <Button type="submit" variant="primary" loading={saving}>{editItem ? t('common.save') : t('suppliers.addSupplier')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Products Modal ───────────────────────────────────────────────────── */}
      {detailModal && (
        <div className="modal-overlay" onClick={() => { setDetailModal(null); setDetailData(null); }}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📦 Products — {detailModal.name}</span>
              <button className="close-btn" onClick={() => { setDetailModal(null); setDetailData(null); }}>✕</button>
            </div>
            <div className="modal-body">
              {!detailData ? <div className="loading-page"><div className="spinner" /></div> : (
                detailData.products?.length === 0 ? (
                  <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">No products from this supplier</div></div>
                ) : (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead><tr><th>Product</th><th>SKU</th><th>Cost</th><th>Price</th><th>Stock</th></tr></thead>
                      <tbody>
                        {detailData.products?.map(p => (
                          <tr key={p.id}>
                            <td style={{ fontWeight: '600' }}>{p.name}</td>
                            <td className="font-mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{p.sku || '—'}</td>
                            <td>৳{parseFloat(p.cost).toFixed(2)}</td>
                            <td style={{ fontWeight: '700', color: 'var(--primary)' }}>৳{parseFloat(p.price).toFixed(2)}</td>
                            <td>
                              <span className={`badge ${p.stock === 0 ? 'badge-danger' : p.stock <= 10 ? 'badge-warning' : 'badge-success'}`}>
                                {p.stock}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { setDetailModal(null); setDetailData(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {confirm.dialog}
    </Layout>
  );
}

// ── Highlight matching text ───────────────────────────────────────────────────
function Highlight({ text, query }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#fef08a', color: '#713f12', borderRadius: '3px', padding: '0 2px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}