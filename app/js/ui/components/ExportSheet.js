import { useEffect, useRef, useState } from 'react';
import { oneLine } from '../lib/errors.js';
import { shareOrDownload } from '../lib/share.js';
import Sheet from './Sheet.js';
import { html } from '../../lib/html.js';

/**
 * What to export. `text` is shown and copied; `blob` (the same content, maybe with a BOM) is saved.
 * @typedef {object} Export
 * @property {string} title
 * @property {string} filename
 * @property {string} text
 * @property {Blob} blob
 * @property {() => void | Promise<void>} [onDone] Called after a confirmed save or copy (not a cancel).
 */

/**
 * @typedef {object} Props
 * @property {Export | null} item Null hides the sheet.
 * @property {() => void} onClose
 */

/**
 * Save file / Copy / the text itself. In the Claude Android app neither file saving nor sharing may work,
 * so Copy (and, when the clipboard is refused, selecting the visible text by hand) is always offered.
 * The text area is read-only and uncontrolled, so a ~1 MB backup is put into the page once and never re-rendered.
 * @param {Props} props
 */
export default function ExportSheet({ item, onClose }) {
  const areaRef = useRef(null);
  /** @type {[{ text: string, error: boolean } | null, Function]} */
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setStatus(null), [item]);

  if (!item) return null;

  async function done(text) {
    setStatus({ text, error: false });
    try {
      await item.onDone?.();
    } catch (e) {
      setStatus({ text: oneLine(e, 'Could not record the export'), error: true });
    }
  }

  async function save() {
    setStatus(null);
    setBusy(true);
    try {
      if (await shareOrDownload(item.filename, item.blob)) await done('Saved');
    } catch (e) {
      setStatus({ text: oneLine(e, 'Could not save the file'), error: true });
    } finally {
      setBusy(false);
    }
  }

  function selectAll() {
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
  }

  function copy() {
    setStatus(null);
    // writeText is called right here in the click handler, while the tap still counts as user activation.
    let writing;
    try {
      writing = navigator.clipboard.writeText(item.text);
    } catch (e) {
      writing = Promise.reject(e);
    }
    writing.then(
      () => done('Copied'),
      () => {
        selectAll();
        setStatus({ text: 'Select all and copy', error: true });
      },
    );
  }

  return html`
    <${Sheet} open title=${item.title} onClose=${onClose}>
      <p className="hint left">${item.filename}</p>
      <div className="nav-row">
        <button className="btn btn-primary" disabled=${busy} onClick=${() => void save()}>
          Save file
        </button>
        <button className="btn btn-primary" onClick=${copy}>
          Copy
        </button>
      </div>
      ${
        status &&
        html`
        <p className=${status.error ? 'error' : 'hint'} role=${status.error ? 'alert' : 'status'}>
          ${status.text}
        </p>
      `
      }
      <textarea
        key=${item.filename + item.text.length}
        ref=${areaRef}
        className="paste-area"
        readOnly
        aria-label="Export text"
        rows=${8}
        defaultValue=${item.text}
        onFocus=${(e) => e.currentTarget.select()}
      />
      <button className="btn btn-ghost" onClick=${onClose}>
        Close
      </button>
    </${Sheet}>
  `;
}
