import { canGoBack, canGoForward, goBack, goForward } from '../router.js';

/**
 * In-app swipe navigation. The Claude Android app's own back (button or edge gesture) exits the artifact,
 * so a horizontal swipe across the page does what the browser's back/forward do in our router:
 * swipe right = back (close the top sheet, else up one level; nothing at Home), swipe left = forward
 * (only right after a back step). See `recognize` for when a touch counts as a swipe.
 */

/** Android's gesture navigation owns swipes that start this close (CSS px) to the left or right edge. */
export const EDGE_PX = 32;
/** Movement before the direction is decided. */
export const LOCK_PX = 12;
/** Horizontal only if |dx| > RATIO · |dy| at the lock; otherwise the touch is left to scrolling. */
export const RATIO = 1.5;
/** Release past this fraction of the viewport width triggers. */
export const DIST_FRACTION = 0.33;
/** ...or a fling this fast (px/ms over the last VELOCITY_WINDOW_MS) and at least FLING_MIN_PX long. */
export const FLING_VELOCITY = 0.5;
export const FLING_MIN_PX = 60;
export const VELOCITY_WINDOW_MS = 100;

/** Touches starting in these never swipe: they take horizontal input themselves. */
const IGNORE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .wheel, .wheel-scroll, canvas, [data-no-swipe]';

/** @typedef {{ x: number, y: number, t: number }} Point */
/**
 * @typedef {object} Recognition
 * @property {'pending' | 'horizontal' | 'rejected'} phase pending: not yet LOCK_PX from the start.
 * @property {number} dx Horizontal distance from the start.
 * @property {'back' | 'forward' | null} action Right = back, left = forward (null until horizontal).
 * @property {boolean} armed Releasing now would trigger the action.
 */

/**
 * Decides what a single touch's points (start first, timestamps in ms) amount to. Pure.
 * @param {Point[]} points
 * @param {number} width Viewport width.
 * @returns {Recognition}
 */
export function recognize(points, width) {
  const none = /** @type {Recognition} */ ({ phase: 'rejected', dx: 0, action: null, armed: false });
  if (points.length === 0) return none;
  const start = points[0];
  if (start.x < EDGE_PX || start.x > width - EDGE_PX) return none;
  // The lock is decided once, at the first point LOCK_PX away from the start.
  const lockAt = points.findIndex((p) => Math.hypot(p.x - start.x, p.y - start.y) >= LOCK_PX);
  const last = points[points.length - 1];
  const dx = last.x - start.x;
  if (lockAt === -1) return { phase: 'pending', dx, action: null, armed: false };
  const lp = points[lockAt];
  if (Math.abs(lp.x - start.x) <= RATIO * Math.abs(lp.y - start.y)) return { ...none, dx };
  const action = dx > 0 ? 'back' : dx < 0 ? 'forward' : null;
  // Velocity over the last window, in the direction of the swipe.
  let ref = last;
  for (let i = points.length - 1; i >= 0 && last.t - points[i].t <= VELOCITY_WINDOW_MS; i--) ref = points[i];
  const dt = last.t - ref.t;
  const v = dt > 0 ? (last.x - ref.x) / dt : 0;
  const fling = Math.abs(v) > FLING_VELOCITY && Math.sign(v) === Math.sign(dx) && Math.abs(dx) > FLING_MIN_PX;
  const armed = action !== null && (Math.abs(dx) > DIST_FRACTION * width || fling);
  return { phase: 'horizontal', dx, action, armed };
}

/**
 * Whether a touch starting on `el` belongs to the element (form fields, wheels, charts, anything marked
 * data-no-swipe or scrolling sideways) rather than to the swipe.
 * @param {Element | null} el
 * @returns {boolean}
 */
export function isIgnoredTarget(el) {
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(IGNORE_SELECTOR)) return true;
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/** How far the content follows the finger: damped, and barely when the swipe would do nothing. */
function follow(dx, width, allowed) {
  const max = width * (allowed ? 0.3 : 0.06);
  return Math.sign(dx) * max * (1 - Math.exp(-Math.abs(dx) / (max * 1.6)));
}

let installed = false;

/**
 * Listens for swipes on the whole document. Call once at startup.
 * @param {{ root?: Document }} [opts]
 */
