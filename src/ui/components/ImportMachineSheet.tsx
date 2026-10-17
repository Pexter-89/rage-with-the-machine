import { useEffect, useRef, useState } from 'react';
import { getCatalog } from '../../db/catalogRepo';
import { importMachines } from '../../db/gymRepo';
import { CATEGORIES } from '../../domain/catalog';
import { parseMachineFile, type ParseResult } from '../../domain/importMachine';
import type { CatalogExercise, GymExercise, Loading } from '../../domain/types';
import { formatWeight } from '../../domain/metrics';
import { readFileText } from '../lib/share';
import Sheet from './Sheet';

interface Props {
  gymId: string;
  /** Opens the phone's file chooser as soon as the sheet appears. */
  openFilePicker?: boolean;
  onClose(): void;
  onImported(created: GymExercise[]): void;
}

const MAX_ERROR = 120;

function oneLine(e: unknown): string {
  const first = (e instanceof Error ? e.message : String(e)).split('\n')[0].trim() || 'Import failed';
  return first.length > MAX_ERROR ? first.slice(0, MAX_ERROR) + '…' : first;
}

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

export default function ImportMachineSheet({ gymId, openFilePicker, onClose, onImported }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  useEffect(() => {
    if (openFilePicker) fileRef.current?.click();
  }, [openFilePicker]);

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
      setCatalog(c);
      setResult(parseMachineFile(next, c));
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

  async function pasteFromClipboard() {
    try {
      await load(await navigator.clipboard.readText());
    } catch {
      setResult({ ok: false, error: 'Could not read the clipboard; paste into the box instead' });
    }
  }

  async function doImport() {
    if (!result?.ok || busy) return;
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
          <button className="btn btn-ok" disabled={busy} onClick={() => void doImport()}>
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
