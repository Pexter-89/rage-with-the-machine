import { useSyncExternalStore } from 'react';

/**
 * @typedef {{ name: 'home' } | { name: 'session', sessionId: string } | { name: 'pick', sessionId: string } | { name: 'log', sessionId: string, key: string } | { name: 'gyms' } | { name: 'gym', gymId: string } | { name: 'exercise', gymId: string, geId: string | 'new', catalogId?: string } | { name: 'progress' } | { name: 'settings' } | { name: 'programs', gymId: string } | { name: 'program', gymId: string, programId: string | 'new' }} Route
 */

// ---- hash encoding ----
//
// The claude.ai artifact host only passes a plain `#name` (ASCII letters, digits, hyphens) between the
// artifact's link and location.hash, so a route is a word plus segments joined by `--`, e.g.
// `#session--3f2a-2d...--log--c-3abench-2dpress`. Inside a segment letters and digits stay as they are and
// every other UTF-8 byte (`-` included) becomes `-` plus two lowercase hex digits; a lone `-` is therefore
// always followed by hex, which keeps `--` unambiguous. The words avoid the names claude.ai reserves
// (`settings`, `sidebar`, `customize`, `upgrade`, `downloads`, `comment-*`): Settings is `#prefs`.
// The old `#/path` form (stored links, open tabs) still parses.

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** @param {string} s */
function encSeg(s) {
  let out = '';
  for (const b of utf8.encode(s)) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9]/.test(c) ? c : '-' + b.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * @param {string} s
 * @returns {string} Throws on anything toHash could not have produced.
 */
function decSeg(s) {
  if (!/^(?:[A-Za-z0-9]|-[0-9a-f]{2})+$/.test(s)) throw new Error('bad segment');
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '-') {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i));
  }
  return strictUtf8.decode(new Uint8Array(bytes));
}

/**
 * @param {string} word A plain route word.
 * @param {...string} segs Raw segments, encoded here.
 */
const h = (word, ...segs) => '#' + [word, ...segs.map(encSeg)].join('--');

/**
 * @param {Route} r
 * @returns {string} Always matches /^#[A-Za-z0-9-]+$/.
 */
export function toHash(r) {
  switch (r.name) {
    case 'home':
      return '#home';
    case 'session':
      return h('session', r.sessionId);
    case 'pick':
      return h('session', r.sessionId) + '--pick';
    case 'log':
      return h('session', r.sessionId) + '--log--' + encSeg(r.key);
    case 'gyms':
      return '#gyms';
    case 'gym':
      return h('gym', r.gymId);
    case 'exercise':
      return h('gym', r.gymId) + '--exercise--' + encSeg(r.geId) + (r.catalogId ? '--' + encSeg(r.catalogId) : '');
    case 'progress':
      return '#progress';
    case 'settings':
      return '#prefs';
    case 'programs':
      return h('programs', r.gymId);
    case 'program':
      return h('programs', r.gymId, r.programId);
  }
}

/**
 * The route for path segments `d` (route word first, the rest decoded); home when they name nothing.
 * @param {string[]} d
 * @param {string | undefined} catalogId
 * @param {string} settingsWord
 * @returns {Route}
 */
function routeOf(d, catalogId, settingsWord) {
  if (d[0] === 'session' && d[1]) {
    if (d.length === 2) return { name: 'session', sessionId: d[1] };
    if (d.length === 3 && d[2] === 'pick') return { name: 'pick', sessionId: d[1] };
    if (d.length === 4 && d[2] === 'log') return { name: 'log', sessionId: d[1], key: d[3] };
  } else if (d[0] === 'gyms' && d.length === 1) {
    return { name: 'gyms' };
  } else if (d[0] === 'gym' && d[1]) {
    if (d.length === 2) return { name: 'gym', gymId: d[1] };
    if (d.length === 4 && d[2] === 'exercise') {
      return catalogId
        ? { name: 'exercise', gymId: d[1], geId: d[3], catalogId }
        : { name: 'exercise', gymId: d[1], geId: d[3] };
    }
  } else if (d[0] === 'programs' && d[1]) {
    // A gym's program list (programs are gym-independent; the gym is where a tap starts one).
    if (d.length === 2) return { name: 'programs', gymId: d[1] };
    if (d.length === 3) return { name: 'program', gymId: d[1], programId: d[2] };
  } else if (d[0] === 'progress' && d.length === 1) {
    return { name: 'progress' };
  } else if (d[0] === settingsWord && d.length === 1) {
    return { name: 'settings' };
  }
  return { name: 'home' };
}

/**
 * @param {string} hash
 * @returns {Route}
 */
