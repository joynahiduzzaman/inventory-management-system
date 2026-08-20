import { useEffect, useRef, useCallback } from 'react';

export function useUSBScanner({ onScan, enabled = true }) {
  const bufferRef   = useRef('');
  const lastKeyTime = useRef(0);
  const timerRef    = useRef(null);

  const flush = useCallback(() => {
    const code = bufferRef.current.trim();
    bufferRef.current = '';
    if (code.length >= 2 && enabled) onScan(code);
  }, [onScan, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const handleKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const isScanInput = e.target?.dataset?.scanInput === 'true';
      if ((tag === 'input' || tag === 'textarea') && !isScanInput) return;

      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (e.key === 'Enter') {
        clearTimeout(timerRef.current);
        flush();
        return;
      }

      if (gap > 300 && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      if (e.key.length === 1) bufferRef.current += e.key;

      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (bufferRef.current.length >= 2) flush();
        else bufferRef.current = '';
      }, 200);
    };

    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      clearTimeout(timerRef.current);
    };
  }, [enabled, flush]);
}

export default useUSBScanner;