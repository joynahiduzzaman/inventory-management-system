import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useT } from '../i18n';
import { Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const emptyForm = { name: '', email: '', password: '', role: 'staff' };

export default function Users({ darkMode, toggleDark }) {
  const { t } = useT();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const { user: currentUser } = useAuth();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/auth/users');
      setUsers(res.data.data);
    } catch (err) { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (u) => {
    setEditItem(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (editItem && !payload.password) delete payload.password;
      if (editItem) { await api.put(`/auth/users/${editItem.id}`, payload); toast.success('User updated'); }
      else { await api.post('/auth/users', payload); toast.success('User created'); }
      setModalOpen(false);
      loadData();
    } catch (err) { toast.error(err.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/auth/users/${u.id}`, { isActive: !u.isActive });
      toast.success(u.isActive ? 'User deactivated' : 'User activated');
      loadData();
    } catch (err) { toast.error('Failed to update user'); }
  };

  return (
    <Layout title="User Management" subtitle="Admin access required" darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openAdd}>+ Add User</button>}>

      <div className="alert alert-warning" style={{ marginBottom: '16px' }}>
        🔐 Only admins can manage users. Changes take effect immediately.
      </div>

      <div className="card">
        {loading ? <div className="loading-page"><div className="spinner" /></div> : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '34px', height: '34px',
                          background: u.role === 'admin' ? 'var(--primary)' : 'var(--secondary)',
                          borderRadius: '8px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: '700', color: '#fff', fontSize: '13px'
                        }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: '600' }}>{u.name}</div>
                          {u.id === currentUser?.id && <div style={{ fontSize: '10px', color: 'var(--primary)', fontWeight: '600' }}>You</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-purple' : 'badge-info'}`}>
                        {u.role === 'admin' ? '👑 Admin' : '👤 Staff'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-success' : 'badge-danger'}`}>
                        {u.isActive ? '✅ Active' : '❌ Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {new Date(u.createdAt).toLocaleDateString('en-BD')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(u)}>✏️ Edit</button>
                        {u.id !== currentUser?.id && (
                          <button
                            className={`btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-secondary'}`}
                            onClick={() => toggleActive(u)}
                          >
                            {u.isActive ? '🚫' : '✅'}
                          </button>
                        )}
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
              <span className="modal-title">{editItem ? '✏️ Edit User' : '➕ Add User'}</span>
              <button className="close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email *</label>
                  <input className="form-control" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">{editItem ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                    <input className="form-control" type="password" required={!editItem} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="••••••••" minLength={6} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Role *</label>
                    <select className="form-control" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                      <option value="staff">👤 Staff</option>
                      <option value="admin">👑 Admin</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
                <Button type="submit" variant="primary" loading={saving}>{editItem ? t('common.save') : t('users.addUser')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
