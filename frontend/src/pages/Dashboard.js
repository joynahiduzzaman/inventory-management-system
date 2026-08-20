import React, { useState, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import Layout from '../components/Layout';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const fmt = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(0));

export default function Dashboard({ darkMode, toggleDark }) {
  const [data, setData]               = useState(null);
  const [chartData, setChartData]     = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [lowStockModal, setLowStockModal]       = useState(false);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [lowStockLoading, setLowStockLoading]   = useState(false);
  const navigate = useNavigate();

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [dash, chart, top] = await Promise.all([
        api.get('/reports/dashboard'),
        api.get('/reports/sales-chart?days=30'),
        api.get('/reports/top-products')
      ]);
      setData(dash.data.data);
      setChartData(chart.data.data);
      setTopProducts(top.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Open low stock modal & fetch products ──────────────────────────────────
  const openLowStock = async () => {
    setLowStockModal(true);
    if (lowStockProducts.length > 0) return; // already loaded
    setLowStockLoading(true);
    try {
      // FIX: use dedicated low-stock endpoint (respects per-product lowStockAlert)
      const res = await api.get('/products/low-stock');
      setLowStockProducts(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLowStockLoading(false);
    }
  };

  const lineChartData = chartData && chartData.length > 0 ? {
    labels: chartData.map(d => new Date(d.date).toLocaleDateString('en-BD', { month: 'short', day: 'numeric' })),
    datasets: [{
      label: 'Sales (৳)',
      data: chartData.map(d => parseFloat(d?.total ?? 0)),
      fill: true,
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.08)',
      tension: 0.4,
      pointBackgroundColor: '#6366f1',
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2.5
    }]
  } : null;

  const barData = topProducts.length ? {
    labels: topProducts.slice(0, 6).map(p => p.productName.substring(0, 15)),
    datasets: [{
      label: 'Revenue (৳)',
      data: topProducts.slice(0, 6).map(p => parseFloat(p.totalRevenue)),
      backgroundColor: ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#8b5cf6'],
      borderRadius: 6,
      borderSkipped: false
    }]
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 } } }
    }
  };

  if (loading) return (
    <Layout title="Dashboard" darkMode={darkMode} toggleDark={toggleDark}>
      <div className="loading-page"><div className="spinner" /><p>Loading dashboard...</p></div>
    </Layout>
  );

  // Flat shape from reportController v3 — no more dataValues nesting
  const todaySales   = parseFloat(data?.today?.revenue   ?? 0);
  const todayCount   = parseInt(data?.today?.count       ?? 0);
  const monthlySales = parseFloat(data?.month?.revenue   ?? 0);
  const monthlyCount = parseInt(data?.month?.count       ?? 0);
  const monthlyExp   = parseFloat(data?.month?.expenses  ?? 0);
  const cogs         = parseFloat(data?.month?.cogs      ?? 0);
  const revenue      = parseFloat(data?.month?.revenue   ?? 0);
  const profit       = parseFloat(data?.month?.netProfit ?? (revenue - cogs - monthlyExp));
  const lowCount     = parseInt(data?.inventory?.lowStockCount ?? 0);
  const outCount     = parseInt(data?.inventory?.outOfStockCount ?? 0);
  const stockValue   = parseFloat(data?.inventory?.stockRetailValue ?? 0);
  const owed         = parseFloat(data?.receivables?.totalDue ?? 0);
  const owedCount    = parseInt(data?.receivables?.dueInvoices ?? 0);

  const stockStatus = (p) => {
    if (p.stock === 0) return { bg: '#fee2e2', color: '#dc2626', label: 'Out of Stock', icon: '❌' };
    if (p.stock <= 5)  return { bg: '#fee2e2', color: '#dc2626', label: 'Critical',     icon: '🔴' };
    return               { bg: '#fef3c7', color: '#d97706', label: 'Low Stock',    icon: '⚠️' };
  };

  return (
    <Layout
      title="Dashboard"
      subtitle={`Today: ${new Date().toLocaleDateString('en-BD', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`}
      darkMode={darkMode}
      toggleDark={toggleDark}
    >
      {/* ── Stats Row 1 ─────────────────────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-icon blue">💳</div>
          <div className="stat-value">৳{fmt(todaySales)}</div>
          <div className="stat-label">Today's Sales</div>
          <div className="stat-change">📊 {todayCount} transactions</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon green">📅</div>
          <div className="stat-value">৳{fmt(monthlySales)}</div>
          <div className="stat-label">Monthly Sales</div>
          <div className="stat-change">📊 {monthlyCount} orders</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-icon amber">💰</div>
          <div className="stat-value" style={{ color: profit >= 0 ? '#16a34a' : '#dc2626' }}>
            ৳{fmt(profit)}
          </div>
          <div className="stat-label">Net Profit (Month)</div>
          <div className="stat-change">{profit >= 0 ? '📈 Profitable' : '📉 Loss'}</div>
        </div>

        {/* LOW STOCK — clickable card */}
        <div
          className="stat-card red"
          onClick={lowCount > 0 ? openLowStock : undefined}
          style={{ cursor: lowCount > 0 ? 'pointer' : 'default', position: 'relative' }}
          title={lowCount > 0 ? 'Click to see which products are low on stock' : ''}
        >
          {lowCount > 0 && (
            <span style={{
              position: 'absolute', top: '12px', right: '12px',
              fontSize: '10px', fontWeight: '700', color: '#dc2626',
              background: '#fee2e2', border: '1px solid #fca5a5',
              borderRadius: '6px', padding: '2px 8px'
            }}>View →</span>
          )}
          <div className="stat-icon red">⚠️</div>
          <div className="stat-value" style={{ color: lowCount > 0 ? '#dc2626' : '#16a34a' }}>
            {lowCount}
          </div>
          <div className="stat-label">Low Stock Items</div>
          <div className="stat-change">
            {outCount > 0 ? `${outCount} already out of stock` : `of ${data?.inventory?.totalProducts ?? 0} products`}
          </div>
        </div>
      </div>

      {/* ── Stats Row 2 ─────────────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: '24px' }}>
        {/* Money owed to the shop — the figure that decides who gets chased today. */}
        <div
          className="stat-card red" role="button" tabIndex={0}
          style={{ cursor: owedCount > 0 ? 'pointer' : 'default' }}
          title={owedCount > 0 ? 'Open the unpaid invoices' : 'Nothing outstanding'}
          onClick={() => owedCount > 0 && navigate('/sales')}
          onKeyDown={(e) => e.key === 'Enter' && owedCount > 0 && navigate('/sales')}
        >
          <div className="stat-icon red">🧾</div>
          <div className="stat-value" style={{ color: owed > 0 ? '#dc2626' : '#16a34a' }}>৳{fmt(owed)}</div>
          <div className="stat-label">Owed by Customers</div>
          <div className="stat-change">{owedCount} unpaid invoice{owedCount === 1 ? '' : 's'}</div>
        </div>

        {/* Out of stock is not the same problem as low stock: these cannot be sold at all. */}
        <div
          className="stat-card red" role="button" tabIndex={0}
          style={{ cursor: outCount > 0 ? 'pointer' : 'default' }}
          title={outCount > 0 ? 'See which products are out of stock' : 'Everything is in stock'}
          onClick={() => outCount > 0 && navigate('/inventory')}
          onKeyDown={(e) => e.key === 'Enter' && outCount > 0 && navigate('/inventory')}
        >
          <div className="stat-icon red">❌</div>
          <div className="stat-value" style={{ color: outCount > 0 ? '#dc2626' : '#16a34a' }}>{outCount}</div>
          <div className="stat-label">Out of Stock</div>
          <div className="stat-change">{outCount > 0 ? 'Cannot be sold' : 'All products available'}</div>
        </div>

        <div className="stat-card green">
          <div className="stat-icon green">🏪</div>
          <div className="stat-value">৳{fmt(stockValue)}</div>
          <div className="stat-label">Stock Value (Retail)</div>
          <div className="stat-change">{data?.inventory?.totalProducts ?? 0} products on shelf</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-icon amber">💸</div>
          <div className="stat-value">৳{fmt(monthlyExp)}</div>
          <div className="stat-label">Monthly Expenses</div>
          <div className="stat-change">Gross revenue ৳{fmt(revenue)}</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue">👥</div>
          <div className="stat-value">{data?.inventory?.totalCustomers ?? 0}</div>
          <div className="stat-label">Total Customers</div>
        </div>
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="reports-charts-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '24px' }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">📈 Sales Trend (Last 30 Days)</div>
          </div>
          <div style={{ padding: '20px', height: '260px' }}>
            {lineChartData
              ? <Line data={lineChartData} options={chartOptions} />
              : <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">No sales data yet</div></div>
            }
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div className="card-title">🏆 Top Products</div>
          </div>
          <div style={{ padding: '20px', height: '260px' }}>
            {barData
              ? <Bar data={barData} options={{ ...chartOptions, indexAxis: 'y' }} />
              : <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">No data yet</div></div>
            }
          </div>
        </div>
      </div>

      {/* ── Top Products Table ───────────────────────────────────────────────── */}
      {topProducts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">📊 Top Selling Products</div>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>#</th><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {topProducts.slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{
                        width: '24px', height: '24px',
                        background: i < 3 ? '#6366f1' : '#f1f5f9',
                        color: i < 3 ? '#fff' : '#64748b',
                        borderRadius: '50%', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: '700'
                      }}>{i + 1}</span>
                    </td>
                    <td style={{ fontWeight: '600' }}>{p.productName}</td>
                    <td>{p.totalQty} units</td>
                    <td style={{ fontWeight: '700', color: '#6366f1' }}>৳{fmt(p.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LOW STOCK MODAL ─────────────────────────────────────────────────── */}
      {lowStockModal && (
        <div className="modal-overlay" onClick={() => setLowStockModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>

            <div className="modal-header">
              <div>
                <div className="modal-title">⚠️ Low Stock Products</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  These products need restocking soon
                </div>
              </div>
              <button className="close-btn" onClick={() => setLowStockModal(false)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding: 0 }}>
              {lowStockLoading ? (
                <div className="loading-page" style={{ minHeight: '180px' }}>
                  <div className="spinner" />
                </div>
              ) : lowStockProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: '50px 20px' }}>
                  <div className="empty-icon">✅</div>
                  <div className="empty-text">All products are well stocked!</div>
                  <div className="empty-sub">No items below the alert threshold</div>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table" style={{ minWidth: '500px' }}>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Category</th>
                        <th style={{ textAlign: 'center' }}>Current Stock</th>
                        <th style={{ textAlign: 'center' }}>Alert Level</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockProducts
                        .sort((a, b) => a.stock - b.stock)
                        .map(p => {
                          const s = stockStatus(p);
                          return (
                            <tr key={p.id}>
                              <td style={{ fontWeight: '600' }}>{p.name}</td>
                              <td>
                                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
                                  {p.sku || '—'}
                                </span>
                              </td>
                              <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {p.category?.name || '—'}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ fontWeight: '800', fontSize: '16px', color: s.color }}>
                                  {p.stock}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                                {p.lowStockAlert ?? 10}
                              </td>
                              <td>
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                                  padding: '3px 10px', borderRadius: '20px',
                                  fontSize: '11px', fontWeight: '600',
                                  background: s.bg, color: s.color
                                }}>
                                  {s.icon} {s.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's' : ''} need attention
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a href="/products" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                  📦 Manage Products
                </a>
                <button className="btn btn-outline" onClick={() => setLowStockModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}