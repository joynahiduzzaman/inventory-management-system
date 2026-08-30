import React from 'react';

/**
 * Line icons.
 *
 * The row actions were emoji, which fails three ways at a counter:
 *
 *  1. They render inconsistently. ⚖ and ✏ have no emoji presentation on most
 *     systems and come out as thin monochrome text, while 🧾 and 🗑 come out as
 *     full-colour pictures — so one row of five "icons" was two different
 *     visual languages side by side.
 *  2. They cannot take a colour. A destructive action could not be tinted red
 *     to look destructive, because an emoji ignores `color`.
 *  3. They are drawn differently on every platform, so the thing a shopkeeper
 *     learns to recognise on the shop tablet is not what they see on a phone.
 *
 * These are 24×24 stroke icons on a single grid, they inherit `currentColor`,
 * and they are inline SVG — no icon font, no extra network request, nothing to
 * fail on a bad connection.
 *
 * Decorative by default (`aria-hidden`), because the accessible name belongs to
 * the button that wraps them — IconButton already requires one.
 */
const PATHS = {
  // ── Actions ──────────────────────────────────────────────────────────────
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
           <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,

  // ── Domain ───────────────────────────────────────────────────────────────
  scale: <><path d="M12 3v18" /><path d="M7 21h10" /><path d="M5 7h14" />
           <path d="M5 7 2 14h6Z" /><path d="M19 7l-3 7h6Z" /></>,
  receipt: <><path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3Z" />
             <path d="M9 8h6M9 12h6M9 16h3" /></>,
  tag: <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" />
          <path d="M2 3h3l2.5 12h11L21 7H6" /></>,
  print: <><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
           <path d="M6 14h12v7H6Z" /></>,
  camera: <><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            <circle cx="12" cy="12.5" r="3.5" /></>,
  barcode: <><path d="M3 5v14M6.5 5v14M10 5v10M13.5 5v14M17 5v10M20.5 5v14" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  money: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" />
           <path d="M6 12h.01M18 12h.01" /></>,
  warning: <><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></>,
  chevronRight: <><path d="m9 5 7 7-7 7" /></>,
  chevronLeft: <><path d="m15 5-7 7 7 7" /></>,
};

export const ICON_NAMES = Object.keys(PATHS);

export default function Icon({ name, size = 18, strokeWidth = 1.75, className = '', title }) {
  const d = PATHS[name];
  if (!d) {
    if (process.env.NODE_ENV !== 'production') console.warn(`[Icon] unknown name: ${name}`);
    return null;
  }
  return (
    <svg
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {d}
    </svg>
  );
}
