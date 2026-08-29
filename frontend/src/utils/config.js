/**
 * Single source of truth for backend URLs.
 *
 * Several pages hard-coded "http://localhost:5000" for image sources, which
 * meant product images broke the moment the app ran anywhere but a developer
 * laptop. Everything now derives from REACT_APP_API_URL.
 */
const RAW_API_URL = (process.env.REACT_APP_API_URL || '').trim().replace(/\/+$/, '');

/**
 * Empty string means "same origin", which is what the production deployment
 * wants: the API is served from /api on the very host the page came from, so
 * hard-coding a URL there would only be one more thing to get out of date after
 * a domain change. A dev build with no variable set still needs the port, since
 * the React dev server and the API run separately.
 */
export const API_BASE = RAW_API_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000');

/** Absolute URL for an uploaded file path such as "/uploads/product-123.png". */
export const fileUrl = (p) => (!p ? null : /^https?:\/\//i.test(p) ? p : `${API_BASE}${p}`);

/** Authenticated URL for a PDF endpoint opened in a new tab. */
export const pdfUrl = (endpoint, params = {}) => {
  const qs = new URLSearchParams({ ...params, token: localStorage.getItem('token') || '' });
  return `${API_BASE}/api/pdf/${endpoint}?${qs.toString()}`;
};

export const CURRENCY = '৳';

/** Money for display: thousands separators, always 2 decimals. */
export const money = (n) => {
  const v = Number.parseFloat(n);
  return `${CURRENCY}${(Number.isFinite(v) ? v : 0).toLocaleString('en-BD', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/** Compact money for tight spaces (stat tiles, table cells). */
export const moneyShort = (n) => {
  const v = Number.parseFloat(n) || 0;
  if (Math.abs(v) >= 10000000) return `${CURRENCY}${(v / 10000000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100000)   return `${CURRENCY}${(v / 100000).toFixed(2)}L`;
  if (Math.abs(v) >= 1000)     return `${CURRENCY}${(v / 1000).toFixed(1)}k`;
  return `${CURRENCY}${v.toFixed(0)}`;
};

export const num = (n) => (Number.parseFloat(n) || 0).toLocaleString('en-BD');

export const dateTime = (d) =>
  new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });

export const dateOnly = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/** Today's date as YYYY-MM-DD, for date inputs. */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Turns any API/axios failure into a sentence a shop assistant can act on. */
export const errorMessage = (err, fallback = 'Something went wrong. Please try again.') => {
  if (!err) return fallback;
  if (err.response) {
    const { status, data } = err.response;
    if (data && data.message) return data.message;
    if (status === 401) return 'Your session has expired — please sign in again.';
    if (status === 403) return 'You do not have permission to do that.';
    if (status === 404) return 'That record no longer exists.';
    if (status === 429) return 'Too many requests — please wait a moment.';
    if (status >= 500) return 'The server had a problem. Please try again.';
  }
  if (err.code === 'ERR_NETWORK') return 'Cannot reach the server. Check that the backend is running.';
  return fallback;
};
