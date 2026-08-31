import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useT } from '../i18n';
import { errorMessage, money } from '../utils/config';
import { useConfirm, Button } from '../components/ui';

const fmt = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(2));
const CATEGORIES = ['Rent', 'Salary', 'Utilities', 'Purchase', 'Transport', 'Marketing', 'Maintenance', 'Food', 'Other'];
const emptyForm = { title: '', category: 'Other', amount: '', date: new Date().toISOString().split('T')[0], note: '' };

export default function Expenses({ darkMode, toggleDark }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [summary, setSummary] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/expenses?';
      if (dateFrom) url += `from=${dateFrom}&`;
      if (dateTo) url += `to=${dateTo}&`;
      if (catFilter) url += `category=${catFilter}&`;
      const [res, sumRes] = await Promise.all([api.get(url), api.get('/expenses/summary')]);
      setExpenses(res.data.data);
      setSummary(sumRes.data.data);
    } catch (err) { toast.error('Failed to load expenses'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, catFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (e) => {
    setEditItem(e);
    setForm({ title: e.title, category: e.category, amount: e.amount, date: e.date, note: e.note || '' });
    setModalOpen(true);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      if (editItem) { await api.put(`/expenses/${editItem.id}`, form); toast.success('Expense updated'); }
      else { await api.post('/expenses', form); toast.success('Expense added'); }
      setModalOpen(false);
      loadData();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = (exp) => {
    confirm.ask({
      title: 'Delete this expense?',
      message: `${exp.title} — ${money(exp.amount)}`,
      detail: 'Profit figures for that period will change.',
      confirmLabel: 'Delete expense',
      onConfirm: async () => {
        try {
          await api.delete(`/expenses/${exp.id}`);
          toast.success('Expense deleted');
          loadData();
        } catch (err) { toast.error(errorMessage(err, 'Could not delete the expense')); throw err; }
      },
    });
  };

  const total = expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  const catColors = { Rent: '#6366f1', Salary: '#22c55e', Utilities: '#f59e0b', Purchase: '#3b82f6', Transport: '#8b5cf6', Marketing: '#ec4899', Maintenance: '#ef4444', Food: '#14b8a6', Other: '#94a3b8' };

  return (
    <Layout title="Expenses" subtitle={`${expenses.length} expense records`} darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Expense</button>}>

      <div className="reports-charts-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '20px' }}>
        {/* Summary by category */}
        <div className="card">
          <div className="card-header"><div className="card-title">📊 By Category</div></div>
          <div style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {summary.map(s => (
              <div key={s.category} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: 'var(--bg)', borderRadius: '8px', minWidth: '160px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: catColors[s.category] || '#94a3b8', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>{s.category}</div>
                  <div style={{ fontWeight: '700', fontSize: '14px' }}>৳{fmt(s.total)}</div>
                </div>
              </div>
            ))}
            {summary.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No data</div>}
          </div>
        </div>

        {/* Total */}
        <div className="stat-card red" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="stat-icon red">💸</div>
          <div className="stat-value">৳{fmt(total)}</div>
          <div className="stat-label">Total Expenses (Filtered)</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>FROM</label>
            <input type="date" className="form-control" style={{ width: '160px' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>TO</label>
            <input type="date" className="form-control" style={{ width: '160px' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>CATEGORY</label>
            <select className="form-control" style={{ width: '160px' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn btn-outline" onClick={() => { setDateFrom(''); setDateTo(''); setCatFilter(''); }}>Clear</button>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading-page"><div className="spinner" /></div> : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Title</th><th>Category</th><th>Date</th><th>Amount</th><th>Note</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">💸</div><div className="empty-text">No expenses found</div></div></td></tr>
                ) : expenses.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: '600' }}>{e.title}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '20px', background: (catColors[e.category] || '#94a3b8') + '20', color: catColors[e.category] || '#94a3b8', fontSize: '12px', fontWeight: '600' }}>
                        {e.category}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{new Date(e.date).toLocaleDateString('en-BD')}</td>
                    <td style={{ fontWeight: '700', color: '#dc2626' }}>৳{fmt(e.amount)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{e.note || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(e)}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? '✏️ Edit Expense' : '➕ Add Expense'}</span>
              <button className="close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Title *</label>
                  <input className="form-control" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Monthly rent payment" />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Category *</label>
                    <select className="form-control" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Amount (৳) *</label>
                    <input className="form-control" type="number" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input className="form-control" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Note</label>
                  <input className="form-control" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Optional note" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
                <Button type="submit" variant="primary" loading={saving}>{editItem ? t('common.save') : t('expenses.addExpense')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirm.dialog}
    </Layout>
  );
}
