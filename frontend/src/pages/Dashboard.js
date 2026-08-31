import React, { useState, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import Layout from '../components/Layout';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import Icon from '../components/Icon';
import { Kpi } from '../components/ui';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);


/** Read a design token so the charts follow the theme rather than carrying a
 *  second, private palette. */
/** Compact axis label: "03 Aug", with the month name following the language. */
const BN_M = ['জানু','ফেব্রু','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্ট','অক্টো','নভে','ডিসে'];
const chartLabelFor = (lang) => (d) => {
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, '0');
  return lang === 'bn'
    ? `${day} ${BN_M[dt.getMonth()]}`
    : `${day} ${dt.toLocaleDateString('en-GB', { month: 'short' })}`;
};

const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0b7263';

export default function Dashboard({ darkMode, toggleDark }) {
  const { t, money, num, dateOnly, lang } = useT();
  const chartLabel = chartLabelFor(lang);
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
    // Day and short month only. The full date needed rotating to fit and
    // turned the axis into a wall of text on a 30-day range.
    labels: chartData.map(d => chartLabel(d.date)),
    datasets: [{
      label: t('dash.revenue'),
      data: chartData.map(d => parseFloat(d?.total ?? 0)),
      fill: true,
      borderColor: token('--accent'),
      backgroundColor: token('--accent-soft'),
      tension: 0.35,
      pointBackgroundColor: token('--accent'),
      pointRadius: 3,
      pointHoverRadius: 6,
      borderWidth: 2
    }]
  } : null;

  const barData = topProducts.length ? {
    labels: topProducts.slice(0, 6).map(p => p.productName.substring(0, 15)),
    datasets: [{
      label: t('dash.revenue'),
      data: topProducts.slice(0, 6).map(p => parseFloat(p.totalRevenue)),
      // One colour: these bars are six of the same thing. Six different
      // colours implied a distinction that does not exist.
      backgroundColor: token('--accent'),
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
  // What was actually taken at the counter today, as opposed to what was
  // billed. Labelled "collected", never "drawer": there is no opening float
  // to reconcile against, so calling it a drawer balance would be a claim the
  // data cannot support.
  const collectedToday = parseFloat(data?.today?.collected ?? 0);
  const dueToday       = parseFloat(data?.today?.due ?? 0);
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
      title={t('dash.title')}
      subtitle={t('dash.today', { date: dateOnly(new Date()) })}
      darkMode={darkMode}
      toggleDark={toggleDark}
    >
      {/* ── What gets checked first ───────────────────────────────────────────
          Order is deliberate and comes from how a counter actually runs: how
          did today go, how much cash came in, what am I about to run out of,
          who owes me. Everything else is context and sits in the second row. */}
      <div className="kpi-grid">
        <Kpi
          icon={<Icon name="cart" />}
          value={money(todaySales)}
          label={t('dash.todaySales')}
          sub={t('dash.transactions', { count: num(todayCount) })}
          emphasis
        />
        <Kpi
          icon={<Icon name="money" />}
          value={money(collectedToday)}
          label={t('dash.cashCollected')}
          sub={dueToday > 0 ? `${t('status.due')} ${money(dueToday)}` : t('status.paid')}
          tone={dueToday > 0 ? 'warn' : 'neutral'}
          emphasis
        />
        <Kpi
          icon={<Icon name="warning" />}
          value={num(lowCount)}
          label={t('dash.lowStockItems')}
          sub={outCount > 0
            ? t('dash.alreadyOut', { count: num(outCount) })
            : t('dash.productsOnShelf', { count: num(data?.inventory?.totalProducts ?? 0) })}
          tone={outCount > 0 ? 'danger' : lowCount > 0 ? 'warn' : 'ok'}
          onActivate={lowCount > 0 ? openLowStock : undefined}
          actionLabel={t('dash.lowStockItems')}
        />
        <Kpi
          icon={<Icon name="receipt" />}
          value={money(owed)}
          label={t('dash.owedByCustomers')}
          sub={t('dash.unpaidInvoices', { count: num(owedCount) })}
          tone={owed > 0 ? 'danger' : 'ok'}
          onActivate={owedCount > 0 ? () => navigate('/sales') : undefined}
          actionLabel={t('dash.owedByCustomers')}
        />
      </div>

      {/* ── Context ───────────────────────────────────────────────────────── */}
      <div className="kpi-grid">
        <Kpi icon={<Icon name="money" />} value={money(monthlySales)}
             label={t('dash.monthSales')} sub={t('dash.orders', { count: num(monthlyCount) })} />
        <Kpi icon={<Icon name="money" />} value={money(profit)}
             label={t('dash.netProfit')}
             sub={profit >= 0 ? t('dash.profitable') : t('dash.loss')}
             tone={profit < 0 ? 'danger' : 'neutral'} />
        <Kpi icon={<Icon name="box" />} value={money(stockValue)}
             label={t('dash.stockValue')}
             sub={t('dash.productsOnShelf', { count: num(data?.inventory?.totalProducts ?? 0) })} />
        <Kpi icon={<Icon name="close" />} value={num(outCount)}
             label={t('dash.outOfStock')}
             sub={outCount > 0 ? t('dash.cannotBeSold') : t('status.inStock')}
             tone={outCount > 0 ? 'danger' : 'ok'}
             onActivate={outCount > 0 ? () => navigate('/inventory') : undefined}
             actionLabel={t('dash.outOfStock')} />
        <Kpi icon={<Icon name="tag" />} value={money(monthlyExp)}
             label={t('dash.monthExpenses')}
             sub={t('dash.grossRevenue', { amount: money(revenue) })} />
        <Kpi icon={<Icon name="user" />} value={num(data?.inventory?.totalCustomers ?? 0)}
             label={t('dash.totalCustomers')} />
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="reports-charts-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '24px' }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t('dash.salesTrend')}</div>
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
            <div className="card-title">{t('dash.topProducts')}</div>
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
            <div className="card-title">{t('dash.topSelling')}</div>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>#</th><th>{t('products.productName')}</th><th>{t('dash.qtySold')}</th><th>{t('dash.revenue')}</th></tr>
              </thead>
              <tbody>
                {topProducts.slice(0, 8).map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{
                        width: '24px', height: '24px',
                        background: i < 3 ? 'var(--accent)' : 'var(--bg-subtle)',
                        color: i < 3 ? '#fff' : '#64748b',
                        borderRadius: '50%', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: '700'
                      }}>{i + 1}</span>
                    </td>
                    <td style={{ fontWeight: '600' }}>{p.productName}</td>
                    <td>{p.totalQty} units</td>
                    <td className="cell-price">{money(p.totalRevenue)}</td>
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