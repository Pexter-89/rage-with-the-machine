import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'session'; sessionId: string }
  | { name: 'pick'; sessionId: string }
  | { name: 'log'; sessionId: string; key: string }
  | { name: 'gyms' }
  | { name: 'gym'; gymId: string }
  | { name: 'exercise'; gymId: string; geId: string | 'new'; catalogId?: string }
  | { name: 'progress' }
  | { name: 'settings' };

const enc = encodeURIComponent;

export function toHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'session':
      return `#/session/${enc(r.sessionId)}`;
    case 'pick':
      return `#/session/${enc(r.sessionId)}/pick`;
    case 'log':
      return `#/session/${enc(r.sessionId)}/log/${enc(r.key)}`;
    case 'gyms':
      return '#/gyms';
    case 'gym':
      return `#/gym/${enc(r.gymId)}`;
    case 'exercise':
      return `#/gym/${enc(r.gymId)}/exercise/${enc(r.geId)}` + (r.catalogId ? `?catalog=${enc(r.catalogId)}` : '');
    case 'progress':
      return '#/progress';
    case 'settings':
      return '#/settings';
  }
}

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  try {
    const d = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (d[0] === 'session' && d[1]) {
      if (d.length === 2) return { name: 'session', sessionId: d[1] };
      if (d.length === 3 && d[2] === 'pick') return { name: 'pick', sessionId: d[1] };
      if (d.length === 4 && d[2] === 'log') return { name: 'log', sessionId: d[1], key: d[3] };
    } else if (d[0] === 'gyms' && d.length === 1) {
      return { name: 'gyms' };
    } else if (d[0] === 'gym' && d[1]) {
      if (d.length === 2) return { name: 'gym', gymId: d[1] };
      if (d.length === 4 && d[2] === 'exercise') {
        const catalogId = new URLSearchParams(query).get('catalog') ?? undefined;
        return catalogId
          ? { name: 'exercise', gymId: d[1], geId: d[3], catalogId }
          : { name: 'exercise', gymId: d[1], geId: d[3] };
      }
    } else if (d[0] === 'progress' && d.length === 1) {
      return { name: 'progress' };
    } else if (d[0] === 'settings' && d.length === 1) {
      return { name: 'settings' };
    }
  } catch {
    // malformed percent-encoding falls through to home
  }
  return { name: 'home' };
}

/** The menu level above `r`; null for Home. Logging sits under its session, like the exercise picker. */
export function parentOf(r: Route): Route | null {
  switch (r.name) {
    case 'home':
      return null;
    case 'session':
    case 'gyms':
    case 'progress':
    case 'settings':
      return { name: 'home' };
    case 'pick':
    case 'log':
      return { name: 'session', sessionId: r.sessionId };
    case 'gym':
      return { name: 'gyms' };
    case 'exercise':
      return { name: 'gym', gymId: r.gymId };
  }
}

/** Home first, `r` last. */
export function chainOf(r: Route): Route[] {
  const out: Route[] = [];
  for (let x: Route | null = r; x; x = parentOf(x)) out.unshift(x);
  return out;
}

// ---- history ----
//
// The browser history mirrors the menu hierarchy: one entry per level from Home down to the current screen,
// plus one entry per open sheet ("layer"). The phone's back button therefore always goes up one level (or
// closes the sheet), never back to whichever screen happened to be visited before.
// Every entry we create carries `{ rwtm: depth }`; an entry without it (the first load, a test setting
// location.hash) means the entries below are unknown, so navigation replaces instead of going back.

interface Layer {
  token: number;
  close(): void;
  /** Whether the layer has its own history entry. */
  entry: boolean;
}

type Op = () => boolean; // true: the op started a history traversal and the queue waits for its popstate

let layers: Layer[] = [];
let layerSeq = 0;
const queue: Op[] = [];
let waiting = false;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let current = typeof location === 'undefined' ? '' : location.hash;
const listeners = new Set<() => void>();

const depthOf = (hash: string) => chainOf(parseRoute(hash)).length - 1;
const entries = () => layers.filter((l) => l.entry).length;
const stateDepth = (): number | null => {
  const s: unknown = history.state;
  return typeof s === 'object' && s !== null && typeof (s as { rwtm?: unknown }).rwtm === 'number'
    ? (s as { rwtm: number }).rwtm
    : null;
};

