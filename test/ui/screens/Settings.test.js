import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, resetDb } from '../../../app/js/db/db.js';
import { getSettings } from '../../../app/js/db/settingsRepo.js';
import { shareOrDownload } from '../../../app/js/ui/lib/share.js';
import Settings from '../../../app/js/ui/screens/Settings.js';
import { html } from '../../../app/js/lib/html.js';
import { askConfirm } from '../../../app/js/ui/lib/confirm.js';

// The artifact asks with an in-page sheet (covered in confirm.test.js); here the answer is stubbed.
vi.mock('../../../app/js/ui/lib/confirm.js', () => ({ askConfirm: vi.fn(), inPageConfirm: vi.fn() }));

vi.mock('../../../app/js/ui/lib/share.js', async (orig) => ({
  ...(await orig()),
  shareOrDownload: vi.fn(async () => true),
}));

beforeEach(async () => {
  await resetDb();
  location.hash = '';
  vi.mocked(shareOrDownload).mockReset();
  vi.mocked(shareOrDownload).mockImplementation(async () => true);
});

const pad = (n) => String(n).padStart(2, '0');

test('theme change persists and sets data-theme', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  await user.click(await screen.findByRole('button', { name: 'Light' }));
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  await vi.waitFor(async () => expect((await getSettings()).theme).toBe('light'));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true'));
  await user.click(screen.getByRole('button', { name: 'Dark' }));
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
});

async function openExport(user, name) {
  await user.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog', { name });
}

