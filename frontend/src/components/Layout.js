import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useT, LANGUAGES } from '../i18n';

/**
 * Language switch.
 *
 * A visible two-state segmented control rather than a dropdown: it is one tap
 * either way, and the option you are NOT on is readable at a glance, so someone
 * who cannot read the current language can still find their way out of it. A
 * select would hide the escape hatch behind a menu written in the language
 * they cannot read.
 */
function LanguageToggle() {
  const { lang, setLang, t } = useT();
  return (
    <div className="lang-toggle" role="group" aria-label={t('header.language')}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`lang-opt ${lang === l.code ? 'is-active' : ''}`}
          aria-pressed={lang === l.code}
          aria-label={l.code === 'bn' ? t('header.switchToBangla') : t('header.switchToEnglish')}
          onClick={() => setLang(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export default function Layout({ children, title, subtitle, actions, darkMode, toggleDark }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const { t } = useT();

  // Close the drawer when the route actually changes. Keying this off `children`
  // fired on every parent re-render, so the drawer slammed shut mid-interaction.
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Lock background scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  // Close sidebar on Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-layout">

      {/* Overlay — clicking it closes sidebar on mobile */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <Sidebar
        darkMode={darkMode}
        toggleDark={toggleDark}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="main-content">
        <header className="header">
          {/* Hamburger — only visible on mobile via CSS */}
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('header.openMenu')}
          >
            ☰
          </button>

          <div className="header-left">
            <div className="header-title">{title}</div>
            {subtitle && <div className="header-sub">{subtitle}</div>}
          </div>

          <div className="header-actions">
            {actions}
            <LanguageToggle />
          </div>
        </header>

        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
