import { applyTheme, bootstrap } from './bootstrap';
import { resetDb } from './db/db';
import { updateSettings } from './db/settingsRepo';

beforeEach(async () => {
  await resetDb();
});

test('applyTheme sets explicit themes and tolerates a missing matchMedia', () => {
  applyTheme('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  applyTheme('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(typeof matchMedia).toBe('undefined');
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('bootstrap applies the stored theme without storage.persist', async () => {
  await updateSettings({ theme: 'light' });
  await bootstrap();
  expect(document.documentElement.dataset.theme).toBe('light');
});
