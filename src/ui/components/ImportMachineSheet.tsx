import { useEffect, useRef, useState } from 'react';
import { getCatalog } from '../../db/catalogRepo';
import { importMachines, machinesAlreadyAtGym } from '../../db/gymRepo';
import { CATEGORIES } from '../../domain/catalog';
import { parseMachineFile, type ParseResult } from '../../domain/importMachine';
import type { CatalogExercise, GymExercise, Loading } from '../../domain/types';
import { formatWeight } from '../../domain/metrics';
import { oneLine as toOneLine } from '../lib/errors';
import { readFileText } from '../lib/share';
import Sheet from './Sheet';

interface Props {
  gymId: string;
  /** A file already chosen by the caller; read and parsed on mount. */
  initialFile?: File;
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
    case 'free':
      return `Free ${formatWeight(l.start)}–${formatWeight(l.max)} kg`;
    case 'bodyweight':
      return `Bodyweight, +${formatWeight(l.step)} kg steps`;
  }
}

export default function ImportMachineSheet({ gymId, initialFile, onClose, onImported }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  /** Per parsed machine: the gym already has it, so Import skips it. */
  const [already, setAlready] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  async function load(next: string) {
    const mine = ++seq.current;
    setText(next);
    setError(null);
    if (!next.trim()) {
      setResult(null);
      return;
    }
    try {
      const c = await getCatalog();
      if (mine !== seq.current) return;
      const parsed = parseMachineFile(next, c);
      const dup = parsed.ok ? await machinesAlreadyAtGym(gymId, parsed.machines) : [];
      if (mine !== seq.current) return;
      setCatalog(c);
      setAlready(dup);
      setResult(parsed);
    } catch (e) {
      if (mine === seq.current) setResult({ ok: false, error: oneLine(e) });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await load(await readFileText(file));
    } catch (e) {
      setText('');
      setResult({ ok: false, error: oneLine(e) });
    }
  }

  useEffect(() => {
    if (initialFile) void onFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  async function pasteFromClipboard() {
    try {
      await load(await navigator.clipboard.readText());
    } catch {
      setResult({ ok: false, error: 'Could not read the clipboard; paste into the box instead' });
    }
  }

  const nothingNew = !!result?.ok && result.machines.every((_, i) => already[i]);

  async function doImport() {
    if (!result?.ok || busy || nothingNew) return;
    setBusy(true);
    try {
      const created = await importMachines(gymId, result);
      onImported(created);
      onClose();
    } catch (e) {
      setError(oneLine(e));
      setBusy(false);
    }
  }

  const nameOf = (id: string) =>
    result?.ok ? (result.newExercises.find((e) => e.id === id) ?? catalog.find((e) => e.id === id)) : undefined;
  const categoryName = (id: string | undefined) => CATEGORIES.find((c) => c.id === id)?.name ?? '';

  return (
    <Sheet open title="Import machine" onClose={onClose}>
      <input
        ref={fileRef}
        type="file"
        hidden
        aria-label="Machine file"
        accept=".json,.md,.txt,application/json,text/plain,text/markdown"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="inline-form">
        <button className="btn btn-primary grow" onClick={() => fileRef.current?.click()}>
          Choose file
        </button>
        {canPaste && (
          <button className="btn btn-ghost" onClick={() => void pasteFromClipboard()}>
            Paste
          </button>
        )}
      </div>
      <textarea
        className="paste-area"
        aria-label="Pasted text"
        placeholder="…or paste Claude's reply here"
        value={text}
        onChange={(e) => void load(e.target.value)}
        rows={4}
      />

      {result && !result.ok && (
        <p className="error" role="alert">
          {oneLine(result.error)}
        </p>
      )}
      {result?.ok && (
        <>
          <ul className="list preview">
            {result.machines.map((m, i) => {
              const e = nameOf(m.catalogId);
              return (
                <li key={i} className="row">
                  {`${e?.name ?? m.catalogId} — ${categoryName(e?.category)} · ${loadingSummary(m.loading)}`}
                  {already[i] && <span className="tag">Already at this gym</span>}
                </li>
              );
            })}
            {result.newExercises.map((e) => (
              <li key={e.id} className="hint">{`New: ${e.name}`}</li>
            ))}
          </ul>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {nothingNew && <p className="hint">Nothing new to import</p>}
          <button className="btn btn-ok" disabled={busy || nothingNew} onClick={() => void doImport()}>
            Import
          </button>
        </>
      )}
      <button className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}