export function installSwipeNav({ root = document } = {}) {
  if (installed) return;
  installed = true;
  const doc = root;
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** @type {Point[] | null} */
  let points = null;
  let id = -1;
  let locked = false;
  /** @type {HTMLElement | null} */
  let moved = null;
  /** @type {HTMLElement | null} */
  let indicator = null;

  const width = () => doc.documentElement.clientWidth || window.innerWidth;

  function indicatorEl() {
    if (!indicator) {
      indicator = doc.createElement('div');
      indicator.className = 'swipe-indicator';
      indicator.setAttribute('aria-hidden', 'true');
    }
    if (!indicator.isConnected) doc.body.appendChild(indicator);
    return indicator;
  }

  /** The top sheet while one is open, else the screen. */
  function contentEl() {
    const sheets = doc.querySelectorAll('.sheet');
    return /** @type {HTMLElement | null} */ (sheets[sheets.length - 1] ?? doc.querySelector('#root main') ?? doc.querySelector('main'));
  }

  /**
   * @param {Recognition} r
   * @param {number} y
   */
  function show(r, y) {
    const w = width();
    const allowed = r.action === 'back' ? canGoBack() : r.action === 'forward' ? canGoForward() : false;
    doc.documentElement.classList.add('swipe-dragging');
    const ind = indicatorEl();
    const progress = Math.min(1, Math.abs(r.dx) / (DIST_FRACTION * w));
    ind.textContent = r.action === 'forward' ? '›' : '‹';
    ind.classList.toggle('swipe-forward', r.action === 'forward');
    ind.classList.toggle('armed', allowed && r.armed);
    ind.classList.toggle('disabled', !allowed);
    ind.style.top = `${Math.max(40, Math.min(window.innerHeight - 40, y))}px`;
    ind.style.opacity = String(Math.min(1, progress * 1.4));
    ind.style.setProperty('--swipe-shift', `${Math.round(progress * 28)}px`);
    ind.classList.remove('resting');
    if (!reduceMotion()) {
      moved = moved ?? contentEl();
      if (moved) {
        moved.style.transition = 'none';
        moved.style.transform = `translateX(${follow(r.dx, w, allowed).toFixed(1)}px)`;
      }
    }
  }

  /** @param {boolean} animate */
  function reset(animate) {
    const el = moved;
    moved = null;
    if (el) {
      if (animate && !reduceMotion()) {
        el.style.transition = 'transform 180ms ease-out';
        el.style.transform = 'translateX(0)';
        const done = () => {
          if (moved === el) return; // a new drag took it over
          el.style.transition = '';
          el.style.transform = '';
          doc.documentElement.classList.remove('swipe-dragging');
        };
        el.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 250);
      } else {
        el.style.transition = '';
        el.style.transform = '';
      }
    }
    if (!el || !animate || reduceMotion()) doc.documentElement.classList.remove('swipe-dragging');
    if (indicator) {
      indicator.classList.add('resting');
      indicator.classList.remove('armed');
      indicator.style.opacity = '0';
    }
  }

  function cancel() {
    if (locked) reset(true);
    points = null;
    locked = false;
    id = -1;
  }

  /** @param {TouchEvent} e */
  function onStart(e) {
    if (points) {
      // A second finger: no swipe.
      cancel();
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (isIgnoredTarget(/** @type {Element} */ (e.target))) return;
    const p = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    if (recognize([p], width()).phase === 'rejected') return; // edge
    points = [p];
    id = t.identifier;
    locked = false;
  }

  /** @param {TouchEvent} e */
  function onMove(e) {
    if (!points) return;
    if (e.touches.length !== 1) {
      cancel();
      return;
    }
    const t = Array.from(e.changedTouches).find((x) => x.identifier === id);
    if (!t) return;
    points.push({ x: t.clientX, y: t.clientY, t: e.timeStamp });
    if (points.length > 64) points.splice(1, points.length - 64);
    const r = recognize(points, width());
    if (r.phase === 'rejected') {
      // Vertical: leave this touch to scrolling.
      cancel();
      return;
    }
    if (r.phase !== 'horizontal') return;
    locked = true;
    if (e.cancelable) e.preventDefault();
    show(r, t.clientY);
  }

  /** @param {TouchEvent} e */
  function onEnd(e) {
    if (!points) return;
    if (e.touches.length > 0) {
      cancel();
      return;
    }
    const t = Array.from(e.changedTouches).find((x) => x.identifier === id);
    if (t) points.push({ x: t.clientX, y: t.clientY, t: e.timeStamp });
    const r = recognize(points, width());
    const wasLocked = locked;
    points = null;
    locked = false;
    id = -1;
    if (!wasLocked) return;
    if (r.phase === 'horizontal' && r.armed) {
      if (r.action === 'back' && canGoBack()) {
        reset(false);
        goBack();
        return;
      }
      if (r.action === 'forward' && canGoForward()) {
        reset(false);
        goForward();
        return;
      }
    }
    reset(true);
  }

  doc.addEventListener('touchstart', onStart, { passive: true });
  // Not passive: once the swipe is locked horizontal, its moves are cancelled so the page does not pan.
  doc.addEventListener('touchmove', onMove, { passive: false });
  doc.addEventListener('touchend', onEnd, { passive: true });
  doc.addEventListener('touchcancel', cancel, { passive: true });
}
