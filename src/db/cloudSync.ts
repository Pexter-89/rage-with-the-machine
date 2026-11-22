import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable } from 'dexie';
import type { RwtmDB } from './db';

/**
 * Cloud sync for the Claude artifact build.
 *
 * Dexie stays the local working store (screens, repos and useLiveQuery are unchanged). The artifact's
 * `db` capability is the source of truth: each Dexie table is mirrored one-to-one by a collection of the
 * same name, one document per row, document id = the row's primary key (encoded with `encodeDocId` when
 * it has characters a doc id cannot hold), document body = the row as plain JSON.
 *
 * - `start()` waits for every collection's first confirmed snapshot (time-limited) and REPLACES Dexie's
 *   contents with it.
 * - A DBCore middleware records the primary keys every local write touches; a debounced pump then reads
 *   the committed row and writes it (or deletes the doc) when it differs from what the cloud is known to
 *   hold. One write at a time per doc; failures stay queued, are retried, and are shown via `status`.
 * - One `onSnapshot` per collection applies remote changes (Claude editing through its tools) into Dexie
 *   inside transactions the middleware ignores; echoes of our own writes match the known cloud state and
 *   are skipped.
 */

export const TABLES = ['gyms', 'customCatalog', 'gymExercises', 'sessions', 'sets', 'kv'] as const;
export type TableName = (typeof TABLES)[number];
export const PRIMARY_KEY: Record<TableName, string> = {
  gyms: 'id',
  customCatalog: 'id',
  gymExercises: 'id',
  sessions: 'id',
  sets: 'id',
  kv: 'key',
};
/** The artifact database holds at most this many documents in total. */
export const CLOUD_DOC_LIMIT = 25_000;
export const LOAD_TIMEOUT_MS = 10_000;

// ---- the structural subset of the `db` capability this module uses ----

export interface CloudError {
  code: string;
  message: string;
}
export interface CloudDocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface CloudQuerySnapshot {
  docs: CloudDocSnapshot[];
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}
export interface CloudDocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
export interface CloudCollection {
  doc(id: string): CloudDocRef;
  onSnapshot(next: (snap: CloudQuerySnapshot) => void, error?: (e: CloudError) => void): () => void;
}
export interface CloudDb {
  collection(path: string): CloudCollection;
}

// ---- doc ids ----

const SAFE_CHAR = /^[A-Za-z0-9_\-.:@+]$/;
const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A row's primary key as a doc id: allowed characters stay, anything else (and `~`, the escape) becomes
 * `~XX` per UTF-8 byte. `''` is `~`; a key of only dots is fully escaped; a very long key is cut and
 * suffixed with a hash. The body always carries the real key, so reading never depends on decoding.
 */
export function encodeDocId(key: string): string {
  if (key === '') return '~';
  const enc = new TextEncoder();
  const onlyDots = /^\.+$/.test(key);
  let out = '';
  for (const ch of key) {
    if (SAFE_CHAR.test(ch) && !(onlyDots && ch === '.')) out += ch;
    else for (const b of enc.encode(ch)) out += '~' + hex2(b);
  }
  if (out.length > 180) out = `${out.slice(0, 160)}~~${fnv1a(key)}`;
  return out;
}

export function decodeDocId(id: string): string {
  if (id === '~') return '';
  const bytes: number[] = [];
  let out = '';
  const flush = () => {
    if (bytes.length) out += new TextDecoder().decode(new Uint8Array(bytes.splice(0)));
  };
  for (let i = 0; i < id.length; i++) {
    if (id[i] === '~' && /^[0-9A-F]{2}$/.test(id.slice(i + 1, i + 3))) {
      bytes.push(parseInt(id.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      flush();
      out += id[i];
    }
  }
  flush();
  return out;
}

// ---- JSON ----

/** A row as plain JSON: `undefined` fields are dropped, non-finite numbers become null. */
export function toCloud(row: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

/** Key-order-independent JSON, for comparing a row with what the cloud holds. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// ---- persistence of unconfirmed writes (so a reload during a failed write loses nothing) ----

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PENDING_KEY = 'rwtm-cloud-pending-v1';

export function safeLocalStorage(): KeyValueStorage | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

// ---- status ----

export interface SyncStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** Why loading failed (phase 'error'). */
  error: string | null;
  /** Local changes not yet confirmed by the cloud. */
  pending: number;
  /** Changes whose last write failed; they stay queued. */
  failed: number;
  /** The latest write failure, for the banner. */
  failMessage: string | null;
  /** The live connection ended (access revoked etc.): changes stay on this device. */
  disconnected: boolean;
}

type Pending = { table: TableName; pk: string };
type Incoming = { json: string; row: () => Record<string, unknown> };
const keyOf = (table: string, pk: string) => `${table}\u0000${pk}`;
const TRANSIENT = new Set(['unavailable', 'resource_exhausted']);
const MAX_INFLIGHT = 4;

function errCode(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e && typeof (e as CloudError).code === 'string'
    ? (e as CloudError).code
    : 'unavailable';
}

function errText(e: unknown): string {
  const code = errCode(e);
  if (code === 'quota_exceeded') return 'Cloud storage is full';
  if (code === 'revoked' || code === 'not_granted') return 'No access to cloud storage';
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as CloudError).message) : String(e);
  return msg || code;
}

