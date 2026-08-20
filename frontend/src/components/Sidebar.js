import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const navItems = [
  { section: 'Main', items: [
    { to: '/',       icon: '📊', label: 'Dashboard',        exact: true },
    { to: '/pos',    icon: '🛒', label: 'Point of Sale' },
    { to: '/sales',  icon: '💳', label: 'Sales History' },
    { to: '/returns',icon: '🔄', label: 'Returns & Refunds' },
  ]},
  { section: 'Inventory', items: [
    { to: '/products',   icon: '📦', label: 'Products' },
    { to: '/inventory',  icon: '📋', label: 'Stock & History' },
    { to: '/categories', icon: '🏷️', label: 'Categories' },
    { to: '/suppliers',  icon: '🏭', label: 'Suppliers' },
  ]},
  { section: 'Business', items: [
    { to: '/customers', icon: '👥', label: 'Customers' },
    { to: '/expenses',  icon: '💸', label: 'Expenses' },
    { to: '/reports',   icon: '📈', label: 'Reports' },
  ]},
  { section: 'System', items: [
    { to: '/users', icon: '⚙️', label: 'Users', adminOnly: true },
  ]}
];

export default function Sidebar({ darkMode, toggleDark, isOpen, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-icon">📦</div>
          <div>
            <div className="logo-text">Domingo</div>
            <div className="logo-sub">Inventory</div>
          </div>
        </div>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">✕</button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(section => {
          const visibleItems = section.items.filter(item => !item.adminOnly || user?.role === 'admin');
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.section}>
              <div className="nav-section-title">{section.section}</div>
              {visibleItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.exact}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={onClose}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div style={{ marginBottom: '10px', display: 'flex', gap: '8px' }}>
          <button
            onClick={toggleDark}
            style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}
          >
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button
            onClick={handleLogout}
            style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#f87171', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}
          >
            🚪 Logout
          </button>
        </div>
        <div className="user-card">
          <div className="user-avatar">{user?.name?.charAt(0)?.toUpperCase()}</div>
          <div>
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{user?.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}