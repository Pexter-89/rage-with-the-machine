import type { CloudDb, CloudDocSnapshot, CloudError, CloudQuerySnapshot } from '../db/cloudSync';

type Listener = { next: (s: CloudQuerySnapshot) => void; error?: (e: CloudError) => void };

/** In-memory stand-in for the artifact `db` capability (collections of single-level docs only). */
export class FakeCloudDb implements CloudDb {
  readonly store = new Map<string, Map<string, Readonly<Record<string, unknown>>>>();
  readonly writes: { op: 'set' | 'delete'; path: string; data?: Record<string, unknown> }[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly snaps = new WeakMap<object, CloudDocSnapshot>();
  /** Codes for the next writes to reject with, in order. */
  failNext: string[] = [];
  /** When true, listeners never answer (simulates a store that cannot be reached). */
  silent = false;

  private coll(name: string) {
    let c = this.store.get(name);
    if (!c) this.store.set(name, (c = new Map()));
    return c;
  }

  private snapOf(id: string, data: Readonly<Record<string, unknown>>): CloudDocSnapshot {
    let s = this.snaps.get(data);
    if (!s) {
      s = { id, exists: true, data: () => data as Record<string, unknown> };
      this.snaps.set(data, s);
    }
    return s;
  }

  private emit(name: string, l?: Listener) {
    const docs = [...this.coll(name)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, d]) => this.snapOf(id, d));
    const snap: CloudQuerySnapshot = { docs, metadata: { fromCache: false, hasPendingWrites: false } };
    for (const x of l ? [l] : (this.listeners.get(name) ?? [])) x.next(snap);
  }

  /** Writes as another client would (e.g. Claude through its tools). */
  remoteSet(collection: string, id: string, data: Record<string, unknown>) {
    this.coll(collection).set(id, Object.freeze(structuredClone(data)));
    this.emit(collection);
  }

  remoteDelete(collection: string, id: string) {
    this.coll(collection).delete(id);
    this.emit(collection);
  }

  get(collection: string, id: string) {
    return this.coll(collection).get(id);
  }

  terminate(collection: string, code = 'revoked') {
    for (const l of this.listeners.get(collection) ?? []) l.error?.({ code, message: code });
    this.listeners.delete(collection);
  }

  collection(name: string) {
    const write = async (op: 'set' | 'delete', id: string, data?: Record<string, unknown>) => {
      await Promise.resolve();
      const code = this.failNext.shift();
      if (code) throw { code, message: `fake ${code}` } satisfies CloudError;
      this.writes.push({ op, path: `${name}/${id}`, data });
      if (op === 'set') this.coll(name).set(id, Object.freeze(JSON.parse(JSON.stringify(data))));
      else this.coll(name).delete(id);
      this.emit(name);
    };
    return {
      doc: (id: string) => ({
        set: (data: Record<string, unknown>) => write('set', id, data),
        delete: () => write('delete', id),
      }),
      onSnapshot: (next: Listener['next'], error?: Listener['error']) => {
        const l = { next, error };
        let set = this.listeners.get(name);
        if (!set) this.listeners.set(name, (set = new Set()));
        set.add(l);
        if (!this.silent) queueMicrotask(() => this.emit(name, l));
        return () => set.delete(l);
      },
    };
  }
}