export class CloudLoadError extends Error {}

interface Listener {
  unsub: (() => void) | null;
  docs: CloudDocSnapshot[] | null;
  dead: CloudError | null;
}

export interface CloudSyncOptions {
  storage?: KeyValueStorage | null;
  timeoutMs?: number;
  /** Delay before local writes are pushed, so bursts coalesce. */
  debounceMs?: number;
  retryBaseMs?: number;
}

export class CloudSync {
  private readonly cloud: CloudDb;
  private readonly database: RwtmDB;
  private readonly storage: KeyValueStorage | null;
  private readonly timeoutMs: number;
  private readonly debounceMs: number;
  private readonly retryBaseMs: number;

  /** What the cloud is known to hold: table → pk → stable JSON. */
  private readonly known = new Map<TableName, Map<string, string>>(TABLES.map((t) => [t, new Map()]));
  private readonly dirty = new Map<string, Pending>();
  private readonly inflight = new Set<string>();
  private readonly failed = new Map<string, Pending>();
  /** Rows whose write started but is not confirmed: persisted, re-applied after a reload. */
  private readonly unconfirmed = new Map<string, { table: TableName; pk: string; row: Record<string, unknown> | null }>();
  private readonly remoteTrans = new WeakSet<object>();
  private readonly listeners = new Map<TableName, Listener>();
  private readonly jsonCache = new WeakMap<object, string>();
  private live = false;
  private stopped = false;
  private applyChain: Promise<void> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay: number;
  private waiters: (() => void)[] = [];
  private idleWaiters: (() => void)[] = [];
  private subscribers = new Set<() => void>();
  private snapshot: SyncStatus = {
    phase: 'idle',
    error: null,
    pending: 0,
    failed: 0,
    failMessage: null,
    disconnected: false,
  };

  constructor(database: RwtmDB, cloud: CloudDb, options: CloudSyncOptions = {}) {
    this.database = database;
    this.cloud = cloud;
    this.storage = options.storage === undefined ? safeLocalStorage() : options.storage;
    this.timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS;
    this.debounceMs = options.debounceMs ?? 250;
    this.retryBaseMs = options.retryBaseMs ?? 2000;
    this.retryDelay = this.retryBaseMs;
    this.installMiddleware();
  }

  // ---------- status ----------

