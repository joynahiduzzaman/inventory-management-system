import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
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
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: '#1e293b', color: '#f1f5f9',
              borderRadius: '10px', fontSize: '13px',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: '500', border: '1px solid #334155',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)'
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } }
          }}
        />
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}