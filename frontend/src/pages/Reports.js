import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const fmt  = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(2));
const fmtN = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(0));

export default function Reports({ darkMode, toggleDark }) {
  const [profit, setProfit]         = useState(null);
  const [salesChart, setSalesChart] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [expSummary, setExpSummary] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [exporting, setExporting]   = useState('');
  const [days, setDays]             = useState(30);
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [pdfModal, setPdfModal]     = useState(false);
  const [pdfHtml, setPdfHtml]       = useState('');
  const iframeRef = useRef(null);
  const lineRef   = useRef(null);
  const barRef    = useRef(null);


  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let profitUrl = '/reports/profit?';
      if (dateFrom) profitUrl += `from=${dateFrom}&`;
      if (dateTo)   profitUrl += `to=${dateTo}&`;
      const [p, sc, tp, es] = await Promise.all([
        api.get(profitUrl),
        api.get(`/reports/sales-chart?days=${days}`),
        api.get(`/reports/top-products${dateFrom ? `?from=${dateFrom}&to=${dateTo}` : ''}`),
        api.get('/expenses/summary')
      ]);
      setProfit(p.data.data);
      setSalesChart(sc.data.data);
      setTopProducts(tp.data.data);
      setExpSummary(es.data.data);
    } catch { toast.error('Failed to load reports'); }
    finally { setLoading(false); }
  }, [days, dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  const periodLabel = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : `Last ${days} days`;

  // ── EXCEL EXPORT ───────────────────────────────────────────────────────────
  const exportExcel = async () => {
    setExporting('excel');
    try {
      const now     = new Date();
      const dateStr = now.toLocaleDateString('en-BD');
      let csv = '';
      csv += `INVENTORY MANAGEMENT SYSTEM - BUSINESS REPORT\n`;
      csv += `Generated: ${dateStr}\nPeriod: ${periodLabel}\n\n`;
      csv += `PROFIT & LOSS SUMMARY\nMetric,Amount (৳)\n`;
      csv += `Total Revenue,${parseFloat(profit?.revenue||0).toFixed(2)}\n`;
      csv += `Cost of Goods Sold,${parseFloat(profit?.cogs||0).toFixed(2)}\n`;
      csv += `Gross Profit,${parseFloat(profit?.grossProfit||0).toFixed(2)}\n`;
      csv += `Total Expenses,${parseFloat(profit?.expense||0).toFixed(2)}\n`;
      csv += `Net Profit,${parseFloat(profit?.netProfit||0).toFixed(2)}\n`;
      if (profit?.revenue > 0) csv += `Profit Margin,${((profit.netProfit/profit.revenue)*100).toFixed(1)}%\n`;
      csv += `\nDAILY SALES TREND\nDate,Revenue (৳),Orders\n`;
      salesChart.forEach(d => { csv += `${new Date(d.date).toLocaleDateString('en-BD')},${parseFloat(d?.total ?? 0).toFixed(2)},${d?.count ?? 0}
`; });
      csv += `\nTOP SELLING PRODUCTS\nRank,Product Name,Qty Sold,Revenue (৳)\n`;
      topProducts.forEach((p, i) => { csv += `${i+1},"${p.productName}",${p.totalQty},${parseFloat(p.totalRevenue).toFixed(2)}\n`; });
      if (expSummary.length > 0) {
        csv += `\nEXPENSES BY CATEGORY\nCategory,Total (৳)\n`;
        expSummary.forEach(e => { csv += `${e.category},${parseFloat(e.total).toFixed(2)}\n`; });
      }
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Business_Report_${now.toISOString().split('T')[0]}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('✅ Excel report downloaded!');
    } catch (err) { toast.error('Export failed: ' + err.message); }
    finally { setExporting(''); }
  };

  // ── PDF EXPORT ─────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    setExporting('pdf');
    try {
      const now     = new Date();
      const dateStr = now.toLocaleDateString('en-BD', { year:'numeric', month:'long', day:'numeric' });
      const timeStr = now.toLocaleTimeString('en-BD', { hour:'2-digit', minute:'2-digit' });
      const lineImg = lineRef.current ? lineRef.current.toBase64Image() : null;
      const barImg  = barRef.current  ? barRef.current.toBase64Image()  : null;
      const profitMargin = profit?.revenue > 0 ? ((profit.netProfit/profit.revenue)*100).toFixed(1) : '0.0';
      const isProfit     = parseFloat(profit?.netProfit||0) >= 0;

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Business Report — ${periodLabel}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#1e293b; background:#f1f5f9; font-size:13px; }

  /* ── Header ── */
  .header {
    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
    padding: 36px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: white;
  }
  .header-left h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
  .header-left p  { font-size: 13px; opacity: 0.7; }
  .header-right   { text-align: right; }
  .header-right .period-badge {
    display: inline-block;
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 20px;
    padding: 6px 16px;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .header-right .date-str { font-size: 12px; opacity: 0.65; }

  /* ── KPI strip ── */
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: #fff;
    border-bottom: 3px solid #6366f1;
  }
  .kpi {
    padding: 20px 16px;
    text-align: center;
    border-right: 1px solid #e2e8f0;
    position: relative;
  }
  .kpi:last-child { border-right: none; }
  .kpi-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    border-radius: 0;
  }
  .kpi-icon  { font-size: 20px; margin-bottom: 8px; display: block; }
  .kpi-value { font-size: 18px; font-weight: 800; line-height: 1; margin-bottom: 5px; }
  .kpi-label { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── Body wrapper ── */
  .body { padding: 24px; }

  /* ── Margin bar ── */
  .margin-bar-wrap {
    background: #fff;
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 20px;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .margin-label { font-size: 12px; font-weight: 700; color: #64748b; white-space: nowrap; }
  .margin-track { flex: 1; background: #e2e8f0; border-radius: 6px; height: 10px; overflow: hidden; }
  .margin-fill  { height: 100%; border-radius: 6px; }
  .margin-pct   { font-size: 16px; font-weight: 800; white-space: nowrap; }

  /* ── Charts row ── */
  .charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
  }
  .chart-card {
    background: #fff;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
  }
  .chart-card-header {
    padding: 12px 16px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 13px;
    font-weight: 700;
    color: #374151;
    background: #f8fafc;
  }
  .chart-card img { width: 100%; display: block; padding: 12px; }

  /* ── Section card ── */
  .section-card {
    background: #fff;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .section-header {
    padding: 14px 20px;
    background: #f8fafc;
    border-bottom: 2px solid #e2e8f0;
    font-size: 14px;
    font-weight: 700;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-header .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead tr { background: #6366f1; }
  th {
    padding: 10px 14px;
    text-align: left;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #fff;
  }
  td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; color: #374151; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #f8fafc; }
  .td-number { font-weight: 700; font-family: 'Courier New', monospace; }
  .td-primary { color: #6366f1; }
  .td-red     { color: #dc2626; }
  .rank-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 800;
    color: #fff;
  }

  /* ── Footer ── */
  .footer {
    background: #1e1b4b;
    color: rgba(255,255,255,0.6);
    padding: 14px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
  }
  .footer strong { color: rgba(255,255,255,0.9); }

  /* ── Totals row ── */
  .totals-row td { background: #ede9fe !important; font-weight: 800; color: #4338ca; }

  @page { margin: 0; size: A4; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #f1f5f9; }
  }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    <h1>📊 Business Report</h1>
    <p>Domingo Shop — Inventory Management System</p>
  </div>
  <div class="header-right">
    <div class="period-badge">📅 ${periodLabel}</div>
    <div class="date-str">Generated: ${dateStr} at ${timeStr}</div>
  </div>
</div>

<!-- KPI STRIP -->
<div class="kpi-strip">
  <div class="kpi">
    <div class="kpi-bar" style="background:#6366f1"></div>
    <span class="kpi-icon">💰</span>
    <div class="kpi-value" style="color:#6366f1">৳${fmtN(profit?.revenue)}</div>
    <div class="kpi-label">Total Revenue</div>
  </div>
  <div class="kpi">
    <div class="kpi-bar" style="background:#f59e0b"></div>
    <span class="kpi-icon">🏭</span>
    <div class="kpi-value" style="color:#f59e0b">৳${fmtN(profit?.cogs)}</div>
    <div class="kpi-label">Cost of Goods</div>
  </div>
  <div class="kpi">
    <div class="kpi-bar" style="background:#22c55e"></div>
    <span class="kpi-icon">📈</span>
    <div class="kpi-value" style="color:#22c55e">৳${fmtN(profit?.grossProfit)}</div>
    <div class="kpi-label">Gross Profit</div>
  </div>
  <div class="kpi">
    <div class="kpi-bar" style="background:#ef4444"></div>
    <span class="kpi-icon">💸</span>
    <div class="kpi-value" style="color:#ef4444">৳${fmtN(profit?.expense)}</div>
    <div class="kpi-label">Total Expenses</div>
  </div>
  <div class="kpi">
    <div class="kpi-bar" style="background:${isProfit?'#22c55e':'#ef4444'}"></div>
    <span class="kpi-icon">${isProfit?'🏆':'📉'}</span>
    <div class="kpi-value" style="color:${isProfit?'#22c55e':'#ef4444'}">৳${fmtN(profit?.netProfit)}</div>
    <div class="kpi-label">Net Profit</div>
  </div>
</div>

<!-- BODY -->
<div class="body">

  <!-- PROFIT MARGIN BAR -->
  <div class="margin-bar-wrap">
    <div class="margin-label">Profit Margin</div>
    <div class="margin-track">
      <div class="margin-fill" style="width:${Math.max(0,Math.min(100,parseFloat(profitMargin)))}%;background:${isProfit?'linear-gradient(90deg,#22c55e,#16a34a)':'#ef4444'}"></div>
    </div>
    <div class="margin-pct" style="color:${isProfit?'#16a34a':'#ef4444'}">${profitMargin}% ${isProfit?'▲':'▼'}</div>
  </div>

  <!-- CHARTS -->
  ${(lineImg||barImg)?`
  <div class="charts-row">
    ${lineImg?`<div class="chart-card"><div class="chart-card-header">📈 Sales Trend — ${periodLabel}</div><img src="${lineImg}" alt="Sales Chart"/></div>`:''}
    ${barImg?`<div class="chart-card"><div class="chart-card-header">🏆 Top Selling Products</div><img src="${barImg}" alt="Top Products Chart"/></div>`:''}
  </div>`:''}

  <!-- DAILY SALES -->
  ${salesChart.length>0?`
  <div class="section-card">
    <div class="section-header"><div class="dot" style="background:#6366f1"></div>Daily Sales Breakdown</div>
    <table>
      <thead><tr><th>Date</th><th style="text-align:right">Revenue (৳)</th><th style="text-align:center">Orders</th><th style="text-align:right">Avg/Order (৳)</th></tr></thead>
      <tbody>
        ${salesChart.map(d=>{
          const avg = (d?.count ?? 0) > 0 ? (parseFloat(d?.total ?? 0)/parseInt(d?.count ?? 0)).toFixed(0) : 0;
          return `<tr>
            <td style="font-weight:600">${new Date(d.date).toLocaleDateString('en-BD',{weekday:'short',year:'numeric',month:'short',day:'numeric'})}</td>
            <td class="td-number td-primary" style="text-align:right">৳${fmtN(d?.total ?? 0)}</td>
            <td style="text-align:center">${d?.count ?? 0}</td>
            <td class="td-number" style="text-align:right;color:#64748b">৳${fmtN(avg)}</td>
          </tr>`;
        }).join('')}
        <tr class="totals-row">
          <td style="font-weight:800">TOTAL</td>
          <td style="text-align:right">৳${fmtN(salesChart.reduce((s,d)=>s+parseFloat(d?.total ?? 0),0))}</td>
          <td style="text-align:center">${salesChart.reduce((s,d)=>s+parseInt(d?.count ?? 0),0)}</td>
          <td style="text-align:right">—</td>
        </tr>
      </tbody>
    </table>
  </div>`:''}

  <!-- TOP PRODUCTS -->
  ${topProducts.length>0?`
  <div class="section-card">
    <div class="section-header"><div class="dot" style="background:#f59e0b"></div>Top Selling Products</div>
    <table>
      <thead><tr><th style="width:40px">#</th><th>Product Name</th><th style="text-align:center">Qty Sold</th><th style="text-align:right">Revenue (৳)</th></tr></thead>
      <tbody>
        ${topProducts.map((p,i)=>{
          const rankColors=['#f59e0b','#94a3b8','#cd7f32'];
          const bg = i<3 ? rankColors[i] : '#6366f1';
          return `<tr>
            <td><div class="rank-badge" style="background:${bg}">${i+1}</div></td>
            <td style="font-weight:600">${p.productName}</td>
            <td style="text-align:center;color:#64748b">${p.totalQty} units</td>
            <td class="td-number td-primary" style="text-align:right">৳${fmtN(p.totalRevenue)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`:''}

  <!-- EXPENSES -->
  ${expSummary.length>0?`
  <div class="section-card">
    <div class="section-header"><div class="dot" style="background:#ef4444"></div>Expenses by Category</div>
    <table>
      <thead><tr><th>Category</th><th style="text-align:right">Amount (৳)</th><th style="text-align:center">% of Total</th><th>Visual</th></tr></thead>
      <tbody>
        ${expSummary.map(e=>{
          const tot=expSummary.reduce((s,x)=>s+parseFloat(x.total),0);
          const pct=tot>0?((parseFloat(e.total)/tot)*100).toFixed(1):0;
          return `<tr>
            <td style="font-weight:600">${e.category}</td>
            <td class="td-number td-red" style="text-align:right">৳${fmtN(e.total)}</td>
            <td style="text-align:center;color:#64748b;font-weight:600">${pct}%</td>
            <td style="width:120px">
              <div style="background:#fee2e2;border-radius:4px;height:8px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:#ef4444;border-radius:4px"></div>
              </div>
            </td>
          </tr>`;
        }).join('')}
        <tr class="totals-row">
          <td style="font-weight:800">TOTAL</td>
          <td style="text-align:right;color:#dc2626">৳${fmtN(expSummary.reduce((s,e)=>s+parseFloat(e.total),0))}</td>
          <td style="text-align:center">100%</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>`:''}

</div><!-- end body -->

<!-- FOOTER -->
<div class="footer">
  <strong>📦 Domingo Shop — Inventory Management System</strong>
  <span>Generated: ${dateStr} ${timeStr}</span>
  <span>Period: ${periodLabel}</span>
</div>

</body>
</html>`;

      setPdfHtml(html);
      setPdfModal(true);
      toast.success('✅ PDF ready — click Print to save');
      setPdfModal(true);
      toast.success('✅ PDF ready — click Print to save');
    } catch (err) { toast.error('Export failed: ' + err.message); }
    finally { setExporting(''); }
  };

  // ── Chart configs ──────────────────────────────────────────────────────────
  const lineData = salesChart.length ? {
    labels: salesChart.map(d => new Date(d.date).toLocaleDateString('en-BD', { month:'short', day:'numeric' })),
    datasets: [{ label:'Revenue (৳)', data:salesChart.map(d=>parseFloat(d?.total ?? 0)), fill:true, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.08)', tension:0.4, pointBackgroundColor:'#6366f1', pointRadius:3, borderWidth:2.5 }]
  } : null;

  const barData = topProducts.length ? {
    labels: topProducts.slice(0,8).map(p => p.productName.length>16 ? p.productName.substring(0,16)+'…' : p.productName),
    datasets: [{ label:'Revenue (৳)', data:topProducts.slice(0,8).map(p=>parseFloat(p.totalRevenue)), backgroundColor:'#6366f1', borderRadius:6 }]
  } : null;

  const doughnutData = expSummary.length ? {
    labels: expSummary.map(e=>e.category),
    datasets: [{ data:expSummary.map(e=>parseFloat(e.total)), backgroundColor:['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899'], borderWidth:0, hoverOffset:6 }]
  } : null;

  const chartOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{mode:'index',intersect:false} }, scales:{ x:{grid:{display:false},ticks:{font:{size:11}}}, y:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{size:11}}} } };
  const doughnutOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'right',labels:{font:{size:12},padding:12}} } };

  return (
    <Layout title="Reports & Analytics" subtitle="Business performance overview" darkMode={darkMode} toggleDark={toggleDark}>

      {/* ── Filters + Export Buttons ───────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          {/* Left: filters */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>FROM DATE</label>
              <input type="date" className="form-control" style={{ width: '160px' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>TO DATE</label>
              <input type="date" className="form-control" style={{ width: '160px' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>CHART DAYS</label>
              <select className="form-control" style={{ width: '130px' }} value={days} onChange={e => setDays(e.target.value)}>
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={90}>Last 90 Days</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={loadData}>Apply</button>
            <button className="btn btn-outline" onClick={() => { setDateFrom(''); setDateTo(''); setDays(30); }}>Reset</button>
          </div>

          {/* Right: Export Buttons */}
          <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
            <button onClick={exportExcel} disabled={exporting==='excel'||loading}
              style={{ padding: '8px 18px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', opacity: exporting==='excel'?0.7:1, boxShadow: '0 2px 8px rgba(22,163,74,0.3)' }}>
              {exporting==='excel' ? '⏳' : '📊'} Export Excel
            </button>
            <button onClick={exportPDF} disabled={exporting==='pdf'||loading}
              style={{ padding: '8px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', opacity: exporting==='pdf'?0.7:1, boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}>
              {exporting==='pdf' ? '⏳' : '📄'} Export PDF
            </button>
            <button
              onClick={() => {
                const token = localStorage.getItem('token');
                const base  = process.env.REACT_APP_API_URL || 'http://localhost:5000';
                const qs    = dateFrom && dateTo ? `from=${dateFrom}&to=${dateTo}` : '';
                window.open(`${base}/api/pdf/sales-report?${qs}&token=${token}`, '_blank');
              }}
              style={{ padding: '8px 18px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 8px rgba(124,58,237,0.3)' }}>
              📊 Sales PDF
            </button>
            <button
              onClick={() => {
                const token = localStorage.getItem('token');
                const base  = process.env.REACT_APP_API_URL || 'http://localhost:5000';
                const qs    = dateFrom && dateTo ? `from=${dateFrom}&to=${dateTo}` : '';
                window.open(`${base}/api/pdf/product-sales?${qs}&token=${token}`, '_blank');
              }}
              style={{ padding: '8px 18px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 8px rgba(8,145,178,0.3)' }}>
              📦 Product PDF
            </button>
          </div>
        </div>
      </div>

      {loading ? <div className="loading-page"><div className="spinner" /></div> : (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────── */}
          {profit && (
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: '20px' }}>
              {[
                { label:'Total Revenue',  value:`৳${fmt(profit.revenue)}`,     color:'#6366f1', icon:'💰', bg:'#ede9fe' },
                { label:'Cost of Goods',  value:`৳${fmt(profit.cogs)}`,        color:'#f59e0b', icon:'🏭', bg:'#fef3c7' },
                { label:'Gross Profit',   value:`৳${fmt(profit.grossProfit)}`, color:'#22c55e', icon:'📈', bg:'#dcfce7' },
                { label:'Total Expenses', value:`৳${fmt(profit.expense)}`,     color:'#ef4444', icon:'💸', bg:'#fee2e2' },
                { label:'Net Profit',     value:`৳${fmt(profit.netProfit)}`,   color: profit.netProfit>=0?'#22c55e':'#ef4444', icon: profit.netProfit>=0?'🏆':'📉', bg: profit.netProfit>=0?'#dcfce7':'#fee2e2' },
              ].map((s, i) => (
                <div key={i} className="stat-card" style={{ borderTop:`3px solid ${s.color}` }}>
                  <div style={{ width:'40px', height:'40px', borderRadius:'10px', background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', marginBottom:'12px' }}>{s.icon}</div>
                  <div style={{ fontSize:'18px', fontWeight:'800', color:s.color, lineHeight:1, marginBottom:'4px' }}>{s.value}</div>
                  <div style={{ fontSize:'11px', color:'var(--text-secondary)', fontWeight:'500' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Profit Margin Bar ──────────────────────────────────────────── */}
          {profit && profit.revenue > 0 && (
            <div className="card" style={{ marginBottom: '20px', padding: '20px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'10px' }}>
                <span style={{ fontWeight:'700' }}>Profit Margin</span>
                <span style={{ fontWeight:'800', color: profit.netProfit>=0?'var(--secondary)':'#dc2626' }}>
                  {((profit.netProfit/profit.revenue)*100).toFixed(1)}%
                </span>
              </div>
              <div style={{ height:'10px', background:'var(--border)', borderRadius:'5px', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${Math.max(0,Math.min(100,(profit.netProfit/profit.revenue)*100))}%`, background: profit.netProfit>=0?'linear-gradient(90deg,#22c55e,#16a34a)':'#ef4444', borderRadius:'5px', transition:'width 0.8s ease' }} />
              </div>
            </div>
          )}

          {/* ── Charts Row 1 ───────────────────────────────────────────────── */}
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'20px', marginBottom:'20px' }}>
            <div className="card">
              <div className="card-header">
                <div className="card-title">📈 Sales Trend</div>
                <span style={{ fontSize:'12px', color:'var(--text-secondary)' }}>Last {days} days</span>
              </div>
              <div style={{ padding:'20px', height:'280px' }}>
                {lineData ? <Line ref={lineRef} data={lineData} options={chartOpts} /> : <div className="empty-state"><div className="empty-icon">📊</div><div className="empty-text">No sales data</div></div>}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title">💸 Expenses by Category</div></div>
              <div style={{ padding:'20px', height:'280px' }}>
                {doughnutData ? <Doughnut data={doughnutData} options={doughnutOpts} /> : <div className="empty-state"><div className="empty-icon">💸</div><div className="empty-text">No expense data</div></div>}
              </div>
            </div>
          </div>

          {/* ── Charts Row 2 ───────────────────────────────────────────────── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
            <div className="card">
              <div className="card-header"><div className="card-title">🏆 Top Selling Products</div></div>
              <div style={{ padding:'20px', height:'280px' }}>
                {barData ? <Bar ref={barRef} data={barData} options={chartOpts} /> : <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">No data</div></div>}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title">📋 Top Products Table</div></div>
              <div style={{ overflow:'auto', maxHeight:'280px' }}>
                <table className="table">
                  <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Gross Revenue</th></tr></thead>
                  <tbody>
                    {topProducts.length===0 ? (
                      <tr><td colSpan={4}><div className="empty-state" style={{ padding:'20px 0' }}><div className="empty-icon">📦</div><div className="empty-text">No data</div></div></td></tr>
                    ) : topProducts.map((p,i) => (
                      <tr key={i}>
                        <td><span style={{ width:'22px', height:'22px', background:i<3?['#f59e0b','#94a3b8','#cd7f32'][i]:'#f1f5f9', color:i<3?'#fff':'#64748b', borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'700' }}>{i+1}</span></td>
                        <td style={{ fontWeight:'600', fontSize:'13px' }}>{p.productName}</td>
                        <td style={{ fontSize:'13px' }}>{p.totalQty}</td>
                        <td style={{ fontWeight:'700', color:'var(--primary)', fontSize:'13px' }}>৳{fmt(p.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── PDF Preview Modal ──────────────────────────────────────────────── */}
      {pdfModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:9999, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start', padding:'20px' }}>
          <div style={{ width:'100%', maxWidth:'900px', background:'#1e1e2e', borderRadius:'12px 12px 0 0', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <span style={{ fontSize:'18px' }}>📄</span>
              <div>
                <div style={{ fontWeight:'700', color:'#fff', fontSize:'14px' }}>PDF Report Preview</div>
                <div style={{ fontSize:'11px', color:'#a5b4fc' }}>Click Print to save as PDF file</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={() => { iframeRef.current?.contentWindow?.focus(); iframeRef.current?.contentWindow?.print(); }}
                style={{ padding:'8px 20px', background:'#dc2626', color:'#fff', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize:'13px', display:'flex', alignItems:'center', gap:'6px' }}>
                🖨️ Print / Save as PDF
              </button>
              <button onClick={() => setPdfModal(false)}
                style={{ padding:'8px 16px', background:'#374151', color:'#fff', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px' }}>
                ✕ Close
              </button>
            </div>
          </div>
          <iframe ref={iframeRef} style={{ width:'100%', maxWidth:'900px', height:'calc(100vh - 140px)', border:'none', background:'#fff', borderRadius:'0 0 12px 12px' }} srcDoc={pdfHtml} title="PDF Report" />
          <div style={{ marginTop:'8px', fontSize:'12px', color:'#94a3b8', textAlign:'center' }}>
            💡 In print dialog → change <strong style={{ color:'#c7d2fe' }}>Destination</strong> to <strong style={{ color:'#c7d2fe' }}>"Save as PDF"</strong>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </Layout>
  );
}