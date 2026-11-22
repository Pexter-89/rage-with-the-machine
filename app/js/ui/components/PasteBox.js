import { useEffect, useRef, useState } from 'react';
import { html } from '../../lib/html.js';

/**
 * @typedef {object} Props
 * @property {string} label Accessible name of the text area.
 * @property {string} [placeholder]
 * @property {string} [submitLabel='Import']
 * @property {(text: string) => void | Promise<void>} onSubmit
 */

/**
 * A text area to paste a file's contents into, with an Import button. The Claude Android app opens no file
 * picker, so every import offers this next to "Choose file". The area is uncontrolled (read through a ref
 * on submit), so pasting a ~1 MB backup does not re-render the screen on every change.
 * @param {Props} props
 */
export default function PasteBox({ label, placeholder = 'Paste here', submitLabel = 'Import', onSubmit }) {
  const areaRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => areaRef.current?.focus(), []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(areaRef.current?.value ?? '');
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div className="paste-box">
      <textarea
        ref=${areaRef}
        className="paste-area"
        aria-label=${label}
        placeholder=${placeholder}
        rows=${5}
        spellCheck=${false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button className="btn btn-primary" disabled=${busy} onClick=${() => void submit()}>
        ${submitLabel}
      </button>
    </div>
  `;
}
