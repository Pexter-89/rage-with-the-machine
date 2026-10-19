import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, resetDb } from '../../db/db';
import { getSettings } from '../../db/settingsRepo';
import { shareOrDownload } from '../lib/share';
import Settings from './Settings';

vi.mock('../lib/share', async (orig) => ({
  ...(await orig<typeof import('../lib/share')>()),
  shareOrDownload: vi.fn(async () => true),
}));

beforeEach(async () => {
  await resetDb();
  location.hash = '';
  vi.mocked(shareOrDownload).mockReset();
  vi.mocked(shareOrDownload).mockImplementation(async () => true);
});

const pad = (n: number) => String(n).padStart(2, '0');

test('theme change persists and sets data-theme', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: 'Light' }));
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  await vi.waitFor(async () => expect((await getSettings()).theme).toBe('light'));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true'));
  await user.click(screen.getByRole('button', { name: 'Dark' }));
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
});

test('export backup calls shareOrDownload with dated filename and updates last backup text to "today"', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  expect(await screen.findByText('Last backup: never')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Export backup' }));
  const d = new Date();
  const name = `rwtm-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
  const [filename, blob] = vi.mocked(shareOrDownload).mock.calls[0];
  expect(filename).toBe(name);
  expect(blob.type).toBe('application/json');
  expect(await screen.findByText('Last backup: today')).toBeInTheDocument();
  expect((await getSettings()).lastBackupAt).not.toBeNull();
});

test('export backup failure shows inline error and does not update last backup', async () => {
  const user = userEvent.setup();
  vi.mocked(shareOrDownload).mockRejectedValue(new Error('boom'));
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: 'Export backup' }));
  expect(await screen.findByText('boom')).toBeInTheDocument();
  expect((await getSettings()).lastBackupAt).toBeNull();
});

test('a cancelled backup share does not stamp the last backup', async () => {
  const user = userEvent.setup();
  vi.mocked(shareOrDownload).mockResolvedValue(false);
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: 'Export backup' }));
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
  // Let any stamping write land before checking it did not happen.
  await new Promise((r) => setTimeout(r, 50));
  expect((await getSettings()).lastBackupAt).toBeNull();
  expect(screen.getByText('Last backup: never')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('export CSV uses BOM, csv type and dated filename', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1));
  const [filename, blob] = vi.mocked(shareOrDownload).mock.calls[0];
  expect(filename).toMatch(/^rwtm-sets-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(blob.type).toBe('text/csv;charset=utf-8');
  const bytes = new Uint8Array(await new Promise<ArrayBuffer>((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(blob); }));
  expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toMatch(/^﻿date,time/);
});

async function pickFile(content: string) {
  const input = (await screen.findByLabelText('Backup file')) as HTMLInputElement;
  return { input, file: new File([content], 'b.json', { type: 'application/json' }) };
}

test('import of invalid backup shows error and does not ask to confirm', async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<Settings />);
  const a = await pickFile(JSON.stringify({ format: 'nope' }));
  await user.upload(a.input, a.file);
  expect(await screen.findByText(/Not a Rage with the machine backup file/)).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();

  const b = await pickFile('not json{');
  await user.upload(b.input, b.file);
  expect(await screen.findByText('Not a valid backup file')).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test('import valid backup confirms, restores and re-applies theme', async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
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
  render(<Settings />);
  const { input, file } = await pickFile(JSON.stringify(backup));
  await user.upload(input, file);
  expect(await screen.findByText('Backup restored')).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledWith('Replace all data with this backup?');
  expect(await db.gyms.count()).toBe(1);
  expect(document.documentElement.dataset.theme).toBe('light');
  confirm.mockRestore();
});

test('import declined at confirm leaves data unchanged', async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<Settings />);
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
  confirm.mockRestore();
});

test('copy prompt writes prompt containing "rwtm-machine" to clipboard', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: 'Copy Claude prompt' }));
  expect(await screen.findByText('Copied')).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toContain('rwtm-machine');
});

test('copy prompt falls back to a read-only textarea when the clipboard throws', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  await user.click(await screen.findByRole('button', { name: 'Copy Claude prompt' }));
  const ta = (await screen.findByLabelText('Claude prompt')) as HTMLTextAreaElement;
  expect(ta.readOnly).toBe(true);
  expect(ta.value).toContain('rwtm-machine');
});

test('auto-close minutes clamps to 5–240 and saves', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  const input = (await screen.findByLabelText('Auto-close after (minutes)')) as HTMLInputElement;
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
  render(<Settings />);
  const input = (await screen.findByLabelText('Auto-close after (minutes)')) as HTMLInputElement;
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
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: '‹ Home' }));
  expect(location.hash).toBe('#/');
});

test('Load demo data adds the demo gyms; Remove demo data asks first and takes them away', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  await user.click(await screen.findByRole('button', { name: 'Load demo data' }));
  expect(await screen.findByText(/^Demo data loaded: 2 demo gyms, \d+ sessions$/)).toBeInTheDocument();
  expect(await db.gyms.count()).toBe(2);
  await user.click(await screen.findByRole('button', { name: 'Remove demo data' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Remove demo data?' })).getByRole('button', { name: 'Remove' }));
  await vi.waitFor(async () => expect(await db.gyms.count()).toBe(0), { timeout: 5000 });
  expect(await db.sets.count()).toBe(0);
  expect(await screen.findByRole('button', { name: 'Load demo data' })).toBeInTheDocument();
}, 20_000);
