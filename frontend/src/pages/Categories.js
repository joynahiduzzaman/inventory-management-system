import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useT } from '../i18n';
import { errorMessage } from '../utils/config';
import { useConfirm, Button } from '../components/ui';

const emptyForm = { name: '', description: '' };

export default function Categories({ darkMode, toggleDark }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/categories');
      setCategories(res.data.data);
    } catch (err) { toast.error('Failed to load categories'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (c) => { setEditItem(c); setForm({ name: c.name, description: c.description || '' }); setModalOpen(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editItem) { await api.put(`/categories/${editItem.id}`, form); toast.success('Category updated'); }
      else { await api.post('/categories', form); toast.success('Category added'); }
      setModalOpen(false);
      loadData();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = (cat) => {
    const doDelete = async (force) => {
      const res = await api.delete(`/categories/${cat.id}${force ? '?force=true' : ''}`);
      toast.success(res.data.message || 'Category deleted');
      loadData();
    };
    confirm.ask({
      title: `Delete "${cat.name}"?`,
      message: 'Products in this category will not be deleted.',
      confirmLabel: 'Delete category',
      onConfirm: async () => {
        try { await doDelete(false); }
        catch (err) {
          const d = err.response && err.response.data;
          if (d && d.requiresConfirmation) {
            // Second, more explicit prompt naming the consequence.
            confirm.ask({
              title: 'This category is in use',
              message: d.message,
              detail: 'Those products will be left without a category. You can reassign them afterwards from the Products page.',
              confirmLabel: 'Delete anyway',
              onConfirm: async () => {
                try { await doDelete(true); }
                catch (e2) { toast.error(errorMessage(e2, 'Could not delete the category')); throw e2; }
              },
            });
            return;
          }
          toast.error(errorMessage(err, 'Could not delete the category'));
          throw err;
        }
      },
    });
  };

  const catIcons = ['🏷️', '📱', '💊', '🛒', '👕', '📚', '🍔', '🔧', '🎮', '🧴', '🏠', '🚗'];

  return (
    <Layout title="Categories" subtitle={`${categories.length} categories`} darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Category</button>}>

      {loading ? <div className="loading-page"><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
          {categories.length === 0 ? (
            <div className="empty-state" style={{ gridColumn: '1/-1' }}>
              <div className="empty-icon">🏷️</div>
              <div className="empty-text">No categories yet</div>
              <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={openAdd}>Add First Category</button>
            </div>
          ) : categories.map((c, i) => (
            <div key={c.id} className="card" style={{ padding: '20px', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>{catIcons[i % catIcons.length]}</div>
              <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px' }}>{c.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', minHeight: '18px' }}>{c.description || 'No description'}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => openEdit(c)}>✏️ Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? '✏️ Edit Category' : '➕ Add Category'}</span>
              <button className="close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Category Name *</label>
                  <input className="form-control" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Electronics, Medicine..." />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-control" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
                <Button type="submit" variant="primary" loading={saving}>{editItem ? t('common.save') : t('categories.addCategory')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirm.dialog}
    </Layout>
  );
}
