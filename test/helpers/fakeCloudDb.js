/** @typedef {{ next: (s: CloudQuerySnapshot) => void, error?: (e: CloudError) => void }} Listener */

/** In-memory stand-in for the artifact `db` capability (collections of single-level docs only). */
export class FakeCloudDb {
  store = new Map();
  writes = [];
  listeners = new Map();
  snaps = new WeakMap();
  /** Codes for the next writes to reject with, in order. */
  failNext = [];
  /** When true, listeners never answer (simulates a store that cannot be reached). */
  silent = false;

  /** @param {string} name */
  coll(name) {
    let c = this.store.get(name);
    if (!c) this.store.set(name, (c = new Map()));
    return c;
  }

  /**
   * @param {string} id
   * @param {Readonly<Record<string, unknown>>} data
   * @returns {CloudDocSnapshot}
   */
  snapOf(id, data) {
    let s = this.snaps.get(data);
    if (!s) {
      s = { id, exists: true, data: () => data };
      this.snaps.set(data, s);
    }
    return s;
  }

  /**
   * @param {string} name
   * @param {Listener} [l]
   */
  emit(name, l) {
    const docs = [...this.coll(name)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, d]) => this.snapOf(id, d));
    const snap = { docs, metadata: { fromCache: false, hasPendingWrites: false } };
    for (const x of l ? [l] : (this.listeners.get(name) ?? [])) x.next(snap);
  }

  /**
   * Writes as another client would (e.g. Claude through its tools).
   * @param {string} collection
   * @param {string} id
   * @param {Record<string, unknown>} data
   */
  remoteSet(collection, id, data) {
    this.coll(collection).set(id, Object.freeze(structuredClone(data)));
    this.emit(collection);
  }

  /**
   * @param {string} collection
   * @param {string} id
   */
  remoteDelete(collection, id) {
    this.coll(collection).delete(id);
    this.emit(collection);
  }

  /**
   * @param {string} collection
   * @param {string} id
   */
  get(collection, id) {
    return this.coll(collection).get(id);
  }

  /** @param {string} collection */
  terminate(collection, code = 'revoked') {
    for (const l of this.listeners.get(collection) ?? []) l.error?.({ code, message: code });
    this.listeners.delete(collection);
  }

  /** @param {string} name */
  collection(name) {
    const write = async (op, id, data) => {
      await Promise.resolve();
      const code = this.failNext.shift();
      if (code) throw { code, message: `fake ${code}` };
      this.writes.push({ op, path: `${name}/${id}`, data });
      if (op === 'set') this.coll(name).set(id, Object.freeze(JSON.parse(JSON.stringify(data))));
      else this.coll(name).delete(id);
      this.emit(name);
    };
    return {
      doc: (id) => ({
        set: (data) => write('set', id, data),
        delete: () => write('delete', id),
      }),
      onSnapshot: (next, error) => {
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
