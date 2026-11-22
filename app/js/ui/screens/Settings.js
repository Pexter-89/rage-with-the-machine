import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { applyTheme } from '../../bootstrap.js';
import { buildCsvRows, exportBackup, restoreBackup, validateBackup } from '../../db/backup.js';
import { getCatalog } from '../../db/catalogRepo.js';
import { addDemoData, hasDemoData, removeDemoData } from '../../db/demo.js';
import { getSettings, updateSettings } from '../../db/settingsRepo.js';
import { setsToCsv } from '../../domain/csv.js';
import { buildClaudePrompt } from '../../domain/claudePrompt.js';
import { readFileText, shareOrDownload } from '../lib/share.js';
import { askConfirm } from '../lib/confirm.js';
import { activeCloudSync, backupDocCount, CLOUD_DOC_LIMIT } from '../../db/cloudSync.js';
import ConfirmSheet from '../components/ConfirmSheet.js';
import TopBar from '../components/TopBar.js';
import { html } from '../../lib/html.js';

const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const MIN_CLOSE = 5;
const MAX_CLOSE = 240;

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {number} ts
 * @returns {string}
 */
function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {number | null} at
 * @param {number} now
 * @returns {string}
 */
function lastBackupText(at, now) {
  if (at === null) return 'never';
  const day = (ts) => {
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
  const demo = useLiveQuery(hasDemoData, []);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const fileRef = useRef(null);
  const copiedTimer = useRef(undefined);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [manualPrompt, setManualPrompt] = useState(null);
  const [minutes, setMinutes] = useState(null);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // A committed value stays on screen until the live settings show it, so the field never flashes the old value.
  // Functional update: a keystroke queued before this effect runs must win over the clear.
  const liveMinutes = settings?.autoCloseMinutes;
  useEffect(() => {
    if (liveMinutes === undefined) return;
    setMinutes((m) => (m === String(liveMinutes) ? null : m));
  }, [liveMinutes]);

  if (!settings)
    return html`
      <main className="screen">
        <${TopBar} route=${{ name: 'settings' }} title="Settings" />
      </main>
    `;

  const fail = (e) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true });

  async function chooseTheme(theme) {
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

  async function doImport(file) {
    setMessage(null);
    let json;
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
    if (activeCloudSync() && backupDocCount(result.file.data) > CLOUD_DOC_LIMIT) {
      setMessage({
        text: `This backup has more than ${CLOUD_DOC_LIMIT} rows, more than cloud storage holds`,
        error: true,
      });
      return;
    }
    if (!(await askConfirm('Replace all data with this backup?', 'Replace'))) return;
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

  async function loadDemo() {
    setMessage(null);
    try {
      const n = await addDemoData(Date.now());
      setMessage({ text: `Demo data loaded: 2 demo gyms, ${n} sessions`, error: false });
    } catch (e) {
      fail(e);
    }
  }

  async function commitMinutes() {
    if (minutes === null) return;
    const n = Math.round(Number(minutes));
    if (minutes.trim() === '' || !Number.isFinite(n)) {
      setMinutes(null);
      return;
    }
    const clamped = Math.min(MAX_CLOSE, Math.max(MIN_CLOSE, n));
    if (clamped === settings.autoCloseMinutes) {
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

  return html`
    <main className="screen">
      <${TopBar} route=${{ name: 'settings' }} title="Settings" />

      <div className="field">
        <span>Theme</span>
        <div className="segmented" role="group" aria-label="Theme">
          ${THEMES.map(
            (t) =>
              html`
            <button
              key=${t.id}
              className="btn btn-ghost"
              aria-pressed=${settings.theme === t.id}
              onClick=${() => void chooseTheme(t.id)}
            >
              ${t.label}
            </button>
          `,
          )}
        </div>
      </div>

      <ul className="list">
        <li className="row">
          <button className="btn btn-primary" onClick=${() => void doExportBackup()}>
            Export backup
          </button>
          <p className="hint">Last backup: ${lastBackupText(settings.lastBackupAt, Date.now())}</p>
        </li>
        <li className="row">
          <input
            ref=${fileRef}
            type="file"
            hidden
            aria-label="Backup file"
            accept=".json,application/json"
            onChange=${(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void doImport(file);
            }}
          />
          <button className="btn btn-ghost" onClick=${() => fileRef.current?.click()}>
            Import backup
          </button>
        </li>
        <li className="row">
          <button className="btn btn-ghost" onClick=${() => void doExportCsv()}>
            Export CSV
          </button>
        </li>
        <li className="row">
          <button className="btn btn-ghost" onClick=${() => void copyPrompt()}>
            Copy Claude prompt
          </button>
          ${copied && html`<p className="hint">Copied</p>`}
          ${
            manualPrompt !== null &&
            html`
            <textarea
              readOnly
              aria-label="Claude prompt"
              rows=${8}
              value=${manualPrompt}
              onFocus=${(e) => e.currentTarget.select()}
            />
          `
          }
        </li>
        <li className="row">
          <label className="field">
            <span>Auto-close after (minutes)</span>
            <input
              type="number"
              inputMode="numeric"
              min=${MIN_CLOSE}
              max=${MAX_CLOSE}
              value=${minutes ?? String(settings.autoCloseMinutes)}
              onChange=${(e) => setMinutes(e.target.value)}
              onBlur=${() => void commitMinutes()}
              onKeyDown=${(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        </li>
      </ul>

      <ul className="list">
        <li className="row">
          ${
            demo
              ? html`
            <button className="btn btn-ghost" onClick=${() => setConfirmDemo(true)}>
              Remove demo data
            </button>
          `
              : html`
            <button className="btn btn-ghost" onClick=${() => void loadDemo()}>
              Load demo data
            </button>
          `
          }
          <p className="hint">
            Two demo gyms with five months of made-up workouts, to try out Progress. Your own data is not touched.
          </p>
        </li>
      </ul>

      ${
        message &&
        html`
        <p className=${message.error ? 'error' : 'hint'} role=${message.error ? 'alert' : 'status'}>
          ${message.text}
        </p>
      `
      }

      <${ConfirmSheet}
        title="Remove demo data?"
        message=${confirmDemo ? 'The demo gyms and everything logged at them will be deleted.' : null}
        confirmLabel="Remove"
        onConfirm=${async () => {
          await removeDemoData();
          setMessage({ text: 'Demo data removed', error: false });
        }}
        onClose=${() => setConfirmDemo(false)}
      />
    </main>
  `;
}
