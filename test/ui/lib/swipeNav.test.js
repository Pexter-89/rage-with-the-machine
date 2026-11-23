import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import Sheet from '../../../app/js/ui/components/Sheet.js';
import { EDGE_PX, isIgnoredTarget, installSwipeNav, recognize } from '../../../app/js/ui/lib/swipeNav.js';
import { installRouter, navigate, toHash, useRoute } from '../../../app/js/ui/router.js';
import { html } from '../../../app/js/lib/html.js';
import { fakeHistory } from '../../helpers/fakeHistory.js';

const W = 390;
/** Points along a straight line from (x0, y0) by (dx, dy) in `n` steps over `ms`. */
const line = (x0, y0, dx, dy, n = 10, ms = 300) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + (dx * i) / n, y: y0 + (dy * i) / n, t: (ms * i) / n }));

describe('recognize', () => {
  test('pending until the finger has moved LOCK_PX', () => {
    expect(recognize([{ x: 200, y: 300, t: 0 }, { x: 205, y: 302, t: 16 }], W).phase).toBe('pending');
  });

  test('a slow right drag past a third of the width arms back; left arms forward', () => {
    const r = recognize(line(100, 400, 140, 10, 20, 2000), W);
    expect(r).toMatchObject({ phase: 'horizontal', action: 'back', armed: true });
    expect(recognize(line(300, 400, -140, 0, 20, 2000), W)).toMatchObject({ action: 'forward', armed: true });
  });

  test('a short slow drag is horizontal but not armed', () => {
    expect(recognize(line(100, 400, 80, 0, 20, 2000), W)).toMatchObject({ phase: 'horizontal', armed: false });
  });

  test('a fast fling over 60px arms; a fast flick under 60px does not', () => {
    expect(recognize(line(100, 400, 90, 0, 6, 100), W)).toMatchObject({ armed: true, action: 'back' });
    expect(recognize(line(100, 400, 50, 0, 6, 60), W).armed).toBe(false);
  });

  test('a fling back toward the start does not trigger', () => {
    const pts = [...line(100, 400, 100, 0, 10, 1000), ...line(200, 400, -30, 0, 5, 50).slice(1).map((p) => ({ ...p, t: p.t + 1000 }))];
    expect(recognize(pts, W)).toMatchObject({ action: 'back', armed: false });
  });

  test('a mostly vertical move gives up for the whole touch, even if it turns sideways later', () => {
    const pts = line(200, 400, 8, 20, 4, 60);
    expect(recognize(pts, W).phase).toBe('rejected');
    const later = [...pts, { x: 380, y: 420, t: 400 }];
    expect(recognize(later, W).phase).toBe('rejected');
    // 1.5 ratio: dx 15 vs dy 10 is not enough.
    expect(recognize([{ x: 200, y: 400, t: 0 }, { x: 215, y: 410, t: 50 }], W).phase).toBe('rejected');
    expect(recognize([{ x: 200, y: 400, t: 0 }, { x: 216, y: 410, t: 50 }], W).phase).toBe('horizontal');
  });

  test('touches starting within EDGE_PX of either edge belong to the system', () => {
    expect(recognize(line(10, 400, 200, 0), W).phase).toBe('rejected');
    expect(recognize(line(EDGE_PX - 1, 400, 200, 0), W).phase).toBe('rejected');
    expect(recognize(line(W - 10, 400, -200, 0), W).phase).toBe('rejected');
    expect(recognize(line(EDGE_PX + 1, 400, 200, 0), W).phase).toBe('horizontal');
  });
});

describe('isIgnoredTarget', () => {
  afterEach(() => (document.body.innerHTML = ''));

  test('form fields, wheels, canvases and data-no-swipe areas keep their touches', () => {
    document.body.innerHTML = `
      <input id="i"><input id="r" type="range"><textarea id="t"></textarea><select id="s"></select>
      <div contenteditable="true"><b id="ce">x</b></div>
      <div class="wheel"><div class="wheel-scroll"><div id="w">1</div></div></div>
      <canvas id="c"></canvas>
      <div data-no-swipe><span id="ns">x</span></div>
      <button id="b">ok</button>`;
    for (const id of ['i', 'r', 't', 's', 'ce', 'w', 'c', 'ns']) expect(isIgnoredTarget(document.getElementById(id)), id).toBe(true);
    expect(isIgnoredTarget(document.getElementById('b'))).toBe(false);
  });

  test('anything inside a horizontally scrollable box keeps its touches; a box that fits does not', () => {
    document.body.innerHTML = `<div id="wrap" style="overflow-x: auto"><table><tr><td id="cell">1</td></tr></table></div>`;
    const wrap = document.getElementById('wrap');
    const size = (sw, cw) => {
      Object.defineProperty(wrap, 'scrollWidth', { value: sw, configurable: true });
      Object.defineProperty(wrap, 'clientWidth', { value: cw, configurable: true });
    };
    size(600, 360);
    expect(isIgnoredTarget(document.getElementById('cell'))).toBe(true);
    size(360, 360);
    expect(isIgnoredTarget(document.getElementById('cell'))).toBe(false);
    wrap.style.overflowX = 'hidden';
    size(600, 360);
    expect(isIgnoredTarget(document.getElementById('cell'))).toBe(false);
  });
});

