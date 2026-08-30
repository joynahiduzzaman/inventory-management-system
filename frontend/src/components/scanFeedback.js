/**
 * Perceptible confirmation that a scan registered.
 *
 * A cashier's eyes are on the customer and the goods, not the screen, so a
 * scan has to announce itself. Three channels, deliberately, because each one
 * fails on its own:
 *
 *   vibration  works with the device muted, which is how a shop tablet is
 *              usually kept — but desktops and iOS Safari have no vibrator.
 *   sound      carries across a counter, but is silent on a muted device and
 *              needs a user gesture before the browser will allow it.
 *   a flash    always works, and is the only channel a deaf cashier or a
 *              silenced tablet has.
 *
 * The flash is driven by the caller (it colours the scan field); this module
 * owns the two hardware channels and degrades quietly when they are absent.
 */

let ctx = null;

/** Lazily create the audio context — before a user gesture it is suspended. */
const audioContext = () => {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
};

/**
 * A short tone. Two notes distinguish the outcomes without anyone having to
 * read: a bright blip for a hit, a lower double for a miss.
 */
const tone = (freqs, duration = 0.07) => {
  const ac = audioContext();
  if (!ac) return;
  // Autoplay policy: the context starts suspended until the page has been
  // interacted with. Resuming is a no-op once it is already running.
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  if (ac.state !== 'running') return;

  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = f;
    // A tiny envelope: a bare square wave clicks on both ends.
    const start = ac.currentTime + i * (duration + 0.03);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.06, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  });
};

const buzz = (pattern) => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* not permitted; ignore */ }
  }
};

/** A product was found and added. */
export const scanOk = () => { buzz(35); tone([1180]); };

/** Nothing matched, or the item cannot be sold. Longer, lower, doubled — a
 *  failure should not feel like a success with a different colour. */
export const scanFail = () => { buzz([50, 60, 50]); tone([420, 300], 0.1); };

const scanFeedback = { scanOk, scanFail };
export default scanFeedback;
