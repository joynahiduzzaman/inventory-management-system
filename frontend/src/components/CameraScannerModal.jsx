import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useT } from '../i18n';
import Icon from './Icon';
import { Button, IconButton } from './ui';

/**
 * Camera barcode / QR scanner.
 *
 * Notes on the things that actually break in a shop:
 *
 *  - getUserMedia needs a secure context. On plain http (anything but
 *    localhost) it fails with a browser message that never mentions HTTPS, so
 *    that case is detected up front and named.
 *
 *  - The scan window used to be a fixed 260×160 box. On a narrow phone that is
 *    wider than the video feed, and html5-qrcode then either throws or scans a
 *    region that is partly off-frame. It is now derived from the actual video
 *    dimensions, which is what the library's function form is for.
 *
 *  - Errors were matched on `err.message` substrings, which differ per browser
 *    and per locale. `err.name` is the standardised field and is checked first.
 *
 *  - The formats are pinned to what a shop actually scans. The default is
 *    every format the library knows, and each one costs decode time per frame;
 *    narrowing to retail 1D plus QR makes it noticeably quicker to lock on.
 *
 *  - Torch, where the device exposes it. A shop aisle is often darker than the
 *    counter, and this is the difference between scanning and retyping.
 */
export default function CameraScannerModal({ onScan, onClose }) {
  const { t } = useT();
  const instanceRef = useRef(null);
  const lastScanRef = useRef('');
  const lastTimeRef = useRef(0);
  const mountedRef  = useRef(true);
  const startingRef = useRef(false);

  const [status,   setStatus]   = useState('');
  const [error,    setError]    = useState('');
  const [scanned,  setScanned]  = useState('');
  const [camList,  setCamList]  = useState([]);
  const [camId,    setCamId]    = useState(null);
  const [starting, setStarting] = useState(false);
  const [torchOn,  setTorchOn]  = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  /** Map a DOMException to something a shopkeeper can act on. */
  const describeError = useCallback((err) => {
    const name = err && err.name;
    const msg = (err && err.message) || '';
    if (name === 'NotAllowedError' || /permission|NotAllowed/i.test(msg)) return t('scan.errPermission');
    if (name === 'NotFoundError' || /NotFound|device not found/i.test(msg)) return t('scan.errNoCamera');
    if (name === 'NotReadableError' || /NotReadable|Could not start/i.test(msg)) return t('scan.errInUse');
    if (name === 'OverconstrainedError') return t('scan.errNoCamera');
    return t('scan.errGeneric');
  }, [t]);

  const startScanner = useCallback(async (deviceId) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError('');
    setStatus(t('scan.starting'));
    setHasTorch(false);
    setTorchOn(false);

    if (instanceRef.current) {
      try { await instanceRef.current.stop(); } catch { /* already stopped */ }
      try { instanceRef.current.clear(); } catch { /* nothing rendered */ }
      instanceRef.current = null;
    }

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!mountedRef.current) return;

      const formats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
      ];

      const scanner = new Html5Qrcode('camera-scanner-region', { formatsToSupport: formats, verbose: false });
      instanceRef.current = scanner;

      const cameraConstraint = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' };

      await scanner.start(
        cameraConstraint,
        {
          fps: 15,
          // Derived from the real video size rather than a fixed box, so the
          // scan window is never wider than the frame on a narrow phone.
          qrbox: (vw, vh) => {
            const side = Math.floor(Math.min(vw, vh) * 0.75);
            return { width: side, height: Math.floor(side * 0.62) };
          },
          aspectRatio: 1.5,
        },
        (text) => {
          const now = Date.now();
          // The camera decodes the same symbol on every frame while it is in
          // view, so without this one presentation would add a dozen items.
          // Two seconds is long enough to move the next item into frame.
          if (text === lastScanRef.current && now - lastTimeRef.current < 2000) return;
          lastScanRef.current = text;
          lastTimeRef.current = now;
          setScanned(text.trim());
          setTimeout(() => { if (mountedRef.current) setScanned(''); }, 1800);
          onScan(text.trim());
        },
        () => {}   // per-frame decode misses are normal; not errors
      );

      if (!mountedRef.current) return;
      setStatus(t('scan.pointAtCode'));

      // Torch is only offered where the running track actually reports it.
      try {
        const caps = scanner.getRunningTrackCapabilities();
        setHasTorch(Boolean(caps && caps.torch));
      } catch { setHasTorch(false); }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeError(err));
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setStarting(false);
    }
  }, [onScan, t, describeError]);

  const toggleTorch = useCallback(async () => {
    const scanner = instanceRef.current;
    if (!scanner) return;
    const next = !torchOn;
    try {
      await scanner.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Some devices advertise torch and then refuse it; stop offering it
      // rather than leaving a button that does nothing.
      setHasTorch(false);
    }
  }, [torchOn]);

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      // Named explicitly: the browser's own error for this never says "HTTPS".
      if (!window.isSecureContext) {
        setError(t('scan.errInsecure'));
        return;
      }
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const devices = await Html5Qrcode.getCameras();
        if (!mountedRef.current) return;

        if (devices && devices.length > 0) {
          setCamList(devices);
          const preferred = devices.find(d => /back|rear|environment/i.test(d.label || ''))
            || devices[devices.length - 1];
          setCamId(preferred.id);
          startScanner(preferred.id);
        } else {
          setError(t('scan.errNoCamera'));
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (err && err.name === 'NotAllowedError') setError(describeError(err));
        else startScanner(null);          // let the browser choose
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes, like every other modal in the app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label={t('pos.cameraScan')}>
      <div className="scan-modal">
        <div className="scan-head">
          <div>
            <div className="scan-title">{t('pos.cameraScan')}</div>
            <div className={`scan-status${error ? ' is-error' : ''}`}>{error ? t('error.generic') : status}</div>
          </div>
          <div className="ui-actions">
            {hasTorch && (
              <IconButton
                icon={<Icon name="warning" />}
                label={t('scan.torch')}
                variant={torchOn ? 'danger' : 'outline'}
                aria-pressed={torchOn}
                onClick={toggleTorch}
              />
            )}
            <IconButton icon={<Icon name="close" />} label={t('common.close')} variant="outline" onClick={onClose} />
          </div>
        </div>

        {camList.length > 1 && (
          <div className="scan-cams">
            {camList.map((cam, i) => (
              <button
                key={cam.id}
                type="button"
                className={`scan-cam${camId === cam.id ? ' is-active' : ''}`}
                onClick={() => { setCamId(cam.id); startScanner(cam.id); }}
              >
                {cam.label || `${t('pos.cameraScan')} ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        <div className="scan-viewport">
          <div id="camera-scanner-region" />

          {!error && (
            <div className="scan-reticle" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
          )}

          {scanned && <div className="scan-hit">{scanned}</div>}

          {error && (
            <div className="scan-error">
              <Icon name="camera" size={34} />
              <p>{error}</p>
              <Button variant="primary" onClick={() => startScanner(camId)} loading={starting}>
                {t('common.retry')}
              </Button>
              <span className="cell-sub">{t('scan.orTypeIt')}</span>
            </div>
          )}
        </div>

        <div className="scan-tips">{t('scan.tips')}</div>
      </div>
    </div>
  );
}