describe('swiping in the app', () => {
  let hist;
  beforeAll(() => {
    window.history.replaceState(null, '', '#/');
    hist = fakeHistory();
    installRouter();
    installSwipeNav();
  });
  afterAll(() => vi.unstubAllGlobals());

  const settled = () => act(() => new Promise((r) => setTimeout(r, 20)));

  function touch(type, el, x, y) {
    const t = { identifier: 1, clientX: x, clientY: y, target: el };
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [t] });
    Object.defineProperty(e, 'changedTouches', { value: [t] });
    el.dispatchEvent(e);
    return e;
  }

  /** A finger drag from x0 by dx at height y, starting on `el`. */
  async function swipe(el, x0, dx, y = 400) {
    touch('touchstart', el, x0, y);
    let prevented = false;
    for (let i = 1; i <= 10; i++) prevented = touch('touchmove', el, x0 + (dx * i) / 10, y).defaultPrevented || prevented;
    touch('touchend', el, x0 + dx, y);
    await settled();
    return prevented;
  }

  function Screen() {
    const route = useRoute();
    const [open, setOpen] = useState(false);
    return html`
      <main>
        <p data-testid="where">${toHash(route)}</p>
        <button onClick=${() => setOpen(true)}>Open sheet</button>
        <${Sheet} open=${open} title="A sheet" onClose=${() => setOpen(false)}><p>Sheet body</p></${Sheet}>
      </main>
    `;
  }

  test('right swipes close the sheet first, then go up level by level; left goes forward again', async () => {
    const w = window.innerWidth;
    act(() => {
      navigate({ name: 'gyms' });
      navigate({ name: 'gym', gymId: 'g1' });
    });
    render(html`<${Screen} />`);
    const where = () => screen.getByTestId('where').textContent;
    expect(where()).toBe('#gym--g1');

    act(() => screen.getByText('Open sheet').click());
    await settled();
    expect(hist.urls()).toEqual(['#home', '#gyms', '#gym--g1', '#gym--g1']);

    // A swipe starting at the screen edge is Android's, not ours.
    expect(await swipe(screen.getByText('Sheet body'), 10, w * 0.6)).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(await swipe(screen.getByText('Sheet body'), w * 0.3, w * 0.5)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('#gym--g1');
    expect(hist.urls()).toEqual(['#home', '#gyms', '#gym--g1']);

    await swipe(screen.getByText('Open sheet'), w * 0.3, w * 0.5);
    expect(where()).toBe('#gyms');

    // A short drag snaps back and does nothing.
    await swipe(screen.getByTestId('where'), w * 0.3, 40);
    expect(where()).toBe('#gyms');

    await swipe(screen.getByTestId('where'), w * 0.7, -w * 0.5);
    expect(where()).toBe('#gym--g1');
    expect(hist.urls()).toEqual(['#home', '#gyms', '#gym--g1']);

    // No further forward step: nothing happens.
    await swipe(screen.getByTestId('where'), w * 0.7, -w * 0.5);
    expect(where()).toBe('#gym--g1');

    await swipe(screen.getByTestId('where'), w * 0.3, w * 0.5);
    await swipe(screen.getByTestId('where'), w * 0.3, w * 0.5);
    expect(where()).toBe('#home');
    // Home: shows the indicator, then cancels.
    await swipe(screen.getByTestId('where'), w * 0.3, w * 0.5);
    expect(where()).toBe('#home');
    expect(hist.urls()).toEqual(['#home']);
    expect(document.querySelector('.swipe-indicator')).not.toBeNull();
  });

  test('a vertical drag is left alone', async () => {
    await act(() => new Promise((r) => setTimeout(r, 300))); // the previous snap-back finishes
    expect(document.documentElement.classList.contains('swipe-dragging')).toBe(false);
    const el = document.body;
    touch('touchstart', el, 200, 400);
    const e = touch('touchmove', el, 202, 380);
    touch('touchmove', el, 260, 300);
    touch('touchend', el, 260, 300);
    expect(e.defaultPrevented).toBe(false);
    expect(document.documentElement.classList.contains('swipe-dragging')).toBe(false);
  });
});
