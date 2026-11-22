import { useEffect, useRef, useState } from 'react';
import { getCatalog } from '../../db/catalogRepo.js';
import {
  addGymFromFile,
  importMachines,
  machinesAlreadyAtGym,
  planReplace,
  replaceGymEquipment,
} from '../../db/gymRepo.js';
import { CATEGORIES } from '../../domain/catalog.js';
import { parseMachineBatch } from '../../domain/importMachine.js';
import { formatWeight } from '../../domain/metrics.js';
import { oneLine as toOneLine } from '../lib/errors.js';
import { readFileText } from '../lib/share.js';
import Sheet from './Sheet.js';
import { Fragment, html } from '../../lib/html.js';

/**
 * add: add machines to a gym (skipping ones it has). replace: make the gym's equipment exactly the file's.
 * newGym: create a gym from a gym file.
 * @typedef {'add' | 'replace' | 'newGym'} Mode
 */

/**
 * @typedef {object} Props
 * @property {Mode} [mode]
 * @property {string} [gymId] The gym to add to or replace; not used for newGym.
 * @property {File[]} [initialFiles] Files already chosen by the caller; read and parsed on mount.
 * @property {() => void} onClose
 * @property {(created: GymExercise[]) => void} onImported
 * @property {(gym: Gym) => void} onGymCreated
 */

const TITLES = { add: 'Import machines', replace: 'Replace equipment', newGym: 'Import gym' };

/**
 * @param {ReplaceSummary} p
 * @returns {string}
 */
function replaceText(p) {
  const parts = [`${p.updated} updated`, `${p.added} added`, `${p.removed} removed`];
  if (p.hidden) parts.push(`${p.hidden} hidden (they have logged sets)`);
  return parts.join(', ');
}

/** @param {unknown} e */
const oneLine = (e) => toOneLine(e, 'Import failed');

/**
 * @param {Loading} l
 * @returns {string}
 */
export function loadingSummary(l) {
  switch (l.type) {
    case 'stack': {
      const w = [...l.weights].sort((a, b) => a - b);
      const extra = l.addOns?.length ? ` + ${l.addOns.map(formatWeight).join(' / ')} add-on` : '';
      return `Stack ${formatWeight(w[0])}–${formatWeight(w[w.length - 1])} ${l.unit === 'level' ? 'L' : 'kg'}${extra}`;
    }
    case 'plate':
      return `Plate, sled ${formatWeight(l.base)} kg, +${formatWeight(l.step)}`;
    case 'plates':
      return `Plates ${l.sides === 2 ? 'in pairs' : 'one side'}, base ${formatWeight(l.base)} kg`;
    case 'free':
      return `Free ${formatWeight(l.start)}–${formatWeight(l.max)} kg`;
    case 'bodyweight':
      return `Bodyweight, +${formatWeight(l.step)} kg steps`;
  }
}

/**
 * @typedef {object} Parsed (also has every field of BatchResult)
 * @property {boolean[]} already Per machine: the gym already has it, so it is not offered.
 */

