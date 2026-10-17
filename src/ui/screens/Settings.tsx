import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { applyTheme } from '../../bootstrap';
import { buildCsvRows, exportBackup, restoreBackup, validateBackup } from '../../db/backup';
import { getCatalog } from '../../db/catalogRepo';
import { getSettings, updateSettings } from '../../db/settingsRepo';
import { setsToCsv } from '../../domain/csv';
import { buildClaudePrompt } from '../../domain/claudePrompt';
import type { Settings as SettingsData } from '../../domain/types';
import { readFileText, shareOrDownload } from '../lib/share';
import { navigate } from '../router';

const THEMES: { id: SettingsData['theme']; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const MIN_CLOSE = 5;
const MAX_CLOSE = 240;

const pad = (n: number) => String(n).padStart(2, '0');

function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lastBackupText(at: number | null, now: number): string {
  if (at === null) return 'never';
  const day = (ts: number) => {
    const d = new Date(ts);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const days = Math.max(0, Math.round((day(now) - day(at)) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export default function Settings() {
  const settings = useLiveQuery(getSettings, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<string | null>(null);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // A committed value stays on screen until the live settings show it, so the field never flashes the old value.
  // Functional update: a keystroke queued before this effect runs must win over the clear.
  const liveMinutes = settings?.autoCloseMinutes;
  useEffect(() => {
    if (liveMinutes === undefined) return;
    setMinutes((m) => (m === String(liveMinutes) ? null : m));
  }, [liveMinutes]);

  if (!settings) return <main className="screen" />;

  const fail = (e: unknown) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true });

  async function chooseTheme(theme: SettingsData['theme']) {
    await updateSettings({ theme });
    applyTheme(theme);
  }

  async function doExportBackup() {
    setMessage(null);
    try {
      const now = Date.now();
      const file = await exportBackup(now);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      // Only a completed share or download counts as a backup; a cancelled sheet does not.
      if (await shareOrDownload(`rwtm-backup-${localDate(now)}.json`, blob)) {
        await updateSettings({ lastBackupAt: Date.now() });
      }
    } catch (e) {
      fail(e);
    }
  }

  async function doImport(file: File) {
    setMessage(null);
    let json: unknown;
    try {
      json = JSON.parse(await readFileText(file));
    } catch {
      setMessage({ text: 'Not a valid backup file', error: true });
      return;
    }
    const result = validateBackup(json);
    if (!result.ok) {
      setMessage({ text: result.error, error: true });
      return;
    }
    if (!window.confirm('Replace all data with this backup?')) return;
    try {
      await restoreBackup(result.file);
    } catch (e) {
      console.error(e);
      setMessage({ text: 'Restore failed — your data was not changed', error: true });
      return;
    }
    applyTheme((await getSettings()).theme);
    setMessage({ text: 'Backup restored', error: false });
  }

  async function doExportCsv() {
    setMessage(null);
    try {
      const csv = setsToCsv(await buildCsvRows());
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
      await shareOrDownload(`rwtm-sets-${localDate(Date.now())}.csv`, blob);
    } catch (e) {
      fail(e);
    }
  }

  async function copyPrompt() {
    setMessage(null);
    const prompt = buildClaudePrompt(await getCatalog());
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      setManualPrompt(prompt);
      return;
    }
    setManualPrompt(null);
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function commitMinutes() {
    if (minutes === null) return;
    const n = Math.round(Number(minutes));
    if (minutes.trim() === '' || !Number.isFinite(n)) {
      setMinutes(null);
      return;
    }
    const clamped = Math.min(MAX_CLOSE, Math.max(MIN_CLOSE, n));
    if (clamped === settings!.autoCloseMinutes) {
      setMinutes(null);
      return;
    }
    setMinutes(String(clamped));
    try {
      await updateSettings({ autoCloseMinutes: clamped });
    } catch (e) {
      setMinutes(null);
      fail(e);
    }
  }

  return (
    <main className="screen">
      <header className="bar">
        <h1 className="title">Settings</h1>
      </header>

      <div className="field">
        <span>Theme</span>
        <div className="segmented" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="btn btn-ghost"
              aria-pressed={settings.theme === t.id}
              onClick={() => void chooseTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="list">
        <li className="row">
          <button className="btn btn-primary" onClick={() => void doExportBackup()}>
            Export backup
          </button>
          <p className="hint">Last backup: {lastBackupText(settings.lastBackupAt, Date.now())}</p>
        </li>
        <li className="row">
          <input
            ref={fileRef}
            type="file"
            hidden
            aria-label="Backup file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void doImport(file);
            }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
        </li>
        <li className="row">
          <button className="btn btn-ghost" onClick={() => void doExportCsv()}>
            Export CSV
          </button>
        </li>
        <li className="row">
          <button className="btn btn-ghost" onClick={() => void copyPrompt()}>
            Copy Claude prompt
          </button>
          {copied && <p className="hint">Copied</p>}
          {manualPrompt !== null && (
            <textarea
              readOnly
              aria-label="Claude prompt"
              rows={8}
              value={manualPrompt}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </li>
        <li className="row">
          <label className="field">
            <span>Auto-close after (minutes)</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_CLOSE}
              max={MAX_CLOSE}
              value={minutes ?? String(settings.autoCloseMinutes)}
              onChange={(e) => setMinutes(e.target.value)}
              onBlur={() => void commitMinutes()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        </li>
      </ul>

      {message && (
        <p className={message.error ? 'error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <div className="bottom-actions">
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}>
          ‹ Home
        </button>
      </div>
    </main>
  );
}
