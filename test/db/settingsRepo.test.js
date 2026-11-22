import { beforeEach, expect, test } from 'vitest';
import { resetDb } from '../../app/js/db/db.js';
import { getSettings, updateSettings } from '../../app/js/db/settingsRepo.js';

beforeEach(resetDb);

test('settings defaults and patch', async () => {
  expect(await getSettings()).toEqual({ theme: 'system', autoCloseMinutes: 30, lastBackupAt: null });
  expect(await updateSettings({ theme: 'dark' })).toEqual({ theme: 'dark', autoCloseMinutes: 30, lastBackupAt: null });
  await updateSettings({ lastBackupAt: 5 });
  expect(await getSettings()).toEqual({ theme: 'dark', autoCloseMinutes: 30, lastBackupAt: 5 });
});
