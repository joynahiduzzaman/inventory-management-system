import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { fileUrl, errorMessage, money, dateTime } from '../utils/config';
import { StockBadge, useConfirm, EmptyState, TableSkeleton, Pagination } from '../components/ui';

const fmt      = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0));
const emptyForm = { name: '', sku: '', barcode: '', categoryId: '', supplierId: '', price: '', cost: '', stock: '', lowStockAlert: 10, unit: 'pcs', description: '' };

// ── Auto-generate a barcode number (EAN-13 style, 13 digits) ─────────────────
function generateBarcode() {
  const base = '880' + Date.now().toString().slice(-9);
  const digits = base.split('').map(Number);
  let sum = 0;
  digits.forEach((d, i) => { sum += i % 2 === 0 ? d : d * 3; });
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

function generateSKU(name) {
  if (!name) return '';
  const words = name.trim().toUpperCase().split(/\s+/);
  const prefix = words.map(w => w[0]).join('').slice(0, 4);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
}

function drawBarcode(canvas, code) {
  if (!canvas || !code) return;
  if (window.JsBarcode) {
    try {
      window.JsBarcode(canvas, code, {
        format: 'CODE128', width: 2, height: 60,
        displayValue: true, fontSize: 13, margin: 8,
        background: '#ffffff', lineColor: '#000000', textMargin: 4,
      });
    } catch (e) { console.warn('Barcode draw error:', e.message); }
  }
}

function loadJsBarcode() {
  return new Promise((resolve) => {
    if (window.JsBarcode) return resolve();
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
}

export default function Products({ darkMode, toggleDark }) {
  const [products,     setProducts]     = useState([]);
  const [categories,   setCategories]   = useState([]);
  const [suppliers,    setSuppliers]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editItem,     setEditItem]     = useState(null);
  const [form,         setForm]         = useState(emptyForm);
  const [saving,       setSaving]       = useState(false);
  const [filterCat,    setFilterCat]    = useState('');
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [barcodeReady, setBarcodeReady] = useState(false);

  // ── Low Stock Modal state ────────────────────────────────────────────────────
  const [lowStockModal,    setLowStockModal]    = useState(false);
  const [lowStockFilter,   setLowStockFilter]   = useState(false);

  // Barcode print modal
  const [printModal,  setPrintModal] = useState(null);
  const [printQty,    setPrintQty]   = useState(1);

  // Stock adjustment — the traceable way to change a stock level.
  const [adjustFor,   setAdjustFor]   = useState(null);
  const [adjustForm,  setAdjustForm]  = useState({ mode: 'add', quantity: '', type: 'purchase', note: '' });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [historyFor,  setHistoryFor]  = useState(null);
  const [history,     setHistory]     = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Table paging — a real catalogue is thousands of rows, not twenty.
  const [page,  setPage]  = useState(1);
  const [limit, setLimit] = useState(50);

  const confirm = useConfirm();

  const fileInputRef     = useRef();
  const barcodeCanvasRef = useRef();
  const printCanvasRef   = useRef();

  useEffect(() => { loadJsBarcode().then(() => setBarcodeReady(true)); }, []);

  useEffect(() => {
    if (barcodeReady && modalOpen && form.barcode && barcodeCanvasRef.current) {
      setTimeout(() => drawBarcode(barcodeCanvasRef.current, form.barcode), 50);
    }
  }, [form.barcode, barcodeReady, modalOpen]);

  useEffect(() => {
    if (barcodeReady && printModal && printCanvasRef.current) {
      setTimeout(() => drawBarcode(printCanvasRef.current, printModal.barcode || printModal.sku), 50);
    }
  }, [printModal, barcodeReady]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, s] = await Promise.all([api.get('/products'), api.get('/categories'), api.get('/suppliers')]);
      setProducts(p.data.data);
      setCategories(c.data.data);
      setSuppliers(s.data.data);
    } catch (err) { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived low stock list ───────────────────────────────────────────────────
  const lowStockItems = products
    .filter(p => p.isActive !== false && p.stock <= (p.lowStockAlert ?? 10))
    .sort((a, b) => a.stock - b.stock);
  const lowStockCount = lowStockItems.length;

  const stockStatus = (p) => {
    if (p.stock === 0) return { bg: '#fee2e2', color: '#dc2626', label: 'Out of Stock', icon: '❌' };
    if (p.stock <= 5)  return { bg: '#fee2e2', color: '#dc2626', label: 'Critical',     icon: '🔴' };
    return               { bg: '#fef3c7', color: '#d97706', label: 'Low Stock',    icon: '⚠️' };
  };

  const openAdd = () => {
    setEditItem(null);
    const newBarcode = generateBarcode();
    setForm({ ...emptyForm, barcode: newBarcode });
    setImageFile(null);
    setImagePreview(null);
    setModalOpen(true);
  };

  const openEdit = (p) => {
    setEditItem(p);
    setForm({
      name:          p.name,
      sku:           p.sku        || '',
      barcode:       p.barcode    || p.sku || '',
      categoryId:    p.categoryId || '',
      supplierId:    p.supplierId || '',
      price:         p.price,
      cost:          p.cost,
      stock:         p.stock,
      lowStockAlert: p.lowStockAlert,
      unit:          p.unit,
      description:   p.description || ''
    });
    setImageFile(null);
    setImagePreview(fileUrl(p.image));
    setModalOpen(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) { toast.error('Please drop an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      const submitForm = { ...form, sku: form.sku || form.barcode };
      Object.entries(submitForm).forEach(([k, v]) => formData.append(k, v));
      if (imageFile) formData.append('image', imageFile);
      if (editItem) {
        await api.put(`/products/${editItem.id}`, formData);
        toast.success('Product updated');
      } else {
        await api.post('/products', formData);
        toast.success('Product added');
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving product');
    } finally { setSaving(false); }
  };

  // Archive, not destroy: sale history references the product.
  const handleDelete = (p) => {
    confirm.ask({
      title: `Archive "${p.name}"?`,
      message: 'It will be hidden from the product list and the till, but all past sales that include it stay intact.',
      detail: p.stock > 0
        ? `Heads up: ${p.stock} ${p.unit || 'units'} are still in stock and worth ${money(p.stock * p.price)} at retail.`
        : null,
      confirmLabel: 'Archive product',
      onConfirm: async () => {
        try {
          const res = await api.delete(`/products/${p.id}`);
          toast.success(res.data.message || 'Product archived');
          loadData();
        } catch (err) { toast.error(errorMessage(err, 'Could not archive the product')); throw err; }
      },
    });
  };

  // ── Stock adjustment ────────────────────────────────────────────────────────
  const openAdjust = (p) => {
    setAdjustFor(p);
    setAdjustForm({ mode: 'add', quantity: '', type: 'purchase', note: '' });
  };

  const submitAdjust = async (e) => {
    e.preventDefault();
    const qty = parseInt(adjustForm.quantity, 10);
    if (!Number.isInteger(qty) || qty < 0) return toast.error('Enter a whole number');
    if (adjustForm.mode !== 'set' && qty < 1) return toast.error('Quantity must be at least 1');
    if (adjustForm.mode === 'remove' && qty > adjustFor.stock) {
      return toast.error(`Only ${adjustFor.stock} in stock`);
    }
    setAdjustSaving(true);
    try {
      const res = await api.post(`/products/${adjustFor.id}/adjust-stock`, { ...adjustForm, quantity: qty });
      toast.success(res.data.message || 'Stock updated');
      setAdjustFor(null);
      loadData();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not adjust stock'));
    } finally { setAdjustSaving(false); }
  };

  const openHistory = async (p) => {
    setHistoryFor(p); setHistory([]); setHistoryLoading(true);
    try {
      const res = await api.get(`/products/${p.id}/movements`);
      setHistory(res.data.data || []);
    } catch (err) { toast.error(errorMessage(err, 'Could not load stock history')); }
    finally { setHistoryLoading(false); }
  };

  const handlePrint = () => {
    if (!printCanvasRef.current) return;
    const dataUrl = printCanvasRef.current.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) return toast.error('Allow popups to print');
    const labels = Array(printQty).fill(`
      <div class="label">
        <div class="pname">${printModal.name}</div>
        <img src="${dataUrl}" />
        <div class="price">৳${fmt(printModal.price)}</div>
      </div>
    `).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels</title>
      <style>* { margin:0;padding:0;box-sizing:border-box; } body { font-family:Arial,sans-serif;background:#fff; }
      .page { display:flex;flex-wrap:wrap;gap:8px;padding:12px; }
      .label { width:200px;border:1px dashed #ccc;border-radius:6px;padding:8px;text-align:center;page-break-inside:avoid; }
      .pname { font-size:11px;font-weight:700;margin-bottom:4px;word-break:break-word;max-height:28px;overflow:hidden; }
      .price { font-size:13px;font-weight:800;margin-top:4px;color:#111; }
      img { max-width:100%;height:auto; }
      @media print { body { margin:0; } .page { padding:4px;gap:4px; } }</style></head><body>
      <div class="page">${labels}</div>
      <script>window.onload=()=>{window.print();window.close();}<' + '/script></body></html>`);
    win.document.close();
  };

  const filtered = products.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      p.name.toLowerCase().includes(q) ||
      (p.sku     && p.sku.toLowerCase().includes(q)) ||
      (p.barcode && p.barcode.toLowerCase().includes(q));
    const matchCat = !filterCat || String(p.categoryId) === String(filterCat);
    const matchLow = !lowStockFilter || p.stock <= (p.lowStockAlert ?? 10);
    return matchSearch && matchCat && matchLow;
  });

  // Reset to page 1 whenever the result set changes underneath the user.
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * limit, safePage * limit);

  const getCatEmoji = (catName) => {
    const map = { Electronics: '📱', Medicine: '💊', Grocery: '🛒', Clothing: '👕', Stationery: '📚' };
    return map[catName] || '📦';
  };

  return (
    <Layout title="Products" subtitle={`${products.length} products in inventory`} darkMode={darkMode} toggleDark={toggleDark}
      actions={<button className="btn btn-primary" onClick={openAdd}>+ Add Product</button>}>

      {/* ── FILTERS ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
            <input className="form-control" style={{ paddingLeft: '32px' }} placeholder="Search by name, SKU or barcode..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-control" style={{ width: '180px' }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Low Stock filter toggle button — same style as Due Only in Sales */}
          <div>
            <button
              onClick={() => setLowStockFilter(!lowStockFilter)}
              style={{
                height: '38px', padding: '0 16px', borderRadius: '8px', fontSize: '13px',
                fontWeight: '700', cursor: 'pointer', border: '2px solid',
                borderColor: lowStockFilter ? '#d97706' : 'var(--border)',
                background: lowStockFilter ? '#fef3c7' : 'var(--bg)',
                color: lowStockFilter ? '#d97706' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: '6px',
                transition: 'all 0.15s'
              }}
            >
              {lowStockFilter ? '⚠️' : '⚪'} Low Stock Only
              {lowStockFilter && lowStockCount > 0 && (
                <span style={{ background: '#d97706', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: '800' }}>
                  {lowStockCount}
                </span>
              )}
            </button>
          </div>

          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{filtered.length} results</span>
        </div>
      </div>

      {/* ── LOW STOCK ALERT BANNER ───────────────────────────────────────────── */}
      {lowStockCount > 0 && (
        <div style={{
          background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px',
          padding: '12px 16px', marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '10px'
        }}>
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '700', color: '#d97706', fontSize: '13px' }}>
              {lowStockCount} product{lowStockCount !== 1 ? 's' : ''} running low on stock
            </div>
            <div style={{ fontSize: '12px', color: '#92400e', marginTop: '2px' }}>
              {lowStockFilter
                ? `Showing ${filtered.length} low stock product${filtered.length !== 1 ? 's' : ''} — click ✏️ Edit to update stock`
                : 'Click "View Low Stock" to see which products need restocking'}
            </div>
          </div>
          <button
            onClick={() => setLowStockModal(true)}
            style={{
              padding: '6px 14px', background: '#d97706', color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            ⚠️ View Low Stock
          </button>
        </div>
      )}

      {/* ── PRODUCTS TABLE ───────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-code col-hide-md">Image</th>
                  <th className="col-name">Product</th>
                  <th className="col-code col-hide-lg">SKU</th>
                  <th className="col-code col-hide-xl">Barcode</th>
                  <th className="col-hide-md">Category</th>
                  <th className="col-num col-hide-lg">Cost</th>
                  <th className="col-num">Price</th>
                  <th className="col-num">Stock</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10}>
                    <div className="empty-state">
                      <div className="empty-icon">{lowStockFilter ? '✅' : '📦'}</div>
                      <div className="empty-text">{lowStockFilter ? 'No low stock products!' : 'No products found'}</div>
                    </div>
                  </td></tr>
                ) : paged.map(p => {
                  const isLow = p.stock <= (p.lowStockAlert ?? 10);
                  const isOut = p.stock === 0;
                  return (
                    <tr key={p.id} style={{
                      background: isOut ? 'rgba(220,38,38,0.06)' : isLow ? 'rgba(245,158,11,0.06)' : 'inherit',
                      borderLeft: isOut ? '3px solid #dc2626' : isLow ? '3px solid #f59e0b' : '3px solid transparent'
                    }}>
                      <td className="col-hide-md">
                        {p.image ? (
                          <img src={fileUrl(p.image)} alt={p.name} style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)' }} onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                        ) : null}
                        <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--bg)', border: '1px solid var(--border)', display: p.image ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
                          {getCatEmoji(p.category?.name)}
                        </div>
                      </td>
                      <td className="col-name">
                        <div className="cell-title" style={{ fontWeight: '600' }}>{p.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {p.unit}
                          {/* SKU folds in here once its own column is hidden. */}
                          <span className="mono col-show-lg" style={{ marginLeft: 6 }}>{p.sku || ''}</span>
                        </div>
                      </td>
                      <td className="col-code col-hide-lg">
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{p.sku || '—'}</span>
                      </td>
                      <td className="col-code col-hide-xl">
                        {(p.barcode || p.sku) ? (
                          <span style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--bg)', padding: '2px 7px', borderRadius: '5px', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            {p.barcode || p.sku}
                          </span>
                        ) : (
                          <span style={{ color: '#dc2626', fontSize: '11px', fontWeight: '600' }}>⚠️ No barcode</span>
                        )}
                      </td>
                      <td className="col-hide-md">{p.category ? <span className="badge badge-purple">{p.category.name}</span> : '—'}</td>
                      <td className="col-num col-hide-lg">৳{fmt(p.cost)}</td>
                      <td className="col-num" style={{ fontWeight: '700', color: 'var(--primary)' }}>৳{fmt(p.price)}</td>
                      <td className="num">
                        <div style={{ fontWeight: 700 }}>{p.stock} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>{p.unit}</span></div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>alert at {p.lowStockAlert ?? 10}</div>
                      </td>
                      <td className="col-status">
                        <StockBadge stock={p.stock} lowStockAlert={p.lowStockAlert ?? 10} showCount={false} />
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          {isLow && (
                            <button
                              className="btn btn-sm"
                              onClick={() => openAdjust(p)}
                              title="Add stock"
                              style={{
                                background: isOut ? '#dc2626' : '#f59e0b', color: '#fff',
                                border: 'none', fontWeight: 700, whiteSpace: 'nowrap',
                              }}
                            >
                              📦 Restock
                            </button>
                          )}
                          <button className="row-btn" onClick={() => openAdjust(p)} title="Adjust stock">⚖️</button>
                          <button className="row-btn" onClick={() => openHistory(p)} title="Stock history">🧾</button>
                          <button className="row-btn" onClick={() => openEdit(p)} title="Edit product">✏️</button>
                          {(p.barcode || p.sku) && (
                            <button className="row-btn" title="Print barcode labels"
                                    onClick={() => { setPrintModal(p); setPrintQty(1); }}>🏷️</button>
                          )}
                          <button className="row-btn danger" onClick={() => handleDelete(p)} title="Archive product">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <Pagination
            page={safePage} pages={totalPages} total={filtered.length} limit={limit}
            onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }}
          />
        )}
      </div>

      {confirm.dialog}

      {/* STOCK ADJUSTMENT MODAL - the only route that both changes stock and records why. */}
      {adjustFor && (
        <div className="modal-overlay" onClick={() => !adjustSaving && setAdjustFor(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Adjust stock</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{adjustFor.name}</div>
              </div>
              <button className="close-btn" onClick={() => setAdjustFor(null)} disabled={adjustSaving}>X</button>
            </div>
            <form onSubmit={submitAdjust}>
              <div className="modal-body">
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', marginBottom: 16,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Currently in stock</span>
                  <StockBadge stock={adjustFor.stock} lowStockAlert={adjustFor.lowStockAlert ?? 10} unit={adjustFor.unit} />
                </div>

                <div className="form-group">
                  <label className="form-label">What are you doing?</label>
                  <div className="chip-row">
                    {[
                      { m: 'add',    label: 'Add stock',    hint: 'Delivery arrived' },
                      { m: 'remove', label: 'Remove stock', hint: 'Damaged or lost' },
                      { m: 'set',    label: 'Set exact',    hint: 'Physical recount' },
                    ].map(o => (
                      <button
                        type="button" key={o.m} title={o.hint}
                        className={`chip ${adjustForm.mode === o.m ? 'active' : ''}`}
                        onClick={() => setAdjustForm(f => ({
                          ...f, mode: o.m,
                          type: o.m === 'add' ? 'purchase' : o.m === 'remove' ? 'damage' : 'correction',
                        }))}
                      >{o.label}</button>
                    ))}
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">
                      {adjustForm.mode === 'set' ? 'Counted quantity *' : 'Quantity *'}
                    </label>
                    <input
                      className="form-control" type="number" min={adjustForm.mode === 'set' ? 0 : 1} step="1"
                      value={adjustForm.quantity} autoFocus required
                      onChange={e => setAdjustForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder={adjustForm.mode === 'set' ? String(adjustFor.stock) : '0'}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reason</label>
                    <select className="form-control" value={adjustForm.type}
                            onChange={e => setAdjustForm(f => ({ ...f, type: e.target.value }))}>
                      <option value="purchase">Stock purchase / delivery</option>
                      <option value="damage">Damaged or expired</option>
                      <option value="correction">Recount correction</option>
                      <option value="adjustment">Other adjustment</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Note (optional)</label>
                  <input className="form-control" value={adjustForm.note} maxLength={500}
                         placeholder="e.g. invoice 4471 from ABC Traders"
                         onChange={e => setAdjustForm(f => ({ ...f, note: e.target.value }))} />
                </div>

                {adjustForm.quantity !== '' && Number.isInteger(parseInt(adjustForm.quantity, 10)) && (() => {
                  const q = parseInt(adjustForm.quantity, 10);
                  const after = adjustForm.mode === 'add' ? adjustFor.stock + q
                              : adjustForm.mode === 'remove' ? adjustFor.stock - q
                              : q;
                  const bad = after < 0;
                  return (
                    <div style={{
                      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                      background: bad ? 'var(--danger-light)' : 'var(--primary-light)',
                      color: bad ? '#b91c1c' : 'var(--primary-dark)',
                      fontSize: 13, fontWeight: 600,
                    }}>
                      {bad
                        ? `Not possible - only ${adjustFor.stock} in stock`
                        : `New stock level will be ${after} ${adjustFor.unit || ''}`}
                    </div>
                  );
                })()}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setAdjustFor(null)} disabled={adjustSaving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={adjustSaving || adjustForm.quantity === ''}>
                  {adjustSaving ? 'Saving...' : 'Save adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STOCK HISTORY MODAL */}
      {historyFor && (
        <div className="modal-overlay" onClick={() => setHistoryFor(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Stock history</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{historyFor.name}</div>
              </div>
              <button className="close-btn" onClick={() => setHistoryFor(null)}>X</button>
            </div>
            <div className="modal-body" style={{ padding: 0, maxHeight: '65vh', overflowY: 'auto' }}>
              {historyLoading ? <TableSkeleton rows={5} cols={5} />
                : history.length === 0 ? (
                  <EmptyState
                    icon="."
                    title="No movements recorded yet"
                    message="Stock changes are logged from now on - sales, returns and adjustments will all appear here."
                  />
                ) : (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>When</th><th>Type</th>
                          <th className="num">Change</th>
                          <th className="num">Before / After</th>
                          <th>Reference</th><th>By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(m => (
                          <tr key={m.id}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{dateTime(m.createdAt)}</td>
                            <td style={{ textTransform: 'capitalize' }}>{m.type}</td>
                            <td className={`num ${m.quantity > 0 ? 'delta-in' : 'delta-out'}`}>
                              {m.quantity > 0 ? '+' : ''}{m.quantity}
                            </td>
                            <td className="num" style={{ color: 'var(--text-secondary)' }}>
                              {m.stockBefore} to <b style={{ color: 'var(--text-primary)' }}>{m.stockAfter}</b>
                            </td>
                            <td>
                              <div className="mono">{m.reference || '-'}</div>
                              {m.note && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.note}</div>}
                            </td>
                            <td style={{ fontSize: 12 }}>{m.userName || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* ── LOW STOCK MODAL ──────────────────────────────────────────────────── */}
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
              {lowStockItems.length === 0 ? (
                <div className="empty-state" style={{ padding: '50px 20px' }}>
                  <div className="empty-icon">✅</div>
                  <div className="empty-text">All products are well stocked!</div>
                  <div className="empty-sub">No items below the alert threshold</div>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table" style={{ minWidth: '560px' }}>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Category</th>
                        <th style={{ textAlign: 'center' }}>Current Stock</th>
                        <th style={{ textAlign: 'center' }}>Alert Level</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockItems.map(p => {
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
                            <td>
                              <button
                                onClick={() => { setLowStockModal(false); openEdit(p); }}
                                style={{
                                  padding: '4px 12px', fontSize: '12px', fontWeight: '700',
                                  background: '#6366f1', color: '#fff',
                                  border: 'none', borderRadius: '6px', cursor: 'pointer'
                                }}
                              >
                                ✏️ Edit / Restock
                              </button>
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
                {lowStockItems.length} product{lowStockItems.length !== 1 ? 's' : ''} need attention
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => { setLowStockModal(false); setLowStockFilter(true); }}
                >
                  ⚠️ Filter Low Stock
                </button>
                <button className="btn btn-outline" onClick={() => setLowStockModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD / EDIT MODAL ─────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '740px' }}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? '✏️ Edit Product' : '➕ Add New Product'}</span>
              <button className="close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">

                {/* Image Upload */}
                <div className="form-group">
                  <label className="form-label">Product Image</label>
                  <div
                    onClick={() => fileInputRef.current.click()}
                    onDrop={handleDrop} onDragOver={e => e.preventDefault()}
                    style={{ border: `2px dashed ${imagePreview ? 'var(--primary)' : 'var(--border)'}`, borderRadius: '12px', padding: imagePreview ? '8px' : '28px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '6px', minHeight: imagePreview ? 'auto' : '100px' }}
                  >
                    {imagePreview ? (
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <img src={imagePreview} alt="Preview" style={{ maxHeight: '120px', maxWidth: '100%', borderRadius: '8px', objectFit: 'contain' }} />
                        <button type="button" onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{ position: 'absolute', top: '-8px', right: '-8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }}>✕</button>
                        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>Click to change</div>
                      </div>
                    ) : (
                      <><div style={{ fontSize: '30px' }}>🖼️</div><div style={{ fontWeight: '600', color: 'var(--text-secondary)', fontSize: '13px' }}>Click to upload or drag & drop</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>JPG, PNG — max 5MB</div></>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Product Name *</label>
                    <input className="form-control" required value={form.name}
                      onChange={e => {
                        const name = e.target.value;
                        setForm(f => ({ ...f, name, sku: f.sku || generateSKU(name) }));
                      }}
                      placeholder="e.g. Paracetamol 500mg" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">SKU</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input className="form-control" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="Auto-generated" />
                      <button type="button" onClick={() => setForm(f => ({ ...f, sku: generateSKU(f.name) }))}
                        style={{ padding: '0 10px', background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontWeight: '600' }}>
                        🔄 Auto
                      </button>
                    </div>
                  </div>
                </div>

                {/* Barcode field */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Barcode Number</span>
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, barcode: generateBarcode() }))}
                      style={{ fontSize: '11px', fontWeight: '700', padding: '3px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                      🔄 Generate New
                    </button>
                  </label>
                  <input
                    className="form-control"
                    value={form.barcode}
                    onChange={e => setForm({ ...form, barcode: e.target.value })}
                    placeholder="Scan existing barcode or click Generate New"
                    style={{ fontFamily: 'monospace', fontSize: '14px', letterSpacing: '1px' }}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    💡 Scan any existing barcode with your USB scanner into this field, or click "Generate New" to create one
                  </div>
                </div>

                {form.barcode && (
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px', marginBottom: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      📊 Barcode Preview
                    </div>
                    <canvas ref={barcodeCanvasRef} style={{ maxWidth: '100%', background: '#fff', borderRadius: '6px' }} />
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                      This barcode will be printed on product labels
                    </div>
                  </div>
                )}

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select className="form-control" value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>
                      <option value="">Select Category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Supplier</label>
                    <select className="form-control" value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}>
                      <option value="">Select Supplier</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cost Price (৳) *</label>
                    <input className="form-control" type="number" step="0.01" required value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Selling Price (৳) *</label>
                    <input className="form-control" type="number" step="0.01" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Stock Quantity *</label>
                    <input className="form-control" type="number" required value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Low Stock Alert</label>
                    <input className="form-control" type="number" value={form.lowStockAlert} onChange={e => setForm({ ...form, lowStockAlert: e.target.value })} placeholder="10" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unit</label>
                    <select className="form-control" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                      <option value="pcs">Pieces (pcs)</option>
                      <option value="kg">Kilogram (kg)</option>
                      <option value="g">Gram (g)</option>
                      <option value="liter">Liter</option>
                      <option value="ml">Milliliter (ml)</option>
                      <option value="box">Box</option>
                      <option value="pack">Pack</option>
                      <option value="bottle">Bottle</option>
                      <option value="dozen">Dozen</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input className="form-control" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
                  </div>
                </div>

                {form.price && form.cost && parseFloat(form.price) > 0 && (
                  <div style={{ padding: '12px 16px', background: 'var(--primary-light)', borderRadius: '8px', display: 'flex', gap: '24px', marginTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Profit Margin</span>
                      <div style={{ fontWeight: '700', color: 'var(--primary)' }}>{((form.price - form.cost) / form.price * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Profit per unit</span>
                      <div style={{ fontWeight: '700', color: 'var(--secondary)' }}>৳{(form.price - form.cost).toFixed(2)}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : editItem ? 'Update Product' : 'Add Product'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── PRINT BARCODE LABEL MODAL ─────────────────────────────────────────── */}
      {printModal && (
        <div className="modal-overlay" onClick={() => setPrintModal(null)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🏷️ Print Barcode Label</span>
              <button className="close-btn" onClick={() => setPrintModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: '12px', padding: '20px', textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#111', marginBottom: '8px', maxWidth: '200px', margin: '0 auto 8px', wordBreak: 'break-word' }}>
                  {printModal.name}
                </div>
                <canvas ref={printCanvasRef} style={{ maxWidth: '100%', background: '#fff' }} />
                <div style={{ fontSize: '14px', fontWeight: '800', color: '#111', marginTop: '6px' }}>
                  ৳{fmt(printModal.price)}
                </div>
              </div>
              <div style={{ background: 'var(--bg)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Barcode Number</div>
                <div style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '15px', letterSpacing: '2px' }}>
                  {printModal.barcode || printModal.sku}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: '700' }}>How many labels to print?</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button onClick={() => setPrintQty(q => Math.max(1, q - 1))} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1.5px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: '18px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <input type="number" min="1" max="100" value={printQty} onChange={e => setPrintQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: '70px', textAlign: 'center', padding: '6px', border: '1.5px solid var(--border)', borderRadius: '8px', fontSize: '16px', fontWeight: '700', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                  <button onClick={() => setPrintQty(q => Math.min(100, q + 1))} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1.5px solid #6366f1', background: '#6366f1', cursor: 'pointer', fontSize: '18px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>+</button>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>labels</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {[1, 5, 10, 20, 50].map(n => (
                    <button key={n} onClick={() => setPrintQty(n)} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: '700', borderRadius: '6px', border: '1.5px solid', borderColor: printQty === n ? '#6366f1' : 'var(--border)', background: printQty === n ? '#6366f120' : 'var(--bg)', color: printQty === n ? '#6366f1' : 'var(--text-secondary)', cursor: 'pointer' }}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setPrintModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePrint}>
                🖨️ Print {printQty} Label{printQty !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}