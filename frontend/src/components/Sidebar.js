import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import toast from 'react-hot-toast';

/**
 * Navigation.
 *
 * Labels are translation KEYS, not text. The emoji stay for now — they are
 * genuinely useful here, because a nav item is recognised by shape long before
 * it is read, and someone who reads neither language can still learn "the
 * trolley is the till". They are marked aria-hidden so a screen reader announces
 * the label rather than "shopping trolley".
 *
 * (Emoji as *product images* is a different matter and is being replaced —
 * there, they stand in for real information rather than reinforcing a label.)
 */
const navItems = [
  { section: 'nav.section.main', items: [
    { to: '/',        icon: '📊', label: 'nav.dashboard', exact: true },
    { to: '/pos',     icon: '🛒', label: 'nav.pos' },
    { to: '/sales',   icon: '💳', label: 'nav.sales' },
    { to: '/returns', icon: '🔄', label: 'nav.returns' },
  ]},
  { section: 'nav.section.inventory', items: [
    { to: '/products',   icon: '📦', label: 'nav.products' },
    { to: '/inventory',  icon: '📋', label: 'nav.inventory' },
    { to: '/categories', icon: '🏷️', label: 'nav.categories' },
    { to: '/suppliers',  icon: '🏭', label: 'nav.suppliers' },
  ]},
  { section: 'nav.section.business', items: [
    { to: '/customers', icon: '👥', label: 'nav.customers' },
    { to: '/expenses',  icon: '💸', label: 'nav.expenses' },
    { to: '/reports',   icon: '📈', label: 'nav.reports' },
  ]},
  { section: 'nav.section.system', items: [
    { to: '/users', icon: '⚙️', label: 'nav.users', adminOnly: true },
  ]},
];

export default function Sidebar({ darkMode, toggleDark, isOpen, onClose }) {
  const { user, logout } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    toast.success(t('auth.loggedOut'));
    navigate('/login');
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-icon" aria-hidden="true">📦</div>
          <div>
            <div className="logo-text">{t('app.name')}</div>
            <div className="logo-sub">{t('app.tagline')}</div>
          </div>
        </div>
        <button className="sidebar-close-btn" onClick={onClose} aria-label={t('header.closeMenu')}>✕</button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((section) => {
          const visibleItems = section.items.filter((item) => !item.adminOnly || user?.role === 'admin');
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.section}>
              <div className="nav-section-title">{t(section.section)}</div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.exact}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={onClose}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {t(item.label)}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-actions">
          <button type="button" className="sidebar-util-btn" onClick={toggleDark}>
            <span aria-hidden="true">{darkMode ? '☀️' : '🌙'}</span>
            {darkMode ? t('header.lightMode') : t('header.darkMode')}
          </button>
          <button type="button" className="sidebar-util-btn is-danger" onClick={handleLogout}>
            <span aria-hidden="true">🚪</span>
            {t('header.logout')}
          </button>
        </div>
        <div className="user-card">
          <div className="user-avatar" aria-hidden="true">{user?.name?.charAt(0)?.toUpperCase()}</div>
          <div>
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{user?.role === 'admin' ? 'Admin' : 'Staff'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
