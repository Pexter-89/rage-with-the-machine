import { useEffect, useRef, useState } from 'react';
import { getCatalog } from '../../db/catalogRepo';
import { importMachines, machinesAlreadyAtGym } from '../../db/gymRepo';
import { CATEGORIES } from '../../domain/catalog';
import { parseMachineBatch, type BatchResult, type BatchSource } from '../../domain/importMachine';
import type { CatalogExercise, GymExercise, Loading } from '../../domain/types';
import { formatWeight } from '../../domain/metrics';
import { oneLine as toOneLine } from '../lib/errors';
import { readFileText } from '../lib/share';
import Sheet from './Sheet';

interface Props {
  gymId: string;
  /** Files already chosen by the caller; read and parsed on mount. */
  initialFiles?: File[];
  onClose(): void;
  onImported(created: GymExercise[]): void;
}

const oneLine = (e: unknown) => toOneLine(e, 'Import failed');

export function loadingSummary(l: Loading): string {
  switch (l.type) {
    case 'stack': {
      const w = [...l.weights].sort((a, b) => a - b);
      return `Stack ${formatWeight(w[0])}–${formatWeight(w[w.length - 1])} ${l.unit === 'level' ? 'L' : 'kg'}`;
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

interface Parsed extends BatchResult {
  /** Per machine: the gym already has it, so it is not offered. */
  already: boolean[];
}

export default function ImportMachineSheet({ gymId, initialFiles, onClose, onImported }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<BatchSource[]>([]);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  /** Per parsed machine: ticked for import. */
  const [picked, setPicked] = useState<boolean[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  async function reparse(nextText: string, nextFiles: BatchSource[]) {
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
      const already = await machinesAlreadyAtGym(gymId, batch.machines);
      if (mine !== seq.current) return;
      setCatalog(c);
      setParsed({ ...batch, already });
      setPicked(already.map((a) => !a));
    } catch (e) {
      if (mine === seq.current) setParsed({ machines: [], newExercises: [], errors: [oneLine(e)], already: [] });
    }
  }

  function changeText(next: string) {
    setText(next);
    void reparse(next, files);
  }

  /** Files add to the ones already chosen, so photos' files can be collected one by one or all at once. */
  async function addFiles(list: File[]) {
    if (list.length === 0) return;
    setReadError(null);
    const read: BatchSource[] = [];
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

  function removeFile(name: string) {
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

  async function doImport() {
    if (!parsed || busy || chosen.length === 0) return;
    setBusy(true);
    try {
      const created = await importMachines(gymId, { ok: true, machines: chosen, newExercises: parsed.newExercises });
      onImported(created);
      onClose();
    } catch (e) {
      setError(oneLine(e));
      setBusy(false);
    }
  }

  const nameOf = (id: string) => parsed?.newExercises.find((e) => e.id === id) ?? catalog.find((e) => e.id === id);
  const categoryName = (id: string | undefined) => CATEGORIES.find((c) => c.id === id)?.name ?? '';
  const neededNew = parsed ? parsed.newExercises.filter((e) => chosen.some((m) => m.catalogId === e.id)) : [];

  return (
    <Sheet open title="Import machines" onClose={onClose}>
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        aria-label="Machine file"
        accept=".json,.md,.txt,application/json,text/plain,text/markdown"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          void addFiles(list);
        }}
      />
      <div className="inline-form">
        <button className="btn btn-primary grow" onClick={() => fileRef.current?.click()}>
          {files.length > 0 ? 'Add files' : 'Choose files'}
        </button>
        {canPaste && (
          <button className="btn btn-ghost" onClick={() => void pasteFromClipboard()}>
            Paste
          </button>
        )}
      </div>
      {files.length > 0 && (
        <ul className="chips file-chips" aria-label="Chosen files">
          {files.map((f) => (
            <li key={f.name} className="chip-file">
              <span>{f.name}</span>
              <button className="btn btn-quiet btn-icon" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.name)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        className="paste-area"
        aria-label="Pasted text"
        placeholder="…or paste Claude's replies here (one or several)"
        value={text}
        onChange={(e) => changeText(e.target.value)}
        rows={files.length > 0 ? 2 : 4}
      />

      {readError && (
        <p className="error" role="alert">
          {readError}
        </p>
      )}
      {parsed?.errors.map((e, i) => (
        <p key={i} className="error" role="alert">
          {oneLine(e)}
        </p>
      ))}
      {parsed && parsed.machines.length > 0 && (
        <>
          <ul className="list preview">
            {parsed.machines.map((m, i) => {
              const e = nameOf(m.catalogId);
              const name = e?.name ?? m.catalogId;
              return (
                <li key={i} className="row">
                  <label className="preview-pick">
                    <input
                      type="checkbox"
                      aria-label={`Import ${name}${m.label ? ` (${m.label})` : ''}`}
                      checked={!!picked[i] && !parsed.already[i]}
                      disabled={parsed.already[i]}
                      onChange={(ev) => setPicked((p) => p.map((v, j) => (j === i ? ev.target.checked : v)))}
                    />
                    <span>{`${name} — ${categoryName(e?.category)} · ${loadingSummary(m.loading)}`}</span>
                  </label>
                  {m.label && <span className="card-label">{m.label}</span>}
                  {parsed.already[i] && <span className="tag">Already at this gym</span>}
                </li>
              );
            })}
            {neededNew.map((e) => (
              <li key={e.id} className="hint">{`New: ${e.name}`}</li>
            ))}
          </ul>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {nothingNew && <p className="hint">Nothing new to import</p>}
          <button className="btn btn-ok" disabled={busy || chosen.length === 0} onClick={() => void doImport()}>
            {chosen.length > 1 ? `Import ${chosen.length} machines` : 'Import'}
          </button>
        </>
      )}
      <button className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}