/** @param {Props} props */
export default function ImportMachineSheet({
  mode = 'add',
  gymId = '',
  initialFiles,
  onClose,
  onImported,
  onGymCreated,
}) {
  const [gymName, setGymName] = useState(null); // null: not typed, use the file's
  const [plan, setPlan] = useState(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [catalog, setCatalog] = useState([]);
  /** Per parsed machine: ticked for import. */
  const [picked, setPicked] = useState([]);
  const [readError, setReadError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const seq = useRef(0);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  async function reparse(nextText, nextFiles) {
    const mine = ++seq.current;
    setError(null);
    const sources = [...nextFiles, ...(nextText.trim() ? [{ name: 'Pasted text', text: nextText }] : [])];
    if (sources.length === 0) {
      setParsed(null);
      return;
    }
    try {
      const c = await getCatalog();
      if (mine !== seq.current) return;
      const batch = parseMachineBatch(sources, c);
      const already =
        mode === 'add' ? await machinesAlreadyAtGym(gymId, batch.machines) : batch.machines.map(() => false);
      if (mine !== seq.current) return;
      setCatalog(c);
      setParsed({ ...batch, already });
      setPicked(already.map((a) => !a));
    } catch (e) {
      if (mine === seq.current) {
        setParsed({ machines: [], newExercises: [], errors: [oneLine(e)], already: [], gymName: null });
      }
    }
  }

  function changeText(next) {
    setText(next);
    void reparse(next, files);
  }

  /** Files add to the ones already chosen, so photos' files can be collected one by one or all at once. */
  async function addFiles(list) {
    if (list.length === 0) return;
    setReadError(null);
    const read = [];
    for (const f of list) {
      try {
        read.push({ name: f.name, text: await readFileText(f) });
      } catch (e) {
        setReadError(`${f.name}: ${oneLine(e)}`);
      }
    }
    setFiles((prev) => {
      const next = [...prev.filter((p) => !read.some((r) => r.name === p.name)), ...read];
      void reparse(text, next);
      return next;
    });
  }

  function removeFile(name) {
    const next = files.filter((f) => f.name !== name);
    setFiles(next);
    void reparse(text, next);
  }

  useEffect(() => {
    if (initialFiles?.length) void addFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  async function pasteFromClipboard() {
    try {
      changeText(await navigator.clipboard.readText());
    } catch {
      setReadError('Could not read the clipboard; paste into the box instead');
    }
  }

  const chosen = parsed ? parsed.machines.filter((_, i) => picked[i] && !parsed.already[i]) : [];
  const nothingNew = !!parsed && parsed.machines.length > 0 && parsed.machines.every((_, i) => parsed.already[i]);

  // A gym file may list no equipment: then replacing empties the gym, and a new gym starts empty.
  const emptyGymFile =
    !!parsed && parsed.machines.length === 0 && parsed.gymName !== null && parsed.errors.length === 0;
  const name = (gymName ?? parsed?.gymName ?? '').trim();
  const canAct =
    !!parsed &&
    (mode === 'add' ? chosen.length > 0 : chosen.length > 0 || emptyGymFile) &&
    (mode !== 'newGym' || name.length > 0);

  const planKey = mode === 'replace' && parsed && canAct ? JSON.stringify(chosen) : null;
  useEffect(() => {
    let live = true;
    setPlan(null);
    if (planKey === null) return;
    void planReplace(gymId, JSON.parse(planKey)).then((p) => live && setPlan(p));
    return () => {
      live = false;
    };
  }, [planKey, gymId]);

  async function doImport() {
    if (!parsed || busy || !canAct) return;
    setBusy(true);
    const file = { ok: true, machines: chosen, newExercises: parsed.newExercises };
    try {
      if (mode === 'replace') await replaceGymEquipment(gymId, file);
      else if (mode === 'newGym') onGymCreated?.(await addGymFromFile(name, file));
      else onImported?.(await importMachines(gymId, file));
      onClose();
    } catch (e) {
      setError(oneLine(e));
      setBusy(false);
    }
  }

  const nameOf = (id) => parsed?.newExercises.find((e) => e.id === id) ?? catalog.find((e) => e.id === id);
  const categoryName = (id) => CATEGORIES.find((c) => c.id === id)?.name ?? '';
  const neededNew = parsed ? parsed.newExercises.filter((e) => chosen.some((m) => m.catalogId === e.id)) : [];

  return html`
    <${Sheet} open title=${TITLES[mode]} onClose=${onClose}>
      ${
        mode === 'replace' &&
        html`
        <p className="hint">
          Everything at this gym is replaced by the file. A machine with the same exercise and label is updated in place, so its history stays with it.
        </p>
      `
      }
      <input
        ref=${fileRef}
        type="file"
        hidden
        multiple
        aria-label="Machine file"
        accept=".json,.md,.txt,application/json,text/plain,text/markdown"
        onChange=${(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          void addFiles(list);
        }}
      />
      <div className="inline-form">
        <button className="btn btn-primary grow" onClick=${() => fileRef.current?.click()}>
          ${files.length > 0 ? 'Add files' : 'Choose files'}
        </button>
        ${
          canPaste &&
          html`
          <button className="btn btn-ghost" onClick=${() => void pasteFromClipboard()}>
            Paste
          </button>
        `
        }
      </div>
      ${
        files.length > 0 &&
        html`
        <ul className="chips file-chips" aria-label="Chosen files">
          ${files.map(
            (f) =>
              html`
            <li key=${f.name} className="chip-file">
              <span>${f.name}</span>
              <button className="btn btn-quiet btn-icon" aria-label=${`Remove ${f.name}`} onClick=${() => removeFile(f.name)}>
                ✕
              </button>
            </li>
          `,
          )}
        </ul>
      `
      }
      <textarea
        className="paste-area"
        aria-label="Pasted text"
        placeholder="…or paste Claude's replies here (one or several)"
        value=${text}
        onChange=${(e) => changeText(e.target.value)}
        rows=${files.length > 0 ? 2 : 4}
      />

      ${
        readError &&
        html`
        <p className="error" role="alert">
          ${readError}
        </p>
      `
      }
      ${parsed?.errors.map(
        (e, i) =>
          html`
        <p key=${i} className="error" role="alert">
          ${oneLine(e)}
        </p>
      `,
      )}
      ${
        parsed &&
        parsed.machines.length > 0 &&
        html`
        <${Fragment}>
          <ul className="list preview">
            ${parsed.machines.map((m, i) => {
              const e = nameOf(m.catalogId);
              const name = e?.name ?? m.catalogId;
              return html`
                <li key=${i} className="row">
                  <label className="preview-pick">
                    <input
                      type="checkbox"
                      aria-label=${`Import ${name}${m.label ? ` (${m.label})` : ''}`}
                      checked=${!!picked[i] && !parsed.already[i]}
                      disabled=${parsed.already[i]}
                      onChange=${(ev) => setPicked((p) => p.map((v, j) => (j === i ? ev.target.checked : v)))}
                    />
                    <span>${`${name} — ${categoryName(e?.category)} · ${loadingSummary(m.loading)}`}</span>
                  </label>
                  ${m.label && html`<span className="card-label">${m.label}</span>`}
                  ${parsed.already[i] && html`<span className="tag">Already at this gym</span>`}
                </li>
              `;
            })}
            ${neededNew.map((e) => html`<li key=${e.id} className="hint">${`New: ${e.name}`}</li>`)}
          </ul>
        </${Fragment}>
      `
      }
      ${emptyGymFile && html`<p className="hint">${`${parsed.gymName}: no equipment in the file`}</p>`}
      ${
        parsed &&
        (parsed.machines.length > 0 || emptyGymFile) &&
        html`
        <${Fragment}>
          ${
            mode === 'newGym' &&
            html`
            <label className="field">
              <span>Gym name</span>
              <input value=${gymName ?? parsed.gymName ?? ''} onChange=${(e) => setGymName(e.target.value)} />
            </label>
          `
          }
          ${
            error &&
            html`
            <p className="error" role="alert">
              ${error}
            </p>
          `
          }
          ${mode === 'replace' && plan && html`<p className="hint">${replaceText(plan)}</p>`}
          ${mode === 'add' && nothingNew && html`<p className="hint">Nothing new to import</p>`}
          <button className="btn btn-ok" disabled=${busy || !canAct} onClick=${() => void doImport()}>
            ${
              mode === 'newGym'
                ? 'Create gym'
                : mode === 'replace'
                  ? `Replace with ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`
                  : chosen.length > 1
                    ? `Import ${chosen.length} machines`
                    : 'Import'
            }
          </button>
        </${Fragment}>
      `
      }
      <button className="btn btn-ghost" onClick=${onClose}>
        Cancel
      </button>
    </${Sheet}>
  `;
}
