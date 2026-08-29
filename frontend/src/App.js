import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { I18nProvider } from './i18n';
import './App.css';
import './shop-ui.css';

import Login     from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products  from './pages/Products';
import POS       from './pages/POS';
import Sales     from './pages/Sales';
import Returns   from './pages/Returns';
import Customers from './pages/Customers';
import Expenses  from './pages/Expenses';
import Suppliers from './pages/Suppliers';
import Categories from './pages/Categories';
import Reports   from './pages/Reports';
import Inventory from './pages/Inventory';
import Users     from './pages/Users';

function ProtectedRoute({ children, adminOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function AppContent() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  const toggleDark = () => setDarkMode(d => !d);
  const props = { darkMode, toggleDark };

  return (
    <Routes>
      <Route path="/login"   element={<Login />} />
      <Route path="/"        element={<ProtectedRoute><Dashboard  {...props} /></ProtectedRoute>} />
      <Route path="/pos"     element={<ProtectedRoute><POS        {...props} /></ProtectedRoute>} />
      <Route path="/sales"   element={<ProtectedRoute><Sales      {...props} /></ProtectedRoute>} />
      <Route path="/returns" element={<ProtectedRoute><Returns    {...props} /></ProtectedRoute>} />
      <Route path="/products"   element={<ProtectedRoute><Products   {...props} /></ProtectedRoute>} />
      <Route path="/inventory"  element={<ProtectedRoute><Inventory  {...props} /></ProtectedRoute>} />
      <Route path="/categories" element={<ProtectedRoute><Categories {...props} /></ProtectedRoute>} />
      <Route path="/suppliers"  element={<ProtectedRoute><Suppliers  {...props} /></ProtectedRoute>} />
      <Route path="/customers"  element={<ProtectedRoute><Customers  {...props} /></ProtectedRoute>} />
      <Route path="/expenses"   element={<ProtectedRoute><Expenses   {...props} /></ProtectedRoute>} />
      <Route path="/reports"    element={<ProtectedRoute><Reports    {...props} /></ProtectedRoute>} />
      <Route path="/users"      element={<ProtectedRoute adminOnly><Users {...props} /></ProtectedRoute>} />
      <Route path="*"           element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LocalisedApp />
      </AuthProvider>
    </BrowserRouter>
  );
}

/**
 * Sits inside AuthProvider so the language preference can be keyed to the
 * signed-in user: a shared till often has an owner who reads English and staff
 * who read Bangla, and one global setting would make them fight over it.
 */
function LocalisedApp() {
  const { user } = useAuth();
  return (
    <I18nProvider userId={user ? user.id : null}>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: 'var(--text-primary)', color: 'var(--bg-card)',
              borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--weight-medium)',
              boxShadow: 'var(--shadow-lg)',
              maxWidth: '420px',
            },
            success: { iconTheme: { primary: 'var(--ok)', secondary: 'var(--bg-card)' } },
            error:   { iconTheme: { primary: 'var(--danger)', secondary: 'var(--bg-card)' }, duration: 5000 }
          }}
        />
        <AppContent />
    </I18nProvider>
  );
}