import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function CameraScannerModal({ onScan, onClose }) {
  const instanceRef = useRef(null);
  const lastScanRef = useRef('');
  const lastTimeRef = useRef(0);
  const mountedRef  = useRef(true);

  const [status,   setStatus]   = useState('Starting camera...');
  const [error,    setError]    = useState('');
  const [scanned,  setScanned]  = useState('');   // last scanned code flash
  const [camList,  setCamList]  = useState([]);   // available cameras
  const [camId,    setCamId]    = useState(null); // active camera id
  const [starting, setStarting] = useState(false);

  // ── Start scanner with a specific camera id ────────────────────────────────
  const startScanner = useCallback(async (deviceId) => {
    if (starting) return;
    setStarting(true);
    setError('');
    setStatus('Starting camera...');

    // Stop any existing instance first
    if (instanceRef.current) {
      try { await instanceRef.current.stop(); } catch (_) {}
      try { instanceRef.current.clear(); }     catch (_) {}
      instanceRef.current = null;
    }

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!mountedRef.current) return;

      const scanner = new Html5Qrcode('camera-scanner-region');
      instanceRef.current = scanner;

      const cameraConstraint = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: 'environment' };  // rear on mobile, default on laptop

      await scanner.start(
        cameraConstraint,
        { fps: 15, qrbox: { width: 260, height: 160 }, aspectRatio: 1.5 },
        (text) => {
          const now = Date.now();
          if (text === lastScanRef.current && now - lastTimeRef.current < 2000) return;
          lastScanRef.current = text;
          lastTimeRef.current = now;
          setScanned(text.trim());
          setTimeout(() => setScanned(''), 2000);
          onScan(text.trim());
        },
        () => {} // ignore per-frame errors
      );

      if (mountedRef.current) setStatus('Point camera at barcode or QR code');
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err?.message || '';
      if (msg.includes('Permission') || msg.includes('permission') || msg.includes('NotAllowed')) {
        setError('Camera permission denied. Please allow camera access in your browser settings and try again.');
      } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
        setError('No camera found on this device.');
      } else if (msg.includes('NotReadable') || msg.includes('Could not start')) {
        setError('Camera is in use by another app. Close other apps using the camera and try again.');
      } else {
        setError('Camera error: ' + (msg || 'Could not access camera.'));
      }
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [onScan, starting]);

  // ── On mount: list cameras then start ─────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const devices = await Html5Qrcode.getCameras();
        if (!mountedRef.current) return;

        if (devices && devices.length > 0) {
          setCamList(devices);
          // Prefer rear camera on mobile, last camera on laptop (usually better)
          const preferred = devices.find(d =>
            d.label.toLowerCase().includes('back') ||
            d.label.toLowerCase().includes('rear') ||
            d.label.toLowerCase().includes('environment')
          ) || devices[devices.length - 1];
          setCamId(preferred.id);
          startScanner(preferred.id);
        } else {
          setError('No camera found on this device.');
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (err?.message?.includes('Permission') || err?.message?.includes('NotAllowed')) {
          setError('Camera permission denied. Please allow camera access in your browser and try again.');
        } else {
          startScanner(null); // fallback: let browser pick
        }
      }
    };

    init();

    return () => {
      mountedRef.current = false;
      if (instanceRef.current) {
        instanceRef.current.stop().catch(() => {});
        instanceRef.current = null;
      }
    };
  }, []); // eslint-disable-line

  // ── Switch camera ──────────────────────────────────────────────────────────
  const switchCamera = async (id) => {
    setCamId(id);
    await startScanner(id);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '20px'
    }}>
      <div style={{
        background: 'var(--bg-card, #1e1e2e)',
        borderRadius: '16px', width: '100%', maxWidth: '440px',
        overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.6)'
      }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border, #333)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '15px' }}>📷 Camera Scanner</div>
            <div style={{ fontSize: '12px', color: error ? '#f87171' : '#6366f1', marginTop: '2px', fontWeight: '600' }}>
              {error ? '⚠️ Error' : status}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        {/* Camera selector (only show if multiple cameras) */}
        {camList.length > 1 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border,#333)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {camList.map((cam, i) => (
              <button
                key={cam.id}
                onClick={() => switchCamera(cam.id)}
                style={{
                  padding: '4px 12px', fontSize: '11px', fontWeight: '700', borderRadius: '6px', cursor: 'pointer', border: '1.5px solid',
                  borderColor: camId === cam.id ? '#6366f1' : 'var(--border,#444)',
                  background: camId === cam.id ? '#6366f120' : 'transparent',
                  color: camId === cam.id ? '#6366f1' : 'var(--text-secondary,#aaa)'
                }}
              >
                {cam.label || `Camera ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Camera viewport */}
        <div style={{ position: 'relative', background: '#000', minHeight: '260px' }}>

          <div id="camera-scanner-region" style={{ width: '100%' }} />

          {/* Scan overlay corners — only when no error */}
          {!error && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '260px', height: '160px', position: 'relative' }}>
                {[
                  { top: 0,    left: 0,    borderTop: '3px solid #6366f1', borderLeft: '3px solid #6366f1',   borderRadius: '4px 0 0 0' },
                  { top: 0,    right: 0,   borderTop: '3px solid #6366f1', borderRight: '3px solid #6366f1',  borderRadius: '0 4px 0 0' },
                  { bottom: 0, left: 0,    borderBottom: '3px solid #6366f1', borderLeft: '3px solid #6366f1', borderRadius: '0 0 0 4px' },
                  { bottom: 0, right: 0,   borderBottom: '3px solid #6366f1', borderRight: '3px solid #6366f1', borderRadius: '0 0 4px 0' }
                ].map((s, i) => (
                  <div key={i} style={{ position: 'absolute', width: '22px', height: '22px', ...s }} />
                ))}
                {/* Scan line */}
                <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, transparent, #6366f1, transparent)', animation: 'scanline 1.8s ease-in-out infinite', top: '50%' }} />
              </div>
            </div>
          )}

          {/* Scanned flash */}
          {scanned && (
            <div style={{ position: 'absolute', bottom: '10px', left: '10px', right: '10px', background: '#22c55e', color: '#fff', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', fontWeight: '700', textAlign: 'center', animation: 'fadeIn 0.2s ease' }}>
              ✅ Scanned: {scanned}
            </div>
          )}

          {/* Error panel */}
          {error && (
            <div style={{ padding: '30px 24px', textAlign: 'center', background: '#0d0d0d', minHeight: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
              <div style={{ fontSize: '40px' }}>📷</div>
              <div style={{ color: '#f87171', fontSize: '13px', lineHeight: '1.6', fontWeight: '600' }}>{error}</div>
              <button
                onClick={() => startScanner(camId)}
                disabled={starting}
                style={{ marginTop: '6px', padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}
              >
                {starting ? '⏳ Starting...' : '🔄 Try Again'}
              </button>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>Or use the manual barcode input above.</div>
            </div>
          )}
        </div>

        {/* Footer tips */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border,#333)', fontSize: '11px', color: 'var(--text-muted,#888)', textAlign: 'center', lineHeight: '1.6' }}>
          🔦 Good lighting helps • Hold steady 10–20 cm from barcode • Works with QR codes &amp; barcodes
        </div>
      </div>

      <style>{`
        @keyframes scanline { 0% { top: 8%; } 50% { top: 88%; } 100% { top: 8%; } }
        @keyframes fadeIn   { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        #camera-scanner-region video { border-radius: 0 !important; }
        #camera-scanner-region img   { display: none !important; }
      `}</style>
    </div>
  );
}