test('export backup opens the export sheet; Save file saves the dated file and stamps the last backup', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  expect(await screen.findByText('Last backup: never')).toBeInTheDocument();
  const sheet = await openExport(user, 'Export backup');
  expect(JSON.parse(within(sheet).getByLabelText('Export text').value).format).toBe('rwtm-backup');
  // Opening the sheet alone is not a backup.
  expect((await getSettings()).lastBackupAt).toBeNull();
  await user.click(within(sheet).getByRole('button', { name: 'Save file' }));
  const d = new Date();
  const name = `rwtm-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
  const [filename, blob] = vi.mocked(shareOrDownload).mock.calls[0];
  expect(filename).toBe(name);
  expect(blob.type).toBe('application/json');
  expect(await within(sheet).findByText('Saved')).toBeInTheDocument();
  expect(await screen.findByText('Last backup: today')).toBeInTheDocument();
  expect((await getSettings()).lastBackupAt).not.toBeNull();
});

test('export backup: Copy writes the backup to the clipboard, confirms, and stamps the last backup', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  const sheet = await openExport(user, 'Export backup');
  await user.click(within(sheet).getByRole('button', { name: 'Copy' }));
  expect(await within(sheet).findByText('Copied')).toBeInTheDocument();
  expect(JSON.parse(await navigator.clipboard.readText()).format).toBe('rwtm-backup');
  expect(await screen.findByText('Last backup: today')).toBeInTheDocument();
  expect(shareOrDownload).not.toHaveBeenCalled();
});

test('export backup: a refused clipboard selects the text, asks to copy by hand, and does not stamp', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  const sheet = await openExport(user, 'Export backup');
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  await user.click(within(sheet).getByRole('button', { name: 'Copy' }));
  expect(await within(sheet).findByText('Select all and copy')).toBeInTheDocument();
  const area = within(sheet).getByLabelText('Export text');
  expect(area.readOnly).toBe(true);
  expect(document.activeElement).toBe(area);
  expect(area.selectionStart).toBe(0);
  expect(area.selectionEnd).toBe(area.value.length);
  await new Promise((r) => setTimeout(r, 50));
  expect((await getSettings()).lastBackupAt).toBeNull();
});

test('export backup save failure shows inline error and does not update last backup', async () => {
  const user = userEvent.setup();
  vi.mocked(shareOrDownload).mockRejectedValue(new Error('boom'));
  render(html`<${Settings} />`);
  const sheet = await openExport(user, 'Export backup');
  await user.click(within(sheet).getByRole('button', { name: 'Save file' }));
  expect(await within(sheet).findByText('boom')).toBeInTheDocument();
  expect((await getSettings()).lastBackupAt).toBeNull();
});

test('a cancelled backup save does not stamp the last backup', async () => {
  const user = userEvent.setup();
  vi.mocked(shareOrDownload).mockResolvedValue(false);
  render(html`<${Settings} />`);
  const sheet = await openExport(user, 'Export backup');
  await user.click(within(sheet).getByRole('button', { name: 'Save file' }));
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
  // Let any stamping write land before checking it did not happen.
  await new Promise((r) => setTimeout(r, 50));
  expect((await getSettings()).lastBackupAt).toBeNull();
  expect(screen.getByText('Last backup: never')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(within(sheet).queryByText('Saved')).toBeNull();
});

test('export CSV: the sheet shows the CSV; the saved file has a BOM, csv type and dated filename', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  const sheet = await openExport(user, 'Export CSV');
  expect(within(sheet).getByLabelText('Export text').value).toMatch(/^date,time/);
  await user.click(within(sheet).getByRole('button', { name: 'Save file' }));
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
  const [filename, blob] = vi.mocked(shareOrDownload).mock.calls[0];
  expect(filename).toMatch(/^rwtm-sets-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(blob.type).toBe('text/csv;charset=utf-8');
  const bytes = new Uint8Array(
    await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsArrayBuffer(blob);
    }),
  );
  expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toMatch(/^﻿date,time/);
  // A CSV export is not a backup.
  expect((await getSettings()).lastBackupAt).toBeNull();
});

async function pickFile(content) {
  const input = await screen.findByLabelText('Backup file');
  return { input, file: new File([content], 'b.json', { type: 'application/json' }) };
}

test('import of invalid backup shows error and does not ask to confirm', async () => {
  const user = userEvent.setup();
  const confirm = vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  render(html`<${Settings} />`);
  const a = await pickFile(JSON.stringify({ format: 'nope' }));
  await user.upload(a.input, a.file);
  expect(await screen.findByText(/Not a Rage with the machine backup file/)).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();

  const b = await pickFile('not json{');
  await user.upload(b.input, b.file);
  expect(await screen.findByText(/^Not a valid backup file\. /)).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});

test('import valid backup confirms, restores and re-applies theme', async () => {
  const user = userEvent.setup();
  const confirm = vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  const backup = {
    format: 'rwtm-backup',
    version: 1,
    exportedAt: 1,
    data: {
      gyms: [{ id: 'g1', name: 'Restored', createdAt: 1, archived: false }],
      customCatalog: [],
      gymExercises: [],
      sessions: [],
      sets: [],
      settings: { theme: 'light', autoCloseMinutes: 45, lastBackupAt: null },
    },
  };
  render(html`<${Settings} />`);
  const { input, file } = await pickFile(JSON.stringify(backup));
  await user.upload(input, file);
  expect(await screen.findByText('Backup restored')).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledWith('Replace all data with this backup?', 'Replace');
  expect(await db.gyms.count()).toBe(1);
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('import declined at confirm leaves data unchanged', async () => {
  const user = userEvent.setup();
  const confirm = vi.mocked(askConfirm).mockReset().mockResolvedValue(false);
  render(html`<${Settings} />`);
  const { input, file } = await pickFile(
    JSON.stringify({
      format: 'rwtm-backup',
      version: 1,
      exportedAt: 1,
      data: { gyms: [{ id: 'x' }], customCatalog: [], gymExercises: [], sessions: [], sets: [], settings: {} },
    }),
  );
  await user.upload(input, file);
  await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(await db.gyms.count()).toBe(0);
  expect(screen.queryByText('Backup restored')).not.toBeInTheDocument();
});

const BACKUP = {
  format: 'rwtm-backup',
  version: 1,
  exportedAt: 1,
  data: {
    gyms: [{ id: 'g1', name: 'Pasted gym', createdAt: 1, archived: false }],
    customCatalog: [],
    gymExercises: [],
    sessions: [],
    sets: [],
    settings: { theme: 'dark', autoCloseMinutes: 45, lastBackupAt: null },
  },
};

async function pasteBackup(user, text) {
  await user.click(await screen.findByRole('button', { name: 'Paste' }));
  const area = screen.getByLabelText('Backup text');
  area.focus();
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Import' }));
}

test('a pasted backup is confirmed and restored like a chosen file', async () => {
  const user = userEvent.setup();
  const confirm = vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  render(html`<${Settings} />`);
  await pasteBackup(user, JSON.stringify(BACKUP, null, 2));
  expect(await screen.findByText('Backup restored')).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledWith('Replace all data with this backup?', 'Replace');
  expect((await db.gyms.toArray()).map((g) => g.name)).toEqual(['Pasted gym']);
  expect(document.documentElement.dataset.theme).toBe('dark');
  // The paste box closes once restored.
  expect(screen.queryByLabelText('Backup text')).toBeNull();
});

test('a pasted backup inside a ```json fence with prose around it is restored', async () => {
  const user = userEvent.setup();
  vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  render(html`<${Settings} />`);
  await pasteBackup(user, 'Here is your backup:\n\n```json\n' + JSON.stringify(BACKUP) + '\n```\n\nKeep it safe {really}.');
  expect(await screen.findByText('Backup restored')).toBeInTheDocument();
  expect(await db.gyms.count()).toBe(1);
});

