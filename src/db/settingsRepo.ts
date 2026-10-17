import type { Settings } from '../domain/types';
import { db } from './db';

const KEY = 'settings';
const DEFAULTS: Settings = { theme: 'system', autoCloseMinutes: 30, lastBackupAt: null };

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get(KEY);
  return { ...DEFAULTS, ...((row?.value as Partial<Settings> | undefined) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return db.transaction('rw', db.kv, async () => {
    const next = { ...(await getSettings()), ...patch };
    await db.kv.put({ key: KEY, value: next });
    return next;
  });
}
