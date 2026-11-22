import { useEffect, useState } from 'react';
import { html } from '../../lib/html.js';

/**
 * "1:05" from milliseconds.
 * @param {number} ms
 * @returns {string}
 */
export function formatRest(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Time since the last completed set. Counts from a timestamp rather than ticks, so it stays right after the
 * phone sleeps; it lives only as long as the logging screen that shows it.
 * @param {{ since: number | null }} props
 */
export default function RestTimer({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [since]);

  if (since === null) return null;
  return html`
    <div className="rest-timer" role="timer" aria-label="Rest timer">
      <span className="rest-label">Rest</span>
      <span className="rest-time">${formatRest(now - since)}</span>
    </div>
  `;
}