  getStatus = (): SyncStatus => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  };

  private setStatus(patch: Partial<SyncStatus>): void {
    const next: SyncStatus = {
      ...this.snapshot,
      ...patch,
      pending: this.dirty.size + this.inflight.size,
      failed: this.failed.size,
    };
    if (next.failed === 0) next.failMessage = null;
    const prev = this.snapshot;
    if ((Object.keys(next) as (keyof SyncStatus)[]).some((k) => next[k] !== prev[k])) {
      this.snapshot = next;
      this.subscribers.forEach((fn) => fn());
    }
    if (this.isIdle()) this.idleWaiters.splice(0).forEach((fn) => fn());
  }

  private isIdle(): boolean {
    return this.dirty.size === 0 && this.inflight.size === 0 && this.flushTimer === undefined;
  }

  /** Resolves once every queued local change has been written (or has failed). For tests and bulk operations. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---------- local → cloud ----------

  private installMiddleware(): void {
    const db = this.database;
    const wasOpen = db.isOpen();
    if (wasOpen) db.close();
    db.use({
      stack: 'dbcore',
      name: 'rwtm-cloud-sync',
      create: (down: DBCore): DBCore => ({
        ...down,
        table: (name: string): DBCoreTable => {
          const table = down.table(name);
          if (!(TABLES as readonly string[]).includes(name)) return table;
          return {
            ...table,
            mutate: async (req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> => {
              const res = await table.mutate(req);
              if (!this.remoteTrans.has(req.trans as object)) this.record(name as TableName, req, res);
              return res;
            },
          };
        },
      }),
    });
    if (wasOpen) void db.open();
  }

  private record(table: TableName, req: DBCoreMutateRequest, res: DBCoreMutateResponse): void {
    if (this.stopped) return;
    let keys: unknown[] = [];
    if (req.type === 'add' || req.type === 'put') {
      const pk = PRIMARY_KEY[table];
      keys = (res.results as unknown[] | undefined) ?? req.keys ?? req.values.map((v) => (v as Record<string, unknown>)[pk]);
    } else if (req.type === 'delete') {
      keys = req.keys;
    } else if (req.type === 'deleteRange') {
      // clear() and ranged deletes don't list their keys: re-check every doc the cloud holds for this table.
      keys = [...this.known.get(table)!.keys()];
    }
    for (const k of keys) {
      if (k === undefined || k === null) continue;
      const pk = String(k);
      this.dirty.set(keyOf(table, pk), { table, pk });
    }
    this.scheduleFlush();
  }

  private scheduleFlush(delay = this.debounceMs): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.pump();
    }, delay);
    this.setStatus({});
  }

  private pump(): void {
    if (this.stopped || !this.live) {
      this.setStatus({});
      return;
    }
    for (const [key, p] of this.dirty) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      if (this.inflight.has(key)) continue;
      this.dirty.delete(key);
      this.inflight.add(key);
      void this.flushOne(key, p).finally(() => {
        this.inflight.delete(key);
        this.pump();
      });
    }
    this.setStatus({});
  }

  private async flushOne(key: string, { table, pk }: Pending): Promise<void> {
    const known = this.known.get(table)!;
    const prev = known.get(pk) ?? null;
    let data: Record<string, unknown> | null;
    try {
      const row = await this.database.table(table).get(pk);
      data = row === undefined ? null : toCloud(row);
    } catch (e) {
      console.error('Cloud sync could not read a local row', e);
      this.fail(key, { table, pk }, e);
      return;
    }
    const json = data === null ? null : stableJson(data);
    if (json === prev) {
      this.failed.delete(key);
      if (this.unconfirmed.delete(key)) this.persist();
      return;
    }
    this.unconfirmed.set(key, { table, pk, row: data });
    this.persist();
    // Optimistic: the snapshot echo of this write then matches and is ignored.
    if (json === null) known.delete(pk);
    else known.set(pk, json);
    const ref = this.cloud.collection(table).doc(encodeDocId(pk));
    try {
      if (data === null) await ref.delete();
      else await ref.set(data);
      this.failed.delete(key);
      this.retryDelay = this.retryBaseMs;
      if (this.unconfirmed.get(key)?.row === data) {
        this.unconfirmed.delete(key);
        this.persist();
      }
    } catch (e) {
      if ((known.get(pk) ?? null) === json) {
        if (prev === null) known.delete(pk);
        else known.set(pk, prev);
      }
      this.fail(key, { table, pk }, e);
    }
  }

  private fail(key: string, p: Pending, e: unknown): void {
    console.error(`Cloud write failed for ${p.table}/${p.pk}`, e);
    this.failed.set(key, p);
    this.setStatus({ failMessage: errText(e) });
    const code = errCode(e);
    if (code === 'revoked' || code === 'not_granted' || code.startsWith('capability_')) return;
    if (TRANSIENT.has(code) || !['invalid_argument', 'quota_exceeded', 'transform_error'].includes(code)) {
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.stopped) return;
    const delay = this.retryDelay * (0.75 + Math.random() * 0.5);
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retry();
    }, delay);
  }

  /** Re-queues every failed write now. */
  retry(): void {
    for (const [key, p] of this.failed) {
      this.failed.delete(key);
      this.dirty.set(key, p);
    }
    this.pump();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (this.unconfirmed.size === 0) this.storage.removeItem(PENDING_KEY);
      else this.storage.setItem(PENDING_KEY, JSON.stringify([...this.unconfirmed.values()]));
    } catch {
      // storage is best-effort; the in-memory queue still retries
    }
  }

  private readPersisted(): { table: TableName; pk: string; row: Record<string, unknown> | null }[] {
    try {
      const raw = this.storage?.getItem(PENDING_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(
        (e): e is { table: TableName; pk: string; row: Record<string, unknown> | null } =>
          !!e && (TABLES as readonly string[]).includes(e.table) && typeof e.pk === 'string',
      );
    } catch {
      return [];
    }
  }

  // ---------- cloud → local ----------

  private pkOf(table: TableName, doc: CloudDocSnapshot, data: Record<string, unknown>): string {
    const v = data[PRIMARY_KEY[table]];
    return typeof v === 'string' ? v : decodeDocId(doc.id);
  }

  /** Each delivered doc body as { pk, json, row() }; unchanged bodies are the same frozen object, so json is cached. */
  private rowsOf(table: TableName, docs: CloudDocSnapshot[]): Map<string, Incoming> {
    const out = new Map<string, Incoming>();
    const pkField = PRIMARY_KEY[table];
    for (const doc of docs) {
      if (!doc.exists) continue;
      const data = doc.data();
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const pk = this.pkOf(table, doc, data);
      let json = this.jsonCache.get(data);
      if (json === undefined) {
        json = stableJson({ ...data, [pkField]: pk });
        this.jsonCache.set(data, json);
      }
      out.set(pk, { json, row: () => ({ ...toCloud(data), [pkField]: pk }) });
    }
    return out;
  }

  private localPending(key: string): boolean {
    return this.dirty.has(key) || this.inflight.has(key) || this.failed.has(key) || this.unconfirmed.has(key);
  }

  /** Writes to Dexie inside a transaction the middleware ignores. */
  private async remoteWrite(tables: TableName[], body: () => Promise<void>): Promise<void> {
    const db = this.database;
    await db.transaction('rw', tables.map((t) => db.table(t)), async (tx) => {
      this.remoteTrans.add(tx.idbtrans as object);
      await body();
    });
  }

  /** Diffs a collection's full snapshot against what we know and applies the difference locally. */
  private applySnapshot(table: TableName, docs: CloudDocSnapshot[]): Promise<void> {
    const run = async () => {
      if (this.stopped) return;
      const known = this.known.get(table)!;
      const incoming = this.rowsOf(table, docs);
      const puts: Record<string, unknown>[] = [];
      const dels: string[] = [];
      for (const [pk, { row, json }] of incoming) {
        if (known.get(pk) === json || this.localPending(keyOf(table, pk))) continue;
        known.set(pk, json);
        puts.push(row());
      }
      for (const pk of [...known.keys()]) {
        if (incoming.has(pk) || this.localPending(keyOf(table, pk))) continue;
        known.delete(pk);
        dels.push(pk);
      }
      if (!puts.length && !dels.length) return;
      await this.remoteWrite([table], async () => {
        const t = this.database.table(table);
        if (dels.length) await t.bulkDelete(dels);
        if (puts.length) await t.bulkPut(puts);
      });
    };
    this.applyChain = this.applyChain.then(run).catch((e) => console.error('Could not apply a cloud change', e));
    return this.applyChain;
  }

  private subscribeAll(): void {
    for (const table of TABLES) {
      const existing = this.listeners.get(table);
      if (existing && !existing.dead) continue;
      const l: Listener = { unsub: null, docs: null, dead: null };
      this.listeners.set(table, l);
      l.unsub = this.cloud.collection(table).onSnapshot(
        (snap) => {
          if (this.stopped || this.listeners.get(table) !== l) return;
          if (snap.metadata.fromCache && l.docs === null) return; // wait for the confirmed read
          l.docs = snap.docs;
          if (this.live) void this.applySnapshot(table, snap.docs);
          else this.waiters.splice(0).forEach((fn) => fn());
        },
        (e) => {
          if (this.listeners.get(table) !== l) return;
          l.dead = e;
          l.unsub = null;
          if (!this.live) {
            this.waiters.splice(0).forEach((fn) => fn());
            return;
          }
          console.error(`Cloud listener for ${table} ended`, e);
          if (e.code === 'unavailable' && !this.stopped) {
            setTimeout(() => this.subscribeAll(), 3000 + Math.random() * 2000);
          } else {
            this.setStatus({ disconnected: true });
          }
        },
      );
    }
  }

  /**
   * Loads every collection and replaces Dexie's contents with it, then goes live. Rejects with a
   * `CloudLoadError` on timeout or a listener error; listeners that are still alive are kept, so calling
   * `start()` again is the retry.
   */
  async start(): Promise<void> {
    this.setStatus({ phase: 'loading', error: null });
    try {
      this.subscribeAll();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== check);
          reject(new CloudLoadError('Your data could not be loaded from the cloud (no answer in 10 seconds).'));
        }, this.timeoutMs);
        const check = () => {
          const ls = TABLES.map((t) => this.listeners.get(t)!);
          const dead = ls.find((l) => l.dead);
          if (dead) {
            clearTimeout(timer);
            reject(new CloudLoadError(`Your data could not be loaded from the cloud: ${errText(dead.dead)}.`));
          } else if (ls.every((l) => l.docs !== null)) {
            clearTimeout(timer);
            resolve();
          } else {
            this.waiters.push(check);
          }
        };
        check();
      });
      await this.hydrate();
    } catch (e) {
      this.setStatus({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    this.setStatus({ phase: 'ready', error: null });
  }

  private async hydrate(): Promise<void> {
    const used = new Map<TableName, CloudDocSnapshot[]>();
    const all = new Map<TableName, Map<string, Incoming>>();
    for (const t of TABLES) {
      const docs = this.listeners.get(t)!.docs!;
      used.set(t, docs);
      all.set(t, this.rowsOf(t, docs));
    }
    await this.remoteWrite([...TABLES], async () => {
      for (const t of TABLES) {
        const table = this.database.table(t);
        await table.clear();
        await table.bulkPut([...all.get(t)!.values()].map((r) => r.row()));
      }
    });
    for (const t of TABLES) {
      const known = this.known.get(t)!;
      known.clear();
      for (const [pk, { json }] of all.get(t)!) known.set(pk, json);
    }
    this.live = true;
    // Snapshots that arrived while Dexie was being replaced.
    for (const t of TABLES) {
      const docs = this.listeners.get(t)!.docs!;
      if (docs !== used.get(t)) void this.applySnapshot(t, docs);
    }
    // Writes from an earlier visit that were never confirmed: re-apply locally, which queues them again.
    const leftovers = this.readPersisted().filter((p) => {
      const cur = this.known.get(p.table)!.get(p.pk) ?? null;
      return (p.row === null ? null : stableJson(p.row)) !== cur;
    });
    this.unconfirmed.clear();
    for (const p of leftovers) this.unconfirmed.set(keyOf(p.table, p.pk), p);
    this.persist();
    for (const p of leftovers) {
      const table = this.database.table(p.table);
      try {
        if (p.row === null) await table.delete(p.pk);
        else await table.put(p.row);
      } catch (e) {
        console.error('Could not re-apply an unsaved change', e);
      }
    }
    this.pump();
  }

  /** Waits for remote changes already received to be applied locally (tests). */
  settled(): Promise<void> {
    return this.applyChain;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    for (const l of this.listeners.values()) l.unsub?.();
    this.listeners.clear();
  }
}

// ---- the app-wide instance (artifact build) ----

let active: CloudSync | null = null;

export function activeCloudSync(): CloudSync | null {
  return active;
}

export function setActiveCloudSync(sync: CloudSync | null): void {
  active = sync;
}

/** Resolves the artifact's `db` capability, or null when this page is not running as an artifact with it. */
export async function resolveCloudDb(timeoutMs = 12_000): Promise<CloudDb | null> {
  const use = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude?.use;
  if (typeof use !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const ns = await Promise.race([Promise.resolve().then(() => use.call((globalThis as { claude?: unknown }).claude, 'db')), timeout]);
    return (ns as CloudDb | null) ?? null;
  } catch (e) {
    console.error('The db capability could not be resolved', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Total rows a backup would put in the cloud (one document per row, plus the settings document). */
export function backupDocCount(data: Record<string, unknown>): number {
  return TABLES.filter((t) => t !== 'kv').reduce((n, t) => n + (Array.isArray(data[t]) ? (data[t] as unknown[]).length : 0), 1);
}