function emit(): void {
  if (location.hash === current) return;
  current = location.hash;
  for (const l of listeners) l();
}

function pump(): void {
  while (!waiting && queue.length > 0) {
    const op = queue.shift()!;
    if (op()) {
      waiting = true;
      // A traversal that never reports back (it should not happen) must not wedge navigation.
      clearTimeout(waitTimer);
      waitTimer = setTimeout(settle, 1000);
    }
  }
}

function settle(): void {
  clearTimeout(waitTimer);
  waiting = false;
  // Run the follow-up first (e.g. pushing down to the target) so the intermediate entry never renders.
  pump();
  if (!waiting) emit();
}

function enqueue(op: Op): void {
  queue.push(op);
  pump();
}

function go(delta: number): boolean {
  history.go(delta);
  return true;
}

function onPopState(): void {
  if (waiting) {
    settle();
    return;
  }
  // The user pressed back (or forward). Back from a sheet closes the sheet; otherwise show the new entry.
  const d = stateDepth();
  const top = layers[layers.length - 1];
  if (top?.entry && (d === null || d < depthOf(current) + entries())) {
    layers.pop();
    top.close();
    return;
  }
  layers = [];
  emit();
}

let installed = false;

/**
 * Starts listening to history and makes the stack match the current route's chain (unless it already does,
 * e.g. after a reload). Call once before the first render.
 */
export function installRouter(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', () => {
    if (!waiting) emit();
  });
  const chain = chainOf(parseRoute(location.hash)).map(toHash);
  if (stateDepth() !== chain.length - 1) {
    history.replaceState({ rwtm: 0 }, '', chain[0]);
    chain.slice(1).forEach((h, i) => history.pushState({ rwtm: i + 1 }, '', h));
  }
  current = location.hash;
}

export function navigate(r: Route): void {
  enqueue(() => {
    const target = chainOf(r).map(toHash);
    const here = chainOf(parseRoute(location.hash)).map(toHash);
    let k = 0;
    while (k < target.length && k < here.length && target[k] === here[k]) k++;
    const back = here.length - k + entries();
    const known = stateDepth() === here.length - 1 + entries();
    layers = [];
    const rest = target.slice(k);
    if (!known || (back === 0 && rest.length === 0)) {
      // Unknown history below (or already there): replace the current entry. Unmarked, so it stays unknown.
      const last = target[target.length - 1];
      if (location.hash !== last) history.replaceState(known ? history.state : null, '', last);
      emit();
      return false;
    }
    if (back === 0) {
      rest.forEach((h, i) => history.pushState({ rwtm: k + i }, '', h));
      emit();
      return false;
    }
    // Go up to the common ancestor, then push down to the target once the traversal lands.
    if (rest.length > 0) {
      queue.unshift(() => {
        rest.forEach((h, i) => history.pushState({ rwtm: k + i }, '', h));
        emit();
        return false;
      });
    }
    return go(-back);
  });
}

/** Goes up one menu level, like the phone's back button. */
export function navigateUp(r: Route): void {
  const p = parentOf(r);
  if (p) navigate(p);
}

/** A sheet opened: the back button closes it. Returns a token for `closeLayer`. */
export function openLayer(close: () => void): number {
  const token = ++layerSeq;
  enqueue(() => {
    // Only add a history entry when the entries below are ours; otherwise back could not be matched to it.
    const entry = stateDepth() === depthOf(location.hash) + entries();
    layers.push({ token, close, entry });
    if (entry) history.pushState({ rwtm: depthOf(location.hash) + entries() }, '', location.href);
    return false;
  });
  return token;
}

/** The sheet closed itself (Cancel, backdrop, done): drop its history entry. No-op if back already closed it. */
export function closeLayer(token: number): void {
  enqueue(() => {
    const i = layers.findIndex((l) => l.token === token);
    if (i === -1) return false;
    const n = layers.slice(i).filter((l) => l.entry).length;
    layers = layers.slice(0, i);
    return n > 0 ? go(-n) : false;
  });
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // Without installRouter (tests rendering a screen), still follow hash changes.
      const on = () => {
        if (!waiting) emit();
      };
      window.addEventListener('hashchange', on);
      return () => {
        listeners.delete(l);
        window.removeEventListener('hashchange', on);
      };
    },
    // Mid-traversal the address shows an intermediate entry; keep showing the last settled one.
    () => (waiting ? current : location.hash),
  );
  return parseRoute(hash);
}
