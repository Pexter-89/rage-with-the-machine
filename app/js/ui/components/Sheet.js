import { useEffect, useRef } from 'react';
import { closeLayer, openLayer } from '../router.js';
import { html } from '../../lib/html.js';

/**
 * @typedef {object} Props
 * @property {boolean} open
 * @property {string} title
 * @property {() => void} onClose
 * @property {ReactNode} children
 */

/**
 * Generic bottom sheet with a backdrop; tapping the backdrop or the phone's back button closes it.
 * @param {Props} props
 */
export default function Sheet({ open, title, onClose, children }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = openLayer(() => close.current());
    return () => closeLayer(token);
  }, [open]);

  if (!open) return null;
  return html`
    <div className="sheet-backdrop" data-testid="sheet-backdrop" onClick=${onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label=${title}
        aria-modal="true"
        onClick=${(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">${title}</h2>
        ${children}
      </div>
    </div>
  `;
}
