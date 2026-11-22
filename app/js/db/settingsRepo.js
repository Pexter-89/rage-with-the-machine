import { db } from './db.js';

const KEY = 'settings';
const DEFAULTS = { theme: 'system', autoCloseMinutes: 30, lastBackupAt: null };

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const row = await db.kv.get(KEY);
  return { ...DEFAULTS, ...(row?.value ?? {}) };
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>}
 */
export async function updateSettings(patch) {
  return db.transaction('rw', db.kv, async () => {
    const next = { ...(await getSettings()), ...patch };
    await db.kv.put({ key: KEY, value: next });
    return next;
  });
}
