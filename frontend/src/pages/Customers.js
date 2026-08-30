import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/config';
import { useT } from '../i18n';
import Icon from '../components/Icon';
import { useConfirm, Button, IconButton } from '../components/ui';

const emptyForm = { name: '', phone: '', email: '', address: '' };

export default function Customers({ darkMode, toggleDark }) {
  const { t, money } = useT();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailData, setDetailData] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/customers${search ? `?search=${search}` : ''}`);
      setCustomers(res.data.data);
    } catch (err) { toast.error('Failed to load customers'); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (c) => { setEditItem(c); setForm({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' }); setModalOpen(true); };

  const openDetail = async (c) => {
    setDetailModal(c);
    try {
      const res = await api.get(`/customers/${c.id}`);
      setDetailData(res.data.data);
    } catch (err) { toast.error('Failed to load details'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editItem) { await api.put(`/customers/${editItem.id}`, form); toast.success('Customer updated'); }
      else { await api.post('/customers', form); toast.success('Customer added'); }
      setModalOpen(false);
      loadData();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = (cust) => {
    const doDelete = async (force) => {
      const res = await api.delete(`/customers/${cust.id}${force ? '?force=true' : ''}`);
      toast.success(res.data.message || 'Customer deleted');
      loadData();
    };
    confirm.ask({
      title: `Delete ${cust.name}?`,
      message: 'Their contact details will be removed.',
      detail: parseFloat(cust.dueAmount) > 0
        ? `They currently owe ${money(cust.dueAmount)} — settle the balance first.`
        : null,
      confirmLabel: 'Delete customer',
      onConfirm: async () => {
        try { await doDelete(false); }
        catch (err) {
          const d = err.response && err.response.data;
          if (d && d.requiresConfirmation) {
            confirm.ask({
              title: 'This customer has sales history',
              message: d.message,
              detail: 'The invoices stay in Sales History but will no longer show a customer name.',
              confirmLabel: 'Delete anyway',
              onConfirm: async () => {
                try { await doDelete(true); }
                catch (e2) { toast.error(errorMessage(e2, 'Could not delete the customer')); throw e2; }
              },
            });
            return;
          }
          toast.error(errorMessage(err, 'Could not delete the customer'));
          throw err;
        }
      },
    });
  };

  const totalDue = customers.reduce((s, c) => s + parseFloat(c.dueAmount || 0), 0);

  return (
    <Layout title={t('customers.title')} subtitle={t('customers.subtitle', { count: customers.length })} darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openAdd}>{t('customers.addCustomer')}</button>}>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: '16px' }}>
        <div className="stat-card blue">
          <div className="stat-icon blue">👥</div>
          <div className="stat-value">{customers.length}</div>
          <div className="stat-label">{t('dash.totalCustomers')}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon green">💰</div>
          <div className="stat-value">{money(customers.reduce((s, c) => s + parseFloat(c.totalPurchase || 0), 0))}</div>
          <div className="stat-label">{t('sales.totalRevenue')}</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon red">⏳</div>
          <div className="stat-value">{money(totalDue)}</div>
          <div className="stat-label">{t('sales.totalDue')}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '14px 16px' }}>
          <div style={{ position: 'relative', maxWidth: '320px' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
            <input className="form-control" style={{ paddingLeft: '32px' }} placeholder={t('common.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading-page"><div className="spinner" /></div> : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>{t('common.name')}</th><th>{t('common.phone')}</th><th>{t('common.email')}</th><th>{t('customers.totalPurchase')}</th><th>{t('customers.dueAmount')}</th><th>{t('common.actions')}</th></tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">👥</div><div className="empty-text">No customers found</div></div></td></tr>
                ) : customers.map(c => (
                  <tr key={c.id}>
                    <td><div style={{ fontWeight: '600' }}>{c.name}</div></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{c.phone || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{c.email || '—'}</td>
                    <td style={{ fontWeight: '700', color: 'var(--secondary)' }}>{money(c.totalPurchase)}</td>
                    <td>
                      {parseFloat(c.dueAmount) > 0
                        ? <span style={{ color: '#dc2626', fontWeight: '700' }}>{money(c.dueAmount)}</span>
                        : <span className="badge badge-success">{t('status.cleared')}</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button size="sm" variant="secondary" icon={<Icon name="receipt" />}
                                onClick={() => openDetail(c)}>{t('common.history')}</Button>
                        <IconButton size="sm" icon={<Icon name="edit" />} label={t('common.edit')}
                                    onClick={() => openEdit(c)} />
                        <IconButton size="sm" icon={<Icon name="trash" />} label={t('common.delete')}
                                    variant="danger" onClick={() => handleDelete(c)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? '✏️ Edit Customer' : '➕ Add Customer'}</span>
              <button className="close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Customer name" />
                </div>
                <div className="form-grid">
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
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : editItem ? 'Update' : 'Add Customer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purchase History Modal */}
      {detailModal && (
        <div className="modal-overlay" onClick={() => { setDetailModal(null); setDetailData(null); }}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Purchase History — {detailModal.name}</span>
              <button className="close-btn" onClick={() => { setDetailModal(null); setDetailData(null); }}>✕</button>
            </div>
            <div className="modal-body">
              {!detailData ? <div className="loading-page"><div className="spinner" /></div> : (
                <>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    {[
                      { label: t('customers.totalPurchase'), value: `${money(detailData.totalPurchase)}`, color: 'var(--secondary)' },
                      { label: t('customers.dueAmount'), value: `${money(detailData.dueAmount)}`, color: parseFloat(detailData.dueAmount) > 0 ? '#dc2626' : 'var(--secondary)' },
                      { label: 'Total Orders', value: detailData.sales?.length || 0, color: 'var(--primary)' },
                    ].map((s, i) => (
                      <div key={i} style={{ flex: 1, minWidth: '120px', background: 'var(--bg)', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                        <div style={{ fontWeight: '800', fontSize: '18px', color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="table-wrapper">
                    <table className="table">
                      <thead><tr><th>Invoice</th><th>Date</th><th>Items</th><th>Total</th><th>Paid</th><th>Due</th><th>Method</th></tr></thead>
                      <tbody>
                        {detailData.sales?.length === 0 ? (
                          <tr><td colSpan={7}><div className="empty-state" style={{ padding: '20px 0' }}><div className="empty-icon">🧾</div><div className="empty-text">No purchases yet</div></div></td></tr>
                        ) : detailData.sales?.map(s => (
                          <tr key={s.id}>
                            <td><span className="font-mono" style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: '700' }}>{s.invoiceNo}</span></td>
                            <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(s.createdAt).toLocaleDateString('en-BD')}</td>
                            <td><span className="badge badge-gray">{s.items?.length || 0}</span></td>
                            <td style={{ fontWeight: '700' }}>{money(s.total)}</td>
                            <td style={{ color: 'var(--secondary)' }}>{money(s.paid)}</td>
                            <td style={{ color: parseFloat(s.due) > 0 ? '#dc2626' : 'inherit' }}>{parseFloat(s.due) > 0 ? `${money(s.due)}` : '—'}</td>
                            <td><span className="badge badge-info">{s.paymentMethod?.toUpperCase()}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
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