test('invalid pasted text shows a clear error, asks nothing and keeps the text for fixing', async () => {
  const user = userEvent.setup();
  const confirm = vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  render(html`<${Settings} />`);
  await pasteBackup(user, '{"format": "rwtm-backup", "version": 1,');
  expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid backup file. The JSON is cut off');
  await user.clear(screen.getByLabelText('Backup text'));
  await user.click(screen.getByLabelText('Backup text'));
  await user.paste('just some words');
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid backup file. No JSON found');
  await user.clear(screen.getByLabelText('Backup text'));
  await user.click(screen.getByLabelText('Backup text'));
  await user.paste('{"format": "something-else"}');
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Not a Rage with the machine backup file.');
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Backup text')).toBeInTheDocument();
});

test('copy prompt writes prompt containing "rwtm-machine" to clipboard', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  await user.click(await screen.findByRole('button', { name: 'Copy Claude prompt' }));
  expect(await screen.findByText('Copied')).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toContain('rwtm-machine');
});

test('copy prompt falls back to a read-only textarea when the clipboard throws', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  await user.click(await screen.findByRole('button', { name: 'Copy Claude prompt' }));
  const ta = await screen.findByLabelText('Claude prompt');
  expect(ta.readOnly).toBe(true);
  expect(ta.value).toContain('rwtm-machine');
});

test('auto-close minutes clamps to 5–240 and saves', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  const input = await screen.findByLabelText('Auto-close after (minutes)');
  expect(input.value).toBe('30');
  await user.clear(input);
  await user.type(input, '1000');
  await user.tab();
  await vi.waitFor(async () => expect((await getSettings()).autoCloseMinutes).toBe(240));
  await vi.waitFor(() => expect(input.value).toBe('240'));
  await user.clear(input);
  await user.type(input, '2{Enter}');
  await vi.waitFor(async () => expect((await getSettings()).autoCloseMinutes).toBe(5));
  await vi.waitFor(() => expect(input.value).toBe('5'));
  await user.clear(input);
  await user.tab();
  expect((await getSettings()).autoCloseMinutes).toBe(5);
  await vi.waitFor(() => expect(input.value).toBe('5'));
});

test('a committed auto-close value never flashes the old value before the live settings catch up', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  const input = await screen.findByLabelText('Auto-close after (minutes)');
  await user.clear(input);
  await user.type(input, '45');
  await user.tab();
  // Synchronously after blur: the write has not landed yet, the field must still show the new value.
  expect(input.value).toBe('45');
  await vi.waitFor(async () => expect((await getSettings()).autoCloseMinutes).toBe(45));
  await vi.waitFor(() => expect(input.value).toBe('45'));
});

test('Home button navigates home', async () => {
  const user = userEvent.setup();
  location.hash = '#/settings';
  render(html`<${Settings} />`);
  await user.click(await screen.findByRole('button', { name: '‹ Home' }));
  expect(location.hash).toBe('#/');
});

test('Load demo data adds the demo gyms; Remove demo data asks first and takes them away', async () => {
  const user = userEvent.setup();
  render(html`<${Settings} />`);
  await user.click(await screen.findByRole('button', { name: 'Load demo data' }));
  expect(await screen.findByText(/^Demo data loaded: 2 demo gyms, \d+ sessions$/)).toBeInTheDocument();
  expect(await db.gyms.count()).toBe(2);
  await user.click(await screen.findByRole('button', { name: 'Remove demo data' }));
  await user.click(
    within(await screen.findByRole('dialog', { name: 'Remove demo data?' })).getByRole('button', { name: 'Remove' }),
  );
  await vi.waitFor(async () => expect(await db.gyms.count()).toBe(0), { timeout: 5000 });
  expect(await db.sets.count()).toBe(0);
  expect(await screen.findByRole('button', { name: 'Load demo data' })).toBeInTheDocument();
}, 20_000);
