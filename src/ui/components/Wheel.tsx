import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatWeight } from '../../domain/metrics';

export const ITEM_HEIGHT = 44;
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

export default function Wheel({ label, values, value, onChange, parse, suffix }: Props) {
  const display = useMemo(
    () => (values.includes(value) ? values : [...values, value].sort((a, b) => a - b)),
    [values, value],
  );
  const index = display.indexOf(value);

  const scroller = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef({ display, value, onChange, editing: false });
  live.current = { display, value, onChange, editing: false };

  const [editing, setEditing] = useState(false);
  live.current.editing = editing;
  const down = useRef({ pointer: false, touch: false });
  const [text, setText] = useState('');
  const done = useRef(false);

  const scrollToValue = () => {
    const el = scroller.current;
    if (el) el.scrollTop = index * ITEM_HEIGHT;
  };

  // Keep the wheel on `value` (mount, value change, and after leaving edit mode).
  useLayoutEffect(scrollToValue, [index, display.length, editing]);

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
    };
  }, []);

  const hasScrollEnd = () => 'onscrollend' in window;

  // Browsers with `scrollend` settle there; others fall back to a debounce.
  const onScroll = () => {
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

  return (
    <div className="wheel">
      <span className="wheel-label">{label}</span>
      <div className="wheel-scroll" 
        ref={scroller}
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
            <div key={v} className="wheel-item" aria-hidden="true">
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
  );
}
