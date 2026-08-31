import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useUSBScanner } from '../components/BarcodeScanner';
import CameraScannerModal from '../components/CameraScannerModal';
import { errorMessage } from '../utils/config';
import { useT } from '../i18n';
import Icon from '../components/Icon';
import { Button, IconButton, ProductAvatar, EmptyState, useConfirm } from '../components/ui';
import { scanOk, scanFail } from '../components/scanFeedback';
import { printReceipt, saveReceiptWidth } from '../utils/receipt';
import { useAuth } from '../context/AuthContext';

export default function POS({ darkMode, toggleDark }) {
  const { t, money, num, lang } = useT();
  const { user } = useAuth();
  const { ask: askConfirm, dialog: confirmDialog } = useConfirm();
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
  const [noteOpen, setNoteOpen]         = useState(false);
  const [loading, setLoading]           = useState(true);
  const [processing, setProcessing]     = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [cameraOpen, setCameraOpen]     = useState(false);
  const [scanInput, setScanInput]       = useState('');
  const [scanning, setScanning]         = useState(false);
  const [scanStatus, setScanStatus]     = useState({ msg: '', type: '' });
  const scanInputRef = useRef(null);
  const scanDebounce = useRef(null);
  const statusTimer  = useRef(null);

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
    } catch { toast.error(t('error.loadFailed', { thing: t('pos.title') })); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Add product to cart ─────────────────────────────────────────────────────
  const addToCart = useCallback((product) => {
    if (product.stock === 0) {
      setScanStatus({ msg: t('pos.scanOutOfStock', { name: product.name }), type: 'error' });
      scanFail();
      return;
    }
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          setScanStatus({ msg: t('pos.stockLeft', { count: num(product.stock) }), type: 'error' });
          scanFail();
          return prev;
        }
        setScanStatus({ msg: t('pos.scanFound', { name: product.name }), type: 'success' });
        scanOk();
        return prev.map(i => i.productId === product.id
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
          : i
        );
      }
      setScanStatus({ msg: t('pos.scanFound', { name: product.name }), type: 'success' });
      scanOk();
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
  }, [t, num]);

  // ─── Core scan handler ────────────────────────────────────────────────────────
  const handleScan = useCallback(async (code) => {
    if (!code || code.length < 1) return;
    clearTimeout(scanDebounce.current);
    scanDebounce.current = setTimeout(async () => {
      setScanning(true);
      setScanStatus({ msg: code, type: 'info' });
      try {
        const res = await api.get(`/products/scan/${encodeURIComponent(code)}`);
        addToCart(res.data.data);
      } catch (err) {
        const msg = err.response?.data?.message || t('pos.scanNotFound', { code });
        setScanStatus({ msg, type: 'error' });
        scanFail();
        toast.error(msg, { duration: 2500 });
      } finally {
        setScanning(false);
        setScanInput('');
        // A success clears quickly: the item visibly appears in the cart, so
        // the banner is only the second confirmation. A failure has no other
        // signal at all, so it stays up long enough to be noticed and acted
        // on by someone whose eyes were on the customer.
        setScanStatus((cur) => {
          const linger = cur.type === 'error' ? 7000 : 2500;
          clearTimeout(statusTimer.current);
          statusTimer.current = setTimeout(() => setScanStatus({ msg: '', type: '' }), linger);
          return cur;
        });
      }
    }, 80);
  }, [addToCart, t]);

  // ─── Scanner focus ───────────────────────────────────────────────────
  // A scanner gun is a keyboard: it types into whatever has focus. Without
  // this the cashier had to click the field before the first scan of every
  // sale, and again after each one, which is the single most repeated
  // interaction on this screen.
  useEffect(() => () => clearTimeout(statusTimer.current), []);

  // When the invoice closes the next sale has begun, so the caret goes back
  // to the scanner. Focus on arrival only covers the first sale of the day.
  const hadInvoice = useRef(false);
  useEffect(() => {
    if (invoiceModal) { hadInvoice.current = true; return; }
    if (!hadInvoice.current) return;
    hadInvoice.current = false;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const id = setTimeout(() => focusScannerRef.current?.(), 60);
    return () => clearTimeout(id);
  }, [invoiceModal]);

  // Keep the cart inside the viewport.
  //
  // `calc(100vh - 170px)` used to stand in for "the height of everything above
  // the till", but that toolbar wraps to two rows at 1024px and the guess was
  // 74px short — which put the Complete Sale button below the fold on exactly
  // the screen where it must never be. Measuring removes the guess.
  const cartRef = useRef(null);
  useEffect(() => {
    const fit = () => {
      const el = cartRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY
                - (document.querySelector('.page-content')?.getBoundingClientRect().top + window.scrollY || 0);
      const available = window.innerHeight - el.getBoundingClientRect().top - 16;
      el.style.setProperty('--pos-cart-max', `${Math.max(320, Math.round(available))}px`);
      void top;
    };
    fit();
    window.addEventListener('resize', fit);
    const id = setInterval(fit, 1000);   // toolbar can rewrap as data loads
    return () => { window.removeEventListener('resize', fit); clearInterval(id); };
  }, [loading]);

  /** Print the finished invoice at the chosen paper width. */
  const doPrint = useCallback((width) => {
    if (!invoiceModal) return;
    saveReceiptWidth(width);
    const ok = printReceipt(invoiceModal, {
      width, t, money, lang,
      tendered: invoiceModal._tendered,
      cashier: user ? user.name : '',
    });
    if (!ok) toast.error(t('error.allowPopups'));
  }, [invoiceModal, t, money, lang, user]);

  const focusScannerRef = useRef(null);
  const focusScanner = useCallback(() => {
    const el = scanInputRef.current;
    if (!el) return;
    // Never disturb a scan already in flight. Both callers defer this by 60ms
    // (once when the invoice closes, again when the post-sale refetch flips
    // `loading`), and a scanner gun fires a whole code in about that time. A
    // deferred select() landing mid-burst selects the characters typed so far
    // and lets the next one overwrite them: scanning DEMO-1019 immediately
    // after tapping New Sale looked up MO-1019 and reported "not found".
    // Already focused with something in it means a code is being entered, by
    // gun or by hand, and the caret is not ours to move.
    if (document.activeElement === el && el.value) return;
    el.focus();
    el.select();
  }, []);
  focusScannerRef.current = focusScanner;

  // On arrival — but not on a phone, where focusing an input pops the on-screen
  // keyboard over the product grid before anyone has asked to type.
  useEffect(() => {
    if (loading) return undefined;
    if (window.matchMedia('(pointer: coarse)').matches) return undefined;
    const id = setTimeout(focusScanner, 60);
    return () => clearTimeout(id);
  }, [loading, focusScanner]);

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
    if (qty > item.stock) return toast.error(t('pos.stockLeft', { count: num(item.stock) }));
    setCart(cart.map(i => i.productId === productId
      ? { ...i, quantity: qty, total: qty * i.price } : i
    ));
  };
  const removeItem = (productId) => setCart(cart.filter(i => i.productId !== productId));
  const clearCart  = () => {
    if (cart.length === 0) return;
    askConfirm({
      title: t('pos.clearCart'),
      message: t('pos.itemsInCart', { count: num(cart.length) }),
      confirmLabel: t('pos.clearCart'),
      tone: 'danger',
      onConfirm: () => {
        setCart([]); setDiscount(0); setPaid(''); setNote(''); setNoteOpen(false); setCustomerId('');
        focusScanner();
      },
    });
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
    if (!cart.length) return toast.error(t('error.cartEmpty'));
    if (discountTooBig) return toast.error(t('pos.discountTooBig'));
    if (needsCustomerForDue) {
      return toast.error(t('pos.dueNeedsCustomer', { amount: money(dueAmt) }));
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
      // `_tendered` is display-only and never sent anywhere: the server caps
      // `paid` at the invoice total, so the record cannot say what was handed
      // over, and without this the receipt could never show change.
      setInvoiceModal({ ...res.data.data, _tendered: paidAmt });
      setCart([]); setDiscount(0); setPaid(''); setNote(''); setNoteOpen(false); setCustomerId('');
      fetchData();
      toast.success(t('pos.saleComplete'));
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

  // What cannot be sold goes last. It still has to be visible — a cashier
  // needs to be able to tell a customer "we are out" — but it should never sit
  // between two things that can be sold.
  const ordered = [...filtered].sort((a, b) => {
    const aOut = a.stock <= 0 ? 1 : 0;
    const bOut = b.stock <= 0 ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return 0;
  });

  const isInCart   = (id) => cart.some(i => i.productId === id);
  const getCartQty = (id) => cart.find(i => i.productId === id)?.quantity || 0;
  const payMethods = [
    { id: 'cash',  label: t('pos.payment.cash') },
    { id: 'bkash', label: t('pos.payment.bkash') },
    { id: 'nagad', label: t('pos.payment.nagad') },
    { id: 'card',  label: t('pos.payment.card') },
  ];

  return (
    <Layout
      rail
      title={t('pos.title')}
      subtitle={t('pos.itemsInCart', { count: num(cart.length) })}
      darkMode={darkMode} toggleDark={toggleDark}
    >
      {/* ── SCANNER BAR ─────────────────────────────────────────────────────── */}
      {/* ── MAIN LAYOUT ─────────────────────────────────────────────────────── */}
      <div className="pos-layout">

        {/* LEFT — Products Grid */}
        <div className="pos-products">
        <div className="card pos-scanbar">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <form onSubmit={handleManualScan} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px' }}>
              <input
                ref={scanInputRef}
                data-scan-input="true"
                className="form-control"
                placeholder={t('pos.scanPlaceholder')}
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                disabled={scanning}
                style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px', height: '34px', letterSpacing: '0.5px' }}
              />
              <button
                type="submit"
                disabled={!scanInput.trim() || scanning}
                className="ui-btn ui-btn--primary ui-btn--sm"
              >
                <Icon name="search" size={15} />
                {t('common.search')}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="ui-btn ui-btn--secondary ui-btn--sm"
            >
              <Icon name="camera" size={15} />
              {t('pos.cameraScan')}
            </button>
            <div className="pos-scanner-ready">
              <span className="pos-scanner-dot" aria-hidden="true" />
              <span>{t('pos.scannerReady')}</span>
            </div>
            <div className="no-print pos-shortcuts">
              <span><kbd>F2</kbd> {t('pos.shortcutScan')}</span>
              <span><kbd>F3</kbd> {t('pos.shortcutPayment')}</span>
              <span><kbd>F4</kbd> {t('pos.shortcutComplete')}</span>
              <span><kbd>Esc</kbd> {t('pos.shortcutClear')}</span>
            </div>
          </div>
          {/* The slot is always in the DOM and always the same height, so a scan
              result appearing cannot shove the product grid down mid-tap. Only
              its contents change. aria-live so the outcome is announced too —
              the point is that nobody has to be watching this line. */}
          <div className="pos-scan-slot" role="status" aria-live="polite">
          {scanStatus.msg && (
            <div className={`pos-scan-status is-${scanStatus.type || 'info'}`}>
              <Icon name={scanStatus.type === 'error' ? 'warning'
                        : scanStatus.type === 'success' ? 'check' : 'search'} size={15} />
              <span>{scanStatus.msg}</span>
            </div>
          )}
          </div>
        </div>
          <div className="card" style={{ padding: '8px 12px', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
                <input className="form-control" style={{ paddingLeft: '32px' }} placeholder={t('pos.searchProducts')} value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="form-control" style={{ width: '150px' }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">{t('pos.allCategories')}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className="cell-sub" style={{ alignSelf: 'center' }}>{t('pos.productCount', { count: num(filtered.length) })}</span>
            </div>
          </div>

          <div className="pos-product-scroll">
            {loading ? (
              <div className="loading-page"><div className="spinner" /></div>
            ) : filtered.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📦</div><div className="empty-text">No products found</div></div>
            ) : (
              <div className="pos-grid">
                {ordered.map(p => {
                  const inCart = isInCart(p.id);
                  const qty    = getCartQty(p.id);
                  const oos    = p.stock === 0;
                  return (
                    // A real button, not a div with onClick: the whole tile is
                    // the target (far past 44px), and it is reachable by
                    // keyboard and announced properly.
                    <button
                      key={p.id}
                      type="button"
                      className={`pos-tile${inCart ? ' is-in-cart' : ''}${oos ? ' is-out' : ''}`}
                      disabled={oos}
                      onClick={() => addToCart(p)}
                      aria-label={`${p.name} — ${money(p.price)}`}
                    >
                      {inCart && <span className="pos-tile-qty" aria-hidden="true">{num(qty)}</span>}
                      {/* A photograph earns its space; a generated monogram does
                          not — it repeated the first letters of the name printed
                          directly beneath it, for 40px of every tile. Products
                          with a real picture keep a small one. */}
                      {p.image && <ProductAvatar product={p} size={28} className="pos-tile-img" />}
                      <span className="pos-tile-name" title={p.name}>{p.name}</span>
                      <span className="pos-tile-foot">
                        <span className="pos-tile-price">{money(p.price)}</span>
                        <span className={`pos-tile-stock${oos ? ' is-out' : p.stock <= p.lowStockAlert ? ' is-low' : ''}`}>
                          {oos ? t('status.outOfStock') : num(p.stock)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Cart */}
        <div className="pos-cart" id="pos-cart-panel" ref={cartRef}>
          <div className="card pos-cart-card">

            {/* Cart header */}
            <div className="pos-cart-head">
              <div style={{ fontWeight: '700', fontSize: '15px' }}>
                {t('pos.cart')}
                {cart.length > 0 && <span className="pos-cart-count">{t('sales.itemCount', { count: num(cart.reduce((s, i) => s + i.quantity, 0)) })}</span>}
              </div>
              {cart.length > 0 && (
                <Button id="pos-clear" size="sm" variant="ghost"
                        title={`${t('pos.clearCart')} (Esc)`} onClick={clearCart}>
                  {t('common.clear')}
                </Button>
              )}
            </div>

            {/* ── CUSTOMER ROW — Walk-in dropdown + New button inline ── */}
            <div className="pos-cart-cust">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="form-control"
                  style={{ flex: 1, fontSize: '13px' }}
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                >
                  <option value="">{t('pos.walkInCustomer')}</option>
                  {customers.map(cu => (
                    <option key={cu.id} value={cu.id}>
                      {cu.name}{cu.phone ? ` — ${cu.phone}` : ''}
                      {cu.dueAmount > 0 ? ` ⚠️ Due: ৳${cu.dueAmount}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => { setNewCust({ name: '', phone: '', email: '', address: '' }); setAddCustModal(true); }}
                  className="ui-btn ui-btn--primary ui-btn--sm"
                  title="Add new customer"
                >
                  {t('pos.newCustomer')}
                </button>
              </div>
            </div>

            {/* Cart items */}
            <div className="pos-cart-items">
              {cart.length === 0 ? (
                <EmptyState
                  icon={<Icon name="cart" size={36} />}
                  title={t('pos.cartEmpty')}
                  message={t('pos.cartEmptyHint')}
                />
              ) : cart.map((item, idx) => (
                // One line per item: name, unit price, stepper, line total,
                // remove. It used to take three, which is why a four-item cart
                // already needed scrolling.
                <div key={item.productId} data-cart-row className="pos-line">
                  <span className="pos-line-name"
                        title={`${item.name} — ${t('pos.eachPrice', { amount: money(item.price) })}`}>
                    {item.name}
                  </span>
                  <span className="pos-line-unit">{money(item.price)}</span>
                  <div className="pos-line-qty">
                    {/* At quantity 1 this button and the remove button do the
                        same thing, so only one of them is shown. That returns
                        44px to the product name on a narrow cart and lets the
                        remove control keep a full 44x44 target. */}
                    {item.quantity > 1 && (
                      <IconButton size="sm" variant="outline" icon={<Icon name="minus" size={15} />}
                                  label={t('pos.decreaseQty')}
                                  onClick={() => updateQty(item.productId, item.quantity - 1)} />
                    )}
                    <input type="number" value={item.quantity} min="1" max={item.stock}
                           aria-label={item.name}
                           onChange={e => updateQty(item.productId, parseInt(e.target.value) || 1)}
                           className="pos-qty-input" />
                    <IconButton size="sm" variant="outline" icon={<Icon name="plus" size={15} />}
                                label={t('pos.increaseQty')}
                                onClick={() => updateQty(item.productId, item.quantity + 1)} />
                  </div>
                  <span className="pos-line-total">{money(item.total)}</span>
                  <IconButton size="sm" variant="ghost" icon={<Icon name="close" size={14} />}
                              label={t('common.delete')} className="pos-line-remove"
                              onClick={() => removeItem(item.productId)} />
                </div>
              ))}
            </div>

            {/* Checkout panel */}
            <div className="pos-cart-foot">
              {/* Subtotal and discount on one line: two stacked rows cost
                  ~30px of list height on every sale to say one thing each. */}
              <div className="pos-sub-row">
                <span className="pos-sub-label">{t('pos.subtotal')}</span>
                <span className="pos-sub-value">{money(subtotal)}</span>
                <label className="pos-sub-label" htmlFor="pos-discount">{t('pos.discount')}</label>
                <input id="pos-discount" type="number" min="0" max={subtotal} value={discount}
                       onChange={e => setDiscount(e.target.value)} className="pos-discount-input" />
              </div>
              <div className="pos-total-bar">
                <span>{t('pos.grandTotal')}</span>
                <span className="pos-total-amount">{money(total)}</span>
              </div>
              <div className="pos-pay" role="group" aria-label={t('receipt.paymentMethod')}>
                {payMethods.map(m => (
                  <button key={m.id} type="button"
                          className={`pos-pay-opt${paymentMethod === m.id ? ' is-active' : ''}`}
                          aria-pressed={paymentMethod === m.id}
                          onClick={() => setPayMethod(m.id)}>{m.label}</button>
                ))}
              </div>
              <input id="pos-paid" type="number" min="0" step="0.01"
                     placeholder={t('pos.amountReceived')}
                     aria-label={t('pos.amountReceived')}
                     value={paid} onChange={e => setPaid(e.target.value)}
                     className="form-control pos-paid-input" />
              {discountTooBig && (
                <div className="pos-notice is-danger">{t('pos.discountTooBig')}</div>
              )}
              {needsCustomerForDue && (
                <div className="pos-notice is-warn">{t('pos.dueNeedsCustomer', { amount: money(dueAmt) })}</div>
              )}
              {paid && paidAmt > 0 && (
                <div className={`pos-notice is-split ${change >= 0 ? 'is-ok' : 'is-danger'}`}>
                  <span>{change >= 0 ? t('pos.change') : t('pos.dueAmount')}</span>
                  <span className="b">{money(Math.abs(change))}</span>
                </div>
              )}
              {/* Collapsed by default: a note is written on a small minority of
                  sales and was costing every sale a row of height. */}
              {noteOpen ? (
                <input className="form-control pos-note" autoFocus placeholder={t('common.note')}
                       value={note} onChange={e => setNote(e.target.value)} />
              ) : (
                <button type="button" className="pos-note-toggle" onClick={() => setNoteOpen(true)}>
                  + {t('common.note')}
                </button>
              )}
              <Button
                id="pos-checkout"
                variant="primary"
                size="lg"
                block
                title={`${t('pos.completeSale')} (F4)`}
                onClick={handleCheckout}
                loading={processing}
                disabled={cart.length === 0 || discountTooBig || needsCustomerForDue}
              >
                {cart.length === 0
                  ? t('pos.addProductsFirst')
                  : t('pos.completeSaleAmount', { amount: money(total) })}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE CART BAR ──────────────────────────────────────────────────
          On a phone the cart sits below a long product list, so the running
          total is off-screen exactly while you are adding to it. This pins the
          count and total to the bottom and jumps to the cart on tap. Hidden on
          desktop, where the cart is already beside the products. */}
      {cart.length > 0 && (
        <button
          className="pos-mobile-cart-bar"
          onClick={() => document.getElementById('pos-cart-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <span>🛒 {cart.reduce((n, i) => n + i.quantity, 0)} item{cart.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'}</span>
          <span>{money(total)} — review &amp; pay →</span>
        </button>
      )}

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
                <div className="pos-invoice-head">
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
                    [t('receipt.customer'), invoiceModal.customer?.name || t('pos.walkInCustomer')],
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
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>{money(item.price)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#6366f1' }}>{money(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '16px 20px', margin: '0 20px 20px', background: '#f8fafc', borderRadius: '10px' }}>
                  {parseFloat(invoiceModal.discount) > 0 && (<>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                      <span style={{ color: '#64748b' }}>Subtotal</span>
                      <span style={{ fontWeight: '600' }}>{money(parseFloat(invoiceModal.total) + parseFloat(invoiceModal.discount))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                      <span style={{ color: '#dc2626' }}>Discount</span>
                      <span style={{ fontWeight: '600', color: '#dc2626' }}>-{money(invoiceModal.discount)}</span>
                    </div>
                  </>)}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #e2e8f0', marginTop: '4px' }}>
                    <span style={{ fontWeight: '800', fontSize: '15px' }}>TOTAL</span>
                    <span style={{ fontWeight: '900', fontSize: '18px', color: '#6366f1' }}>{money(invoiceModal.total)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '6px' }}>
                    <span style={{ color: '#64748b' }}>Amount Paid</span>
                    <span style={{ fontWeight: '700', color: '#22c55e' }}>{money(invoiceModal.paid)}</span>
                  </div>
                  {parseFloat(invoiceModal.due) > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', padding: '8px 12px', background: '#fee2e2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                      <span style={{ fontSize: '13px', color: '#dc2626', fontWeight: '700' }}>⚠️ Amount Due</span>
                      <span style={{ fontWeight: '800', color: '#dc2626', fontSize: '14px' }}>{money(invoiceModal.due)}</span>
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
              {/* Two widths, because a shop runs one or the other and the
                  layouts genuinely differ — see utils/receipt.js. The choice
                  is remembered, so it is a one-time decision. */}
              <Button variant="secondary" icon={<Icon name="print" />}
                      onClick={() => doPrint(58)}>58mm</Button>
              <Button variant="primary" icon={<Icon name="print" />}
                      onClick={() => doPrint(80)}>80mm</Button>
              <Button variant="primary" onClick={() => setInvoiceModal(null)}>{t('pos.title')}</Button>
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
      {confirmDialog}
    </Layout>
  );
}