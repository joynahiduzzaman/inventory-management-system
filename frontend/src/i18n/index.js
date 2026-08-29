/**
 * Translation layer.
 *
 * Design notes, because the obvious shortcuts are wrong here:
 *
 *  - Strings live in en.js / bn.js keyed by name, NOT as inline ternaries at
 *    call sites. A ternary per label makes it impossible to see what still
 *    needs translating, and guarantees the two languages drift.
 *
 *  - Numbers, money, SKUs and barcode values stay in LATIN digits in both
 *    languages. Bengali numerals (০১২৩) are correct Bangla, but a cashier
 *    reading a total off a screen and counting notes is slower in a numeral
 *    system they do not use for money day to day, and every barcode and SKU
 *    printed on a box is Latin anyway. Mixing the two would be worse than
 *    either. Only month names are translated in dates.
 *
 *  - The language is remembered PER USER, so a shared till can have an owner
 *    who reads English and staff who read Bangla without fighting over one
 *    setting.
 *
 *  - Default is Bangla. Most people using this are more comfortable in it, and
 *    anyone who wants English can find a two-item toggle.
 */
import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import en from './en';
import bn from './bn';
import { CURRENCY } from '../utils/config';

const DICTS = { en, bn };
export const LANGUAGES = [
  { code: 'bn', label: 'বাংলা', aria: 'বাংলা' },
  { code: 'en', label: 'EN', aria: 'English' },
];

const STORE_PREFIX = 'domingo.lang';
const DEFAULT_LANG = 'bn';

const storageKey = (userId) => (userId ? `${STORE_PREFIX}.${userId}` : STORE_PREFIX);

const readStored = (userId) => {
  try {
    // A user-specific choice wins; the shared key is the fallback so a fresh
    // login on a till already set to Bangla does not snap back to English.
    return localStorage.getItem(storageKey(userId)) || localStorage.getItem(STORE_PREFIX) || DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;             // private mode, storage disabled
  }
};

/** Bengali month names, used with Latin day/year digits. */
const BN_MONTHS = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
                   'জুলাই', 'আগস্ট', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে'];

const I18nContext = createContext(null);

export const I18nProvider = ({ children, userId = null }) => {
  const [lang, setLangState] = useState(() => readStored(userId));

  // Re-key when the signed-in user changes, so switching accounts on one
  // machine picks up that person's preference rather than the last one used.
  useEffect(() => { setLangState(readStored(userId)); }, [userId]);

  // The <html lang> attribute drives the Bengali line-height rule in
  // tokens.css, and tells screen readers which language to pronounce.
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((next) => {
    if (!DICTS[next]) return;
    setLangState(next);
    try {
      localStorage.setItem(storageKey(userId), next);
      localStorage.setItem(STORE_PREFIX, next);   // shared default for the till
    } catch { /* storage unavailable; the choice still applies this session */ }
  }, [userId]);

  const value = useMemo(() => {
    const dict = DICTS[lang] || DICTS[DEFAULT_LANG];

    /**
     * Look up a key and fill in {placeholders}.
     * Falls back to English, then to the key itself — a missing string shows
     * as something searchable rather than blanking the button it labels.
     */
    const t = (key, vars) => {
      let s = dict[key];
      if (s === undefined) s = en[key];
      if (s === undefined) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[i18n] missing key: ${key}`);
        }
        return key;
      }
      if (!vars) return s;
      return s.replace(/\{(\w+)\}/g, (m, name) =>
        (vars[name] === undefined || vars[name] === null ? m : String(vars[name])));
    };

    /** Latin digits in both languages — see the note at the top of this file. */
    const money = (n) => {
      const v = Number.parseFloat(n);
      return `${CURRENCY}${(Number.isFinite(v) ? v : 0).toLocaleString('en-BD', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      })}`;
    };
    const num = (n) => (Number.parseFloat(n) || 0).toLocaleString('en-BD');

    const parts = (d) => {
      const date = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(date.getTime())) return null;
      return { date, day: String(date.getDate()).padStart(2, '0'), year: date.getFullYear() };
    };

    const dateOnly = (d) => {
      const p = parts(d);
      if (!p) return '—';
      if (lang !== 'bn') {
        return p.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
      return `${p.day} ${BN_MONTHS[p.date.getMonth()]} ${p.year}`;
    };

    const dateTime = (d) => {
      const p = parts(d);
      if (!p) return '—';
      const time = p.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (lang !== 'bn') {
        return `${p.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${time}`;
      }
      return `${p.day} ${BN_MONTHS[p.date.getMonth()]} ${p.year}, ${time}`;
    };

    /**
     * Turns any API failure into a sentence in the reader's language.
     * A server-supplied message is shown as-is: it is more specific than
     * anything generic here ("Not enough stock for X — 5 available"), and the
     * backend is the only thing that knows it.
     */
    const errorMessage = (err, fallbackKey = 'error.generic') => {
      if (!err) return t(fallbackKey);
      if (err.response) {
        const { status, data } = err.response;
        if (data && data.message) return data.message;
        if (status === 401) return t('auth.sessionExpired');
        if (status === 403) return t('error.permission');
        if (status === 404) return t('error.notFound');
        if (status === 429) return t('error.tooMany');
        if (status >= 500) return t('error.server');
      }
      if (err.code === 'ECONNABORTED') return t('error.timeout');
      if (err.code === 'ERR_NETWORK') return t('error.network');
      return t(fallbackKey);
    };

    return { t, lang, setLang, isBangla: lang === 'bn', money, num, dateOnly, dateTime, errorMessage };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/**
 * Primary hook. Named useT because `const { t } = useT()` is what almost every
 * call site wants.
 */
export const useT = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx;
};

export default I18nProvider;
