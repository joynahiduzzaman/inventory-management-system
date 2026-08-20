import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useUSBScanner } from '../components/BarcodeScanner';
import CameraScannerModal from '../components/CameraScannerModal';
import { fileUrl, errorMessage, money } from '../utils/config';

const fmtBD = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n || 0).toFixed(0));

export default function POS({ darkMode, toggleDark }) {
  const [products, setProducts]         = useState([]);
  const [customers, setCustomers]       = useState([]);
  const [categories, setCategories]     = useState([]);
  const [cart, setCart]                 = useState([]);
  const [search, setSearch]             = useState('');
  const [filterCat, setFilterCat]       = useState('');
  const [customerId, setCustomerId]     = useState('');
  const [addCustModal, setAddCustModal] = useState(false);
  const [newCust, setNewCust]           = useState({ name: '', phone: '', email: '', address: '' });
  const [savingCust, setSavingCust]     = useState(false);
  const [paymentMethod, setPayMethod]   = useState('cash');
  const [discount, setDiscount]         = useState(0);
  const [paid, setPaid]                 = useState('');
  const [note, setNote]                 = useState('');
  const [loading, setLoading]           = useState(true);
  const [processing, setProcessing]     = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [cameraOpen, setCameraOpen]     = useState(false);
  const [scanInput, setScanInput]       = useState('');
  const [scanning, setScanning]         = useState(false);
  const [scanStatus, setScanStatus]     = useState({ msg: '', type: '' });
  const scanInputRef = useRef(null);
  const scanDebounce = useRef(null);

  // ─── Load data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [p, c, cats] = await Promise.all([
        api.get('/products'),
        api.get('/customers'),
        api.get('/categories')
      ]);
      setProducts(p.data.data);
      setCustomers(c.data.data);
      setCategories(cats.data.data);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Add product to cart ─────────────────────────────────────────────────────
  const addToCart = useCallback((product) => {
    if (product.stock === 0) {
      setScanStatus({ msg: `❌ "${product.name}" is out of stock`, type: 'error' });
      return;
    }
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          setScanStatus({ msg: `⚠️ Only ${product.stock} in stock`, type: 'error' });
          return prev;
        }
        setScanStatus({ msg: `✅ ${product.name} — qty ${existing.quantity + 1}`, type: 'success' });
        return prev.map(i => i.productId === product.id
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
          : i
        );
      }
      setScanStatus({ msg: `✅ ${product.name} added to cart`, type: 'success' });
      return [...prev, {
        productId: product.id,
        name: product.name,
        price: parseFloat(product.price),
        cost: parseFloat(product.cost || 0),
        quantity: 1,
        stock: product.stock,
        total: parseFloat(product.price),
        image: product.image,
        unit: product.unit
      }];
    });
  }, []);

  // ─── Core scan handler ────────────────────────────────────────────────────────
  const handleScan = useCallback(async (code) => {
    if (!code || code.length < 1) return;
    clearTimeout(scanDebounce.current);
    scanDebounce.current = setTimeout(async () => {
      setScanning(true);
      setScanStatus({ msg: `🔍 Scanning: ${code}`, type: 'info' });
      try {
        const res = await api.get(`/products/scan/${encodeURIComponent(code)}`);
        addToCart(res.data.data);
      } catch (err) {
        const msg = err.response?.data?.message || `Product not found: "${code}"`;
        setScanStatus({ msg: `❌ ${msg}`, type: 'error' });
        toast.error(msg, { duration: 2500 });
      } finally {
        setScanning(false);
        setScanInput('');
        setTimeout(() => setScanStatus({ msg: '', type: '' }), 3000);
      }
    }, 80);
  }, [addToCart]);

  // ─── USB scanner hook ────────────────────────────────────────────────────────
  useUSBScanner({ onScan: handleScan, enabled: !cameraOpen });

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────
  // A till is driven by hands on a keyboard, not a mouse. F2 jumps to the scan
  // box, F4 takes payment, Esc clears. Registered once, ignored while a modal
  // owns the screen.
  useEffect(() => {
    const onKey = (e) => {
      if (cameraOpen || invoiceModal || addCustModal) return;
      if (e.key === 'F2') { e.preventDefault(); scanInputRef.current?.focus(); scanInputRef.current?.select(); }
      if (e.key === 'F4') { e.preventDefault(); document.getElementById('pos-checkout')?.click(); }
      if (e.key === 'F3') { e.preventDefault(); document.getElementById('pos-paid')?.focus(); }
      if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT') {
        document.getElementById('pos-clear')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cameraOpen, invoiceModal, addCustModal]);

  // ─── Manual scan input ───────────────────────────────────────────────────────
  const handleManualScan = (e) => {
    e.preventDefault();
    if (scanInput.trim()) handleScan(scanInput.trim());
  };

  // ─── Cart operations ─────────────────────────────────────────────────────────
  const updateQty = (productId, qty) => {
    if (qty < 1) return removeItem(productId);
    const item = cart.find(i => i.productId === productId);
    if (qty > item.stock) return toast.error(`Only ${item.stock} in stock`);
    setCart(cart.map(i => i.productId === productId
      ? { ...i, quantity: qty, total: qty * i.price } : i
    ));
  };
  const removeItem = (productId) => setCart(cart.filter(i => i.productId !== productId));
  const clearCart  = () => {
    if (!window.confirm('Clear cart?')) return;
    setCart([]); setDiscount(0); setPaid(''); setNote(''); setCustomerId('');
  };

  const subtotal    = Math.round(cart.reduce((s, i) => s + i.total, 0) * 100) / 100;
  const discountRaw = parseFloat(discount) || 0;
  // A discount bigger than the bill is a typo; the server rejects it, so flag it here too.
  const discountAmt = Math.max(0, discountRaw);
  const discountTooBig = discountAmt > subtotal;
  const total       = Math.round(Math.max(0, subtotal - discountAmt) * 100) / 100;
  // Blank = "paying the full amount". A typed 0 = a fully-on-credit sale.
  const paidEntered = paid !== '' && paid !== null && paid !== undefined;
  const paidAmt     = paidEntered ? (parseFloat(paid) || 0) : total;
  const change      = Math.round((paidAmt - total) * 100) / 100;
  const dueAmt      = Math.max(0, -change);
  // Money owed has to be attached to somebody the shop can chase.
  const needsCustomerForDue = dueAmt > 0 && !customerId;

  // ─── Checkout ────────────────────────────────────────────────────────────────
  const handleCheckout = async () => {
    if (!cart.length) return toast.error('Cart is empty!');
    if (discountTooBig) return toast.error('Discount is larger than the subtotal');
    if (needsCustomerForDue) {
      return toast.error('Pick a customer before leaving an amount due, so the balance can be tracked');
    }
    setProcessing(true);
    try {
      const res = await api.post('/sales', {
        customerId: customerId || null,
        items: cart.map(i => ({ productId: i.productId, quantity: i.quantity })),
        discount: discountAmt, tax: 0,
        paid: paidAmt,
        paymentMethod, note
      });
      setInvoiceModal(res.data.data);
      setCart([]); setDiscount(0); setPaid(''); setNote(''); setCustomerId('');
      fetchData();
      toast.success('Sale completed! 🎉');
    } catch (err) {
      toast.error(errorMessage(err, 'Checkout failed'));
    } finally { setProcessing(false); }
  };

  // ─── Filtered products ───────────────────────────────────────────────────────
  const filtered = products.filter(p => {
    const s = search.toLowerCase();
    const matchSearch = !search ||
      p.name.toLowerCase().includes(s) ||
      (p.sku     && p.sku.toLowerCase().includes(s)) ||
      (p.barcode && p.barcode.toLowerCase().includes(s));
    return matchSearch && (!filterCat || String(p.categoryId) === String(filterCat));
  });

  const isInCart   = (id) => cart.some(i => i.productId === id);
  const getCartQty = (id) => cart.find(i => i.productId === id)?.quantity || 0;
  const getEmoji   = (name) => ({ Medicine:'💊', Electronics:'📱', Grocery:'🛒', Clothing:'👕', Stationery:'📚' })[name] || '📦';
  const payMethods = [
    { id:'cash',  label:'💵 Cash',  color:'#22c55e' },
    { id:'bkash', label:'📱 bKash', color:'#e91e8c' },
    { id:'nagad', label:'🧡 Nagad', color:'#f59e0b' },
    { id:'card',  label:'💳 Card',  color:'#3b82f6' }
  ];
  const statusColor = { success: '#22c55e', error: '#dc2626', info: '#6366f1' };

  return (
    <Layout
      title="Point of Sale"
      subtitle={`${cart.length} item${cart.length !== 1 ? 's' : ''} in cart`}
      darkMode={darkMode} toggleDark={toggleDark}
    >
      {/* ── SCANNER BAR ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '10px', padding: '8px 14px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <form onSubmit={handleManualScan} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px' }}>
            <input
              ref={scanInputRef}
              data-scan-input="true"
              className="form-control"
              placeholder="Type or scan barcode / QR / SKU here..."
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              disabled={scanning}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px', height: '34px', letterSpacing: '0.5px' }}
            />
            <button
              type="submit"
              disabled={!scanInput.trim() || scanning}
              style={{ padding: '0 14px', height: '34px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '8px', cursor: scanInput.trim() ? 'pointer' : 'not-allowed', fontWeight: '600', fontSize: '12px', whiteSpace: 'nowrap', opacity: scanInput.trim() ? 1 : 0.5 }}
            >
              🔍 Search
            </button>
          </form>
          <button
            onClick={() => setCameraOpen(true)}
            style={{ padding: '0 12px', height: '34px', background: 'var(--bg)', border: '1.5px solid #6366f1', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px', color: '#6366f1', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            📸 Camera Scan
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: 'var(--bg)', borderRadius: '7px', border: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>USB Ready</span>
          </div>
          <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            <span><kbd>F2</kbd> scan</span>
            <span><kbd>F3</kbd> payment</span>
            <span><kbd>F4</kbd> complete</span>
          </div>
        </div>
        {scanStatus.msg && (
          <div style={{
            marginTop: '6px', padding: '5px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
            background: scanStatus.type === 'success' ? '#dcfce7' : scanStatus.type === 'error' ? '#fee2e2' : '#ede9fe',
            color: statusColor[scanStatus.type] || '#6366f1',
            border: `1px solid ${statusColor[scanStatus.type] || '#6366f1'}30`,
            transition: 'all 0.3s'
          }}>
            {scanStatus.msg}
          </div>
        )}
      </div>

      {/* ── MAIN LAYOUT ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '16px', height: 'calc(100vh - 170px)', minHeight: '560px' }}>

        {/* LEFT — Products Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
          <div className="card" style={{ padding: '8px 12px', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
                <input className="form-control" style={{ paddingLeft: '32px' }} placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="form-control" style={{ width: '150px' }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{filtered.length} products</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div className="loading-page"><div className="spinner" /></div>
            ) : filtered.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">No products found</div></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', padding: '2px' }}>
                {filtered.map(p => {
                  const inCart = isInCart(p.id);
                  const qty    = getCartQty(p.id);
                  const oos    = p.stock === 0;
                  return (
                    <div
                      key={p.id}
                      onClick={() => !oos && addToCart(p)}
                      style={{
                        background: 'var(--bg-card)', border: `2px solid ${inCart ? '#6366f1' : 'var(--border)'}`,
                        borderRadius: '10px', padding: '10px 8px', cursor: oos ? 'not-allowed' : 'pointer',
                        opacity: oos ? 0.5 : 1, transition: 'all 0.15s', textAlign: 'center', position: 'relative',
                        boxShadow: inCart ? '0 0 0 3px rgba(99,102,241,0.12)' : 'none'
                      }}
                      onMouseEnter={e => { if (!oos) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
                    >
                      {inCart && (
                        <div style={{ position: 'absolute', top: '-8px', right: '-8px', background: '#6366f1', color: '#fff', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800' }}>{qty}</div>
                      )}
                      {p.image
                        ? <img src={fileUrl(p.image)} alt={p.name} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '7px', marginBottom: '6px', border: '1px solid var(--border)' }} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }} />
                        : null}
                      <div style={{ fontSize: '26px', marginBottom: '5px', display: p.image ? 'none' : 'block' }}>{getEmoji(p.category?.name)}</div>
                      <div style={{ fontWeight: '600', fontSize: '11px', marginBottom: '2px', lineHeight: '1.3', wordBreak: 'break-word' }}>{p.name}</div>
                      {p.sku && <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: '3px' }}>{p.sku}</div>}
                      <div style={{ fontWeight: '800', fontSize: '13px', color: '#6366f1', marginBottom: '2px' }}>৳{fmtBD(p.price)}</div>
                      <div style={{ fontSize: '9px', color: oos ? '#dc2626' : p.stock <= p.lowStockAlert ? '#f59e0b' : 'var(--text-muted)' }}>
                        {oos ? '❌ Out of stock' : `Stock: ${p.stock}`}
                      </div>
                      {!oos && (
                        <div style={{ marginTop: '6px', background: inCart ? '#6366f1' : 'var(--bg)', color: inCart ? '#fff' : '#6366f1', border: '1px solid #6366f1', borderRadius: '5px', padding: '2px 0', fontSize: '10px', fontWeight: '600' }}>
                          {inCart ? `✓ In Cart (${qty})` : '+ Add'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Cart */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

            {/* Cart header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ fontWeight: '700', fontSize: '15px' }}>
                🛒 Cart
                {cart.length > 0 && <span style={{ marginLeft: '8px', background: '#6366f1', color: '#fff', borderRadius: '12px', padding: '2px 8px', fontSize: '11px' }}>{cart.reduce((s,i) => s+i.quantity, 0)} items</span>}
              </div>
              {cart.length > 0 && <button id="pos-clear" onClick={clearCart} title="Clear cart (Esc)" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontSize: '12px', color: '#dc2626' }}>Clear</button>}
            </div>

            {/* ── CUSTOMER ROW — Walk-in dropdown + New button inline ── */}
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="form-control"
                  style={{ flex: 1, fontSize: '13px' }}
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                >
                  <option value="">👤 Walk-in Customer</option>
                  {customers.map(cu => (
                    <option key={cu.id} value={cu.id}>
                      {cu.name}{cu.phone ? ` — ${cu.phone}` : ''}
                      {cu.dueAmount > 0 ? ` ⚠️ Due: ৳${cu.dueAmount}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => { setNewCust({ name: '', phone: '', email: '', address: '' }); setAddCustModal(true); }}
                  style={{ whiteSpace: 'nowrap', padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}
                  title="Add new customer"
                >
                  + New
                </button>
              </div>
            </div>

            {/* Cart items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '44px', marginBottom: '10px' }}>🛒</div>
                  <div style={{ fontWeight: '600', marginBottom: '6px' }}>Cart is empty</div>
                  <div style={{ fontSize: '12px' }}>Scan a barcode, click a product, or search above</div>
                </div>
              ) : cart.map((item, idx) => (
                <div key={item.productId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: idx < cart.length-1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '7px', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0, overflow: 'hidden' }}>
                    {item.image ? <img src={fileUrl(item.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display='none'; }} /> : '📦'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>৳{fmtBD(item.price)} each</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                    <button onClick={() => updateQty(item.productId, item.quantity-1)} style={{ width: '24px', height: '24px', borderRadius: '5px', border: '1.5px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>−</button>
                    <input type="number" value={item.quantity} min="1" max={item.stock} onChange={e => updateQty(item.productId, parseInt(e.target.value)||1)} style={{ width: '36px', textAlign: 'center', border: '1.5px solid var(--border)', borderRadius: '5px', padding: '2px', fontSize: '12px', fontWeight: '700', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                    <button onClick={() => updateQty(item.productId, item.quantity+1)} style={{ width: '24px', height: '24px', borderRadius: '5px', border: '1.5px solid #6366f1', background: '#6366f1', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>+</button>
                  </div>
                  <div style={{ fontWeight: '700', fontSize: '12px', color: '#6366f1', minWidth: '55px', textAlign: 'right' }}>৳{fmtBD(item.total)}</div>
                  <button onClick={() => removeItem(item.productId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '15px', padding: '2px', flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>

            {/* Checkout panel */}
            <div style={{ borderTop: '2px solid var(--border)', padding: '10px 14px', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <span>Subtotal ({cart.reduce((s,i)=>s+i.quantity,0)} items)</span>
                <span style={{ fontWeight: '600' }}>৳{fmtBD(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Discount (৳)</span>
                <input type="number" min="0" max={subtotal} value={discount} onChange={e => setDiscount(e.target.value)} style={{ width: '90px', padding: '4px 8px', border: '1.5px solid var(--border)', borderRadius: '6px', textAlign: 'right', fontSize: '13px', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', background: '#6366f1', borderRadius: '10px', marginBottom: '8px' }}>
                <span style={{ fontWeight: '700', fontSize: '14px', color: '#fff' }}>TOTAL</span>
                <span style={{ fontWeight: '900', fontSize: '18px', color: '#fff' }}>৳{fmtBD(total)}</span>
              </div>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', background: 'var(--bg)', borderRadius: '10px', padding: '3px', border: '1px solid var(--border)' }}>
                {payMethods.map(m => (
                  <button key={m.id} onClick={() => setPayMethod(m.id)} style={{ flex: 1, padding: '6px 2px', borderRadius: '7px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: 'none', background: paymentMethod===m.id ? m.color : 'transparent', color: paymentMethod===m.id ? '#fff' : 'var(--text-secondary)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>{m.label}</button>
                ))}
              </div>
              <input id="pos-paid" type="number" min="0" step="0.01" placeholder={`Amount received (blank = full ৳${fmtBD(total)})`} value={paid} onChange={e => setPaid(e.target.value)} className="form-control" style={{ textAlign: 'right', marginBottom: '6px', fontSize: '13px' }} />
              {discountTooBig && (
                <div style={{ padding: '7px 12px', borderRadius: '7px', marginBottom: '6px', background: '#fee2e2', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
                  Discount is larger than the subtotal
                </div>
              )}
              {needsCustomerForDue && (
                <div style={{ padding: '7px 12px', borderRadius: '7px', marginBottom: '6px', background: '#fef3c7', color: '#b45309', fontSize: '12px', fontWeight: 600 }}>
                  {money(dueAmt)} will be left unpaid - choose a customer above so the due can be tracked
                </div>
              )}
              {paid && paidAmt > 0 && (
                <div style={{ padding: '7px 12px', borderRadius: '7px', marginBottom: '6px', background: change>=0 ? '#dcfce7' : '#fee2e2', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: change>=0 ? '#166534' : '#dc2626', fontWeight: '600' }}>{change>=0 ? '💚 Change' : '🔴 Due'}</span>
                  <span style={{ fontWeight: '700', color: change>=0 ? '#166534' : '#dc2626' }}>৳{fmtBD(Math.abs(change))}</span>
                </div>
              )}
              <input className="form-control" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: '6px', fontSize: '12px' }} />
              <button id="pos-checkout" title="Complete sale (F4)" onClick={handleCheckout} disabled={cart.length===0 || processing || discountTooBig || needsCustomerForDue} style={{ width: '100%', padding: '13px', fontSize: '14px', fontWeight: '700', borderRadius: '10px', border: 'none', cursor: cart.length===0 ? 'not-allowed' : 'pointer', background: cart.length===0 ? 'var(--border)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: cart.length===0 ? 'var(--text-muted)' : '#fff', boxShadow: cart.length>0 ? '0 4px 15px rgba(99,102,241,0.4)' : 'none', transition: 'all 0.2s' }}>
                {processing ? 'Processing...' : cart.length===0 ? 'Add products to cart' : `Complete Sale — ৳${fmtBD(total)}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── CAMERA MODAL ─────────────────────────────────────────────────────── */}
      {cameraOpen && (
        <CameraScannerModal
          onScan={(code) => { handleScan(code); }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* ── INVOICE MODAL ────────────────────────────────────────────────────── */}
      {invoiceModal && (
        <div className="modal-overlay" onClick={() => setInvoiceModal(null)}>
          <div className="modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🧾 Invoice — {invoiceModal.invoiceNo}</span>
              <button className="close-btn" onClick={() => setInvoiceModal(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              <div style={{ background: '#fff', color: '#1e293b', fontFamily: 'Arial, sans-serif' }}>
                <div style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', padding: '24px 28px', color: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.5px', marginBottom: '2px' }}>📦 Domingo Shop</div>
                      <div style={{ fontSize: '12px', opacity: 0.8 }}>Dhaka, Bangladesh</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', opacity: 0.75, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>Invoice</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: '700', background: 'rgba(255,255,255,0.15)', padding: '4px 10px', borderRadius: '6px' }}>{invoiceModal.invoiceNo}</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderBottom: '1px solid #e2e8f0' }}>
                  {[
                    ['Date', new Date(invoiceModal.createdAt || Date.now()).toLocaleDateString('en-BD', { year:'numeric', month:'short', day:'numeric' })],
                    ['Time', new Date(invoiceModal.createdAt || Date.now()).toLocaleTimeString('en-BD', { hour:'2-digit', minute:'2-digit' })],
                    ['Customer', invoiceModal.customer?.name || 'Walk-in Customer'],
                    ['Payment', (invoiceModal.paymentMethod || 'CASH').toUpperCase()],
                  ].map(([label, val]) => (
                    <div key={label} style={{ padding: '12px 20px', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '10px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>{label}</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b' }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '20px 20px 0' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        {['#','Item','Qty','Price','Total'].map(h => (
                          <th key={h} style={{ padding: '10px 12px', textAlign: h==='Qty' ? 'center' : ['Price','Total'].includes(h) ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceModal.items?.map((item, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: '600' }}>{i + 1}</td>
                          <td style={{ padding: '10px 12px', fontWeight: '600', color: '#1e293b' }}>{item.productName}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b' }}>{item.quantity}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>৳{fmtBD(item.price)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#6366f1' }}>৳{fmtBD(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '16px 20px', margin: '0 20px 20px', background: '#f8fafc', borderRadius: '10px' }}>
                  {parseFloat(invoiceModal.discount) > 0 && (<>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                      <span style={{ color: '#64748b' }}>Subtotal</span>
                      <span style={{ fontWeight: '600' }}>৳{fmtBD(parseFloat(invoiceModal.total) + parseFloat(invoiceModal.discount))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                      <span style={{ color: '#dc2626' }}>Discount</span>
                      <span style={{ fontWeight: '600', color: '#dc2626' }}>-৳{fmtBD(invoiceModal.discount)}</span>
                    </div>
                  </>)}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #e2e8f0', marginTop: '4px' }}>
                    <span style={{ fontWeight: '800', fontSize: '15px' }}>TOTAL</span>
                    <span style={{ fontWeight: '900', fontSize: '18px', color: '#6366f1' }}>৳{fmtBD(invoiceModal.total)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '6px' }}>
                    <span style={{ color: '#64748b' }}>Amount Paid</span>
                    <span style={{ fontWeight: '700', color: '#22c55e' }}>৳{fmtBD(invoiceModal.paid)}</span>
                  </div>
                  {parseFloat(invoiceModal.due) > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', padding: '8px 12px', background: '#fee2e2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                      <span style={{ fontSize: '13px', color: '#dc2626', fontWeight: '700' }}>⚠️ Amount Due</span>
                      <span style={{ fontWeight: '800', color: '#dc2626', fontSize: '14px' }}>৳{fmtBD(invoiceModal.due)}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px', padding: '6px', background: '#dcfce7', borderRadius: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '700' }}>✅ PAID IN FULL</span>
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px 20px', borderTop: '2px dashed #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#6366f1', marginBottom: '3px' }}>Thank you for your purchase! 🙏</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Domingo Shop • Dhaka, Bangladesh</div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => {
                const inv = invoiceModal;
                // buildReceipt: generates thermal 80mm receipt HTML
                const fmt80 = (n) => new Intl.NumberFormat('en-BD').format(parseFloat(n||0).toFixed(0));
                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Receipt ${inv.invoiceNo}</title>
<style>
  /* ── Thermal 80mm receipt ── */
  @page { size: 80mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #000;
    background: #fff;
    width: 76mm;
    padding: 3mm;
  }
  .center { text-align: center; }
  .shop-name { font-size: 16px; font-weight: 900; letter-spacing: 1px; }
  .divider { border-top: 1px dashed #000; margin: 5px 0; }
  .divider-solid { border-top: 1px solid #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; font-size: 11px; }
  .label { color: #555; }
  .bold { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 11px; }
  th { font-weight: 700; border-bottom: 1px solid #000; padding: 3px 2px; text-align: left; font-size: 10px; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 3px 2px; border-bottom: 1px dashed #ccc; }
  .total-section { margin-top: 4px; }
  .grand { font-size: 15px; font-weight: 900; }
  .paid-full { text-align: center; font-weight: 900; font-size: 12px; margin: 4px 0; }
  .due-box { border: 2px solid #000; padding: 4px 6px; margin: 4px 0; }
  .footer-msg { text-align: center; font-size: 11px; margin-top: 6px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>

<div class="center">
  <div class="shop-name">DOMINGO SHOP</div>
  <div style="font-size:10px;color:#444;">Dhaka, Bangladesh</div>
  <div style="font-size:10px;margin-top:2px;">${inv.invoiceNo}</div>
</div>

<div class="divider"></div>
<div class="row"><span class="label">Date</span><span>${new Date(inv.createdAt||Date.now()).toLocaleDateString('en-BD',{day:'2-digit',month:'short',year:'numeric'})}</span></div>
<div class="row"><span class="label">Time</span><span>${new Date(inv.createdAt||Date.now()).toLocaleTimeString('en-BD',{hour:'2-digit',minute:'2-digit'})}</span></div>
<div class="row"><span class="label">Customer</span><span>${inv.customer?.name||'Walk-in'}</span></div>
<div class="row"><span class="label">Payment</span><span class="bold">${(inv.paymentMethod||'CASH').toUpperCase()}</span></div>

<div class="divider"></div>
<table>
  <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
  <tbody>
    ${inv.items?.map(item=>`
    <tr>
      <td>${item.productName}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">৳${fmt80(item.price)}</td>
      <td style="text-align:right"><b>৳${fmt80(item.total)}</b></td>
    </tr>`).join('')}
  </tbody>
</table>

<div class="divider-solid"></div>
<div class="total-section">
  ${parseFloat(inv.discount)>0 ? `
  <div class="row"><span>Subtotal</span><span>৳${fmt80(parseFloat(inv.total)+parseFloat(inv.discount))}</span></div>
  <div class="row"><span>Discount</span><span>-৳${fmt80(inv.discount)}</span></div>
  <div class="divider"></div>` : ''}
  <div class="row grand"><span>TOTAL</span><span>৳${fmt80(inv.total)}</span></div>
  <div class="row"><span>Paid</span><span class="bold">৳${fmt80(inv.paid)}</span></div>
  ${parseFloat(inv.due)>0
    ? `<div class="due-box row"><span>⚠ DUE</span><span class="bold">৳${fmt80(inv.due)}</span></div>`
    : `<div class="paid-full">*** PAID IN FULL ***</div>`}
</div>

<div class="divider"></div>
<div class="footer-msg">
  Thank you for your purchase!<br/>
  <span style="font-size:10px;color:#555;">Domingo Shop • Dhaka, Bangladesh</span>
</div>

<script>window.onload=()=>{window.print();window.close();}<' + '/script>
</body></html>`;
                const w = window.open('', '_blank', 'width=320,height=600');
                w.document.write(html);
                w.document.close();
              }}>🖨️ Print Invoice</button>
              <button className="btn btn-primary" onClick={() => setInvoiceModal(null)}>✅ New Sale</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* ── Add Customer Modal ───────────────────────────────────────────────── */}
      {addCustModal && (
        <div className="modal-overlay" onClick={() => setAddCustModal(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">👤 Add New Customer</div>
              <button className="close-btn" onClick={() => setAddCustModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Phone *</label>
                <input className="form-control" placeholder="01XXXXXXXXX" value={newCust.phone} autoFocus
                  onChange={e => {
                    const phone = e.target.value;
                    // Always reset existingId on every keystroke so backspacing immediately unlocks
                    setNewCust(p => ({ ...p, phone, existingId: null }));
                    // Only auto-fill on EXACT full phone match — never partial
                    if (phone.trim().length >= 11) {
                      const existing = customers.find(cu => cu.phone && cu.phone.trim() === phone.trim());
                      if (existing) {
                        setNewCust({
                          name: existing.name,
                          phone: existing.phone,
                          email: existing.email || '',
                          address: existing.address || '',
                          existingId: existing.id,
                        });
                      }
                    }
                  }}
                />
              </div>
              {newCust.existingId && (
                <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '13px', color: '#166534' }}>
                  ✅ Existing customer found — details filled in. Click <strong>Select</strong> to use them.
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-control" placeholder="Customer name" value={newCust.name}
                  onChange={e => setNewCust(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-control" placeholder="Optional" value={newCust.email}
                  onChange={e => setNewCust(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Address</label>
                <input className="form-control" placeholder="Optional" value={newCust.address}
                  onChange={e => setNewCust(p => ({ ...p, address: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setAddCustModal(false)}>Cancel</button>
              {newCust.existingId ? (
                <button className="btn btn-primary" onClick={() => {
                  setCustomerId(String(newCust.existingId));
                  setAddCustModal(false);
                  toast.success(`✅ ${newCust.name} selected!`);
                }}>✅ Select Customer</button>
              ) : (
                <button className="btn btn-primary" disabled={savingCust || !newCust.name.trim() || !newCust.phone.trim()}
                  onClick={async () => {
                    setSavingCust(true);
                    try {
                      const res = await api.post('/customers', {
                        name:    newCust.name.trim(),
                        phone:   newCust.phone.trim(),
                        email:   newCust.email.trim() || null,
                        address: newCust.address.trim() || null,
                      });
                      const saved = res.data.data;
                      setCustomers(prev => [...prev, saved]);
                      setCustomerId(String(saved.id));
                      setAddCustModal(false);
                      toast.success(`✅ ${saved.name} added!`);
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Failed to add customer');
                    } finally { setSavingCust(false); }
                  }}>
                  {savingCust ? 'Saving...' : '✅ Save & Select'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}