export function parseRoute(hash) {
  try {
    if (hash.startsWith('#/')) {
      // The old `#/path?catalog=id` form.
      const [path, query = ''] = hash.slice(2).split('?');
      const d = path.split('/').filter(Boolean).map(decodeURIComponent);
      return routeOf(d, new URLSearchParams(query).get('catalog') ?? undefined, 'settings');
    }
    const parts = hash.replace(/^#/, '').split('--');
    const d = [parts[0], ...parts.slice(1).map(decSeg)];
    // An exercise's optional catalog id is a fifth segment.
    const catalogId = d[0] === 'gym' && d[2] === 'exercise' && d.length === 5 ? d.pop() : undefined;
    return routeOf(d, catalogId, 'prefs');
  } catch {
    // malformed encoding falls through to home
  }
  return { name: 'home' };
}

/**
 * The menu level above `r`; null for Home. Logging sits under its session, like the exercise picker.
 * @param {Route} r
 * @returns {Route | null}
 */
export function parentOf(r) {
  switch (r.name) {
    case 'home':
      return null;
    case 'session':
    case 'gyms':
    case 'progress':
    case 'settings':
    case 'programs':
      return { name: 'home' };
    case 'program':
      return { name: 'programs', gymId: r.gymId };
    case 'pick':
    case 'log':
      return { name: 'session', sessionId: r.sessionId };
    case 'gym':
      return { name: 'gyms' };
    case 'exercise':
      return { name: 'gym', gymId: r.gymId };
  }
}

/**
 * Home first, `r` last.
 * @param {Route} r
 * @returns {Route[]}
 */
export function chainOf(r) {
  const out = [];
  for (let x = r; x; x = parentOf(x)) out.unshift(x);
  return out;
}

// ---- history ----
//
// The browser history mirrors the menu hierarchy: one entry per level from Home down to the current screen,
// plus one entry per open sheet ("layer"). The phone's back button therefore always goes up one level (or
// closes the sheet), never back to whichever screen happened to be visited before.
// Every entry we create carries `{ rwtm: depth }`; an entry without it (the first load, a test setting
// location.hash) means the entries below are unknown, so navigation replaces instead of going back.

/**
 * @typedef {object} Layer
 * @property {number} token
 * @property {() => void} close
 * @property {boolean} entry Whether the layer has its own history entry.
 */

/** @typedef {() => boolean} Op */
// true: the op started a history traversal and the queue waits for its popstate

let layers = [];
let layerSeq = 0;
const queue = [];
let waiting = false;
let waitTimer;
let current = typeof location === 'undefined' ? '' : location.hash;
const listeners = new Set();

/** @param {string} hash */
const depthOf = (hash) => chainOf(parseRoute(hash)).length - 1;
const entries = () => layers.filter((l) => l.entry).length;
/** @returns {number | null} */
const stateDepth = () => {
  const s = history.state;
  return typeof s === 'object' && s !== null && typeof s.rwtm === 'number' ? s.rwtm : null;
};

function emit() {
  if (location.hash === current) return;
  current = location.hash;
  for (const l of listeners) l();
}

function pump() {
  while (!waiting && queue.length > 0) {
    const op = queue.shift();
    if (op()) {
      waiting = true;
      // A traversal that never reports back (it should not happen) must not wedge navigation.
      clearTimeout(waitTimer);
      waitTimer = setTimeout(settle, 1000);
    }
  }
}

function settle() {
  clearTimeout(waitTimer);
  waiting = false;
  // Run the follow-up first (e.g. pushing down to the target) so the intermediate entry never renders.
  pump();
  if (!waiting) emit();
}

/** @param {Op} op */
function enqueue(op) {
  queue.push(op);
  pump();
}

/**
 * @param {number} delta
 * @returns {boolean}
 */
function go(delta) {
  history.go(delta);
  return true;
}

function onPopState() {
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
export function installRouter() {
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

/** @param {Route} r */
export function navigate(r) {
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

/**
 * Goes up one menu level, like the phone's back button.
 * @param {Route} r
 */
export function navigateUp(r) {
  const p = parentOf(r);
  if (p) navigate(p);
}

/**
 * A sheet opened: the back button closes it. Returns a token for `closeLayer`.
 * @param {() => void} close
 * @returns {number}
 */
export function openLayer(close) {
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

/**
 * The sheet closed itself (Cancel, backdrop, done): drop its history entry. No-op if back already closed it.
 * @param {number} token
 */
export function closeLayer(token) {
  enqueue(() => {
    const i = layers.findIndex((l) => l.token === token);
    if (i === -1) return false;
    const n = layers.slice(i).filter((l) => l.entry).length;
    layers = layers.slice(0, i);
    return n > 0 ? go(-n) : false;
  });
}

/** @returns {Route} */
export function useRoute() {
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
