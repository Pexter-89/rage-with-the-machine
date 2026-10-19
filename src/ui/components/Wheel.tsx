import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatWeight } from '../../domain/metrics';

export const ITEM_HEIGHT = 40;
/** Rows visible at once; odd, so one sits in the middle under the selection band. */
export const VISIBLE_ROWS = 5;
const SETTLE_MS = 120;

/** Index of the row centred after scrolling: rounded and clamped to 0..count-1. */
export function indexFromScroll(scrollTop: number, itemHeight: number, count: number): number {
  const i = Math.round(scrollTop / itemHeight);
  return Math.max(0, Math.min(count - 1, i));
}

interface Props {
  label: string;
  values: number[];
  value: number;
  onChange(v: number): void;
  parse(s: string): number | null;
  suffix?: string;
}

export interface WheelHandle {
  /** Commits the value currently under the selector (even mid-scroll) and returns it. */
  flush(): number;
}

/**
 * A native-scrolling picker wheel. The rows are styled every animation frame by their distance from the
 * centre (no React render while scrolling), and the value is committed once the scroll settles.
 * Tap the centre row to type a value; tap a row above or below to step to it.
 */
export default forwardRef<WheelHandle, Props>(function Wheel({ label, values, value, onChange, parse, suffix }, ref) {
  const display = useMemo(
    () => (values.includes(value) ? values : [...values, value].sort((a, b) => a - b)),
    [values, value],
  );
  const index = display.indexOf(value);

  const scroller = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frame = useRef(0);
  const live = useRef({ display, value, onChange, editing: false });
  live.current = { display, value, onChange, editing: false };

  const [editing, setEditing] = useState(false);
  live.current.editing = editing;
  const down = useRef({ pointer: false, touch: false });
  const [text, setText] = useState('');
  const done = useRef(false);
  const typed = useRef({ text: '', parse });
  typed.current = { text, parse };

  /** Fades and shrinks rows by their distance from the centre. */
  const paint = useCallback(() => {
    frame.current = 0;
    const el = scroller.current;
    if (!el) return;
    const centre = el.scrollTop / ITEM_HEIGHT;
    const rows = el.children;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLElement;
      const d = Math.min(Math.abs(i - centre), 3);
      row.style.opacity = String(Math.max(0.25, 1 - d * 0.3));
      row.style.transform = `scale(${1 - Math.min(d, 2) * 0.1})`;
    }
  }, []);

  const repaint = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Keep the wheel on `value` (mount, value change, and after leaving edit mode). Skip when already there,
  // so committing the value a scroll landed on never nudges the list.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = index * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top;
    paint();
  }, [index, display.length, editing, paint]);

  const settle = () => {
    const el = scroller.current;
    if (!el) return;
    const { display: d, value: v, onChange: change, editing: ed } = live.current;
    if (ed || down.current.pointer || down.current.touch) return;
    const next = d[indexFromScroll(el.scrollTop, ITEM_HEIGHT, d.length)];
    if (next !== undefined && next !== v) change(next);
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onEnd = () => {
      clearTimeout(timer.current);
      settle();
    };
    el.addEventListener('scrollend', onEnd);
    return () => {
      el.removeEventListener('scrollend', onEnd);
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flush() {
        clearTimeout(timer.current);
        const el = scroller.current;
        const { display: d, value: v, onChange: change, editing: ed } = live.current;
        if (ed) {
          // Commit a typed value that has not been confirmed yet.
          if (done.current) return v;
          const parsed = typed.current.parse(typed.current.text);
          if (parsed === null) return v;
          done.current = true;
          if (parsed !== v) change(parsed);
          setEditing(false);
          return parsed;
        }
        if (!el) return v;
        const next = d[indexFromScroll(el.scrollTop, ITEM_HEIGHT, d.length)] ?? v;
        if (next !== v) change(next);
        return next;
      },
    }),
    [],
  );

  const hasScrollEnd = () => 'onscrollend' in window;

  // Browsers with `scrollend` settle there; others fall back to a debounce.
  const onScroll = () => {
    repaint();
    clearTimeout(timer.current);
    if (!hasScrollEnd()) timer.current = setTimeout(settle, SETTLE_MS);
  };

  const press = (kind: 'pointer' | 'touch') => {
    down.current[kind] = true;
    clearTimeout(timer.current);
  };

  const release = (kind: 'pointer' | 'touch') => {
    down.current[kind] = false;
    if (down.current.pointer || down.current.touch) return;
    // One settle after release; a following scroll event cancels it and scrollend/debounce takes over.
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, hasScrollEnd() ? 300 : SETTLE_MS);
  };

  /** Tapping a neighbouring row glides to it; the scroll then settles on it like a swipe would. */
  const stepTo = (i: number) => {
    const el = scroller.current;
    if (!el || editing) return;
    const top = i * ITEM_HEIGHT;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, hasScrollEnd() ? 600 : SETTLE_MS * 3);
  };

  const startEdit = () => {
    done.current = false;
    setText(formatWeight(value));
    setEditing(true);
  };

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) {
      const parsed = parse(text);
      if (parsed !== null) onChange(parsed);
    }
    setEditing(false);
  };

  const pad = ((VISIBLE_ROWS - 1) / 2) * ITEM_HEIGHT;

  return (
    <div className="wheel">
      <span className="wheel-label">{label}</span>
      <div className="wheel-window" style={{ height: VISIBLE_ROWS * ITEM_HEIGHT }}>
        <div className="wheel-band" style={{ top: pad, height: ITEM_HEIGHT }} aria-hidden="true" />
        <div
          className="wheel-scroll"
          ref={scroller}
          style={{ paddingTop: pad, paddingBottom: pad }}
          onScroll={onScroll}
          onTouchStart={() => press('touch')}
          onTouchEnd={() => release('touch')}
          onTouchCancel={() => release('touch')}
          // Touch pointers are cancelled when scrolling starts; touch events track those instead.
          onPointerDown={(e) => e.pointerType !== 'touch' && press('pointer')}
          onPointerUp={(e) => e.pointerType !== 'touch' && release('pointer')}
          onPointerCancel={(e) => e.pointerType !== 'touch' && release('pointer')}
        >
          {display.map((v, i) =>
            i !== index ? (
              <div key={v} className="wheel-item" aria-hidden="true" onClick={() => stepTo(i)}>
                {formatWeight(v)}
              </div>
            ) : editing ? (
              <div key={v} className="wheel-item selected">
                <input
                  className="wheel-input"
                  type="text"
                  inputMode="decimal"
                  aria-label={label}
                  value={text}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => finish(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finish(true);
                    else if (e.key === 'Escape') finish(false);
                  }}
                />
              </div>
            ) : (
              <button
                key={v}
                type="button"
                className="wheel-item selected"
                aria-label={`${label} ${formatWeight(v)}`}
                onClick={startEdit}
              >
                {formatWeight(v)}
                {suffix}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
});
