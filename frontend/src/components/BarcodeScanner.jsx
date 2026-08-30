import { useEffect, useRef, useCallback } from 'react';

/**
 * Hardware ("keyboard wedge") barcode scanner support.
 *
 * A USB scanner is not a scanner as far as the browser is concerned — it is a
 * keyboard that types very fast and usually presses Enter. That creates two
 * problems this hook exists to solve, and one it used to cause.
 *
 * ── What it must do ───────────────────────────────────────────────────────
 * Scans have to register even when nothing is focused. A cashier taps a
 * product tile, or a button, or just clicks the page, and the caret is no
 * longer in the scan box; the next scan must still land in the cart rather
 * than vanish.
 *
 * ── What it must NOT do ───────────────────────────────────────────────────
 * It must not treat a person typing as a scan. The previous version flushed
 * its buffer after 200ms of no keypress, whatever had focus — including the
 * scan box itself. So typing a code by hand went like this:
 *
 *     type "DEMO"  → pause to read the box → lookup fires for "DEMO",
 *                    the field is cleared → type "-1019" → lookup fires
 *                    for "-1019"
 *
 * Two failed lookups, an emptied field, and no way to enter a code by hand.
 * Verified in a browser before and after this rewrite.
 *
 * ── How it tells them apart ───────────────────────────────────────────────
 * Two rules, in order:
 *
 *  1. If the scan box has focus, this hook does nothing at all. The input and
 *     its form own that interaction — native typing, native Enter. There is
 *     no second code path to disagree with, which is also why one scan can no
 *     longer produce two lookups.
 *
 *  2. Otherwise, capture only what types like a machine. A scanner emits
 *     characters 5–30ms apart; a person managing 100wpm is still around
 *     120ms. The threshold sits at 45ms, well clear of both. A slow burst is
 *     left alone, so a stray keystroke never becomes a lookup.
 *
 * Text inputs other than the scan box are never captured, at any speed: a
 * scan while someone is typing a discount is far rarer than typing a
 * discount, and stealing those keystrokes would be the worse failure.
 */

const MAX_SCANNER_INTERVAL_MS = 45;   // above this, it is a human
const MIN_CODE_LENGTH = 3;
const IDLE_FLUSH_MS = 120;            // for scanners that send no Enter

const isTextEntry = (el) => {
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return Boolean(el.isContentEditable);
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range'].includes(type);
};

const isScanBox = (el) => Boolean(el && el.dataset && el.dataset.scanInput === 'true');

export function useUSBScanner({ onScan, enabled = true }) {
  const buffer = useRef('');
  const intervals = useRef([]);
  const lastKeyAt = useRef(0);
  const idleTimer = useRef(null);

  const reset = useCallback(() => {
    buffer.current = '';
    intervals.current = [];
    clearTimeout(idleTimer.current);
  }, []);

  /** Emit only if the burst both looks like a code and arrived at machine speed. */
  const flush = useCallback(() => {
    const code = buffer.current.trim();
    const gaps = intervals.current;
    reset();

    if (!enabled || code.length < MIN_CODE_LENGTH) return;
    if (gaps.length === 0) return;

    // Median, not mean: one long gap (the operator glancing up mid-scan)
    // should not disqualify an otherwise machine-speed burst.
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > MAX_SCANNER_INTERVAL_MS) return;

    onScan(code);
  }, [enabled, onScan, reset]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKey = (e) => {
      const target = e.target;

      // Rule 1 — the scan box owns its own keystrokes.
      if (isScanBox(target)) { reset(); return; }

      // Never steal from another text field.
      if (isTextEntry(target)) { reset(); return; }

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (e.key === 'Enter') {
        clearTimeout(idleTimer.current);
        if (buffer.current.length > 0) {
          // Stop the Enter reaching a focused button and activating it.
          e.preventDefault();
          flush();
        }
        return;
      }

      if (e.key.length !== 1) return;      // shift, arrows, F-keys…

      // A long pause means a new burst began; the old partial code is noise.
      if (gap > 500 && buffer.current.length > 0) reset();
      else if (buffer.current.length > 0) intervals.current.push(gap);

      buffer.current += e.key;

      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(flush, IDLE_FLUSH_MS);
    };

    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      clearTimeout(idleTimer.current);
    };
  }, [enabled, flush, reset]);
}

export default useUSBScanner;
