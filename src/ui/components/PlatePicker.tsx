import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { parseWeightInput, plateTotal, platesFor, sortPlates } from '../../domain/loading';
import { formatWeight } from '../../domain/metrics';
import type { Loading } from '../../domain/types';
import type { WheelHandle } from './Wheel';

type PlatesLoading = Extract<Loading, { type: 'plates' }>;

/** Competition plate colours by size; other sizes are grey. */
const PLATE_COLORS: Record<string, string> = {
  '25': '#d64545',
  '20': '#3b6fd8',
  '15': '#e0b020',
  '10': '#3aa860',
  '5': '#e8e8e8',
  '2.5': '#c23b3b',
  '2': '#3b6fd8',
  '1.5': '#e0b020',
  '1.25': '#b8bcc4',
  '1': '#3aa860',
  '0.5': '#e8e8e8',
};
const plateColor = (p: number) => PLATE_COLORS[formatWeight(p)] ?? '#8a8f99';
/** Dark text on light plates. */
const plateInk = (p: number) => (['5', '0.5', '1.25', '15', '1.5'].includes(formatWeight(p)) ? '#1b1d22' : '#fff');

interface Props {
  loading: PlatesLoading;
  value: number;
  onChange(v: number): void;
}

/**
 * Weight input for plate-by-plate loading: a picture of one side of the bar (tap a plate to take it off),
 * a "+" button per plate size (a pair goes on when loaded on both sides), and the total, which can be typed.
 * Renders two children of the input row: the plate panel (full width, above) and the total box.
 */
export default forwardRef<WheelHandle, Props>(function PlatePicker({ loading, value, onChange }, ref) {
  // The plates actually on the bar, so two 2.5s stay two 2.5s; re-derived when the total changes from outside.
  const [bar, setBar] = useState(() => ({ value, plates: platesFor(loading, value).plates }));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const done = useRef(false);
  const live = useRef({ value, editing, text });
  live.current = { value, editing, text };

  let shown = bar.plates;
  if (bar.value !== value) {
    if (plateTotal(loading, bar.plates) !== value) shown = platesFor(loading, value).plates;
    setBar({ value, plates: shown });
  }
  const rest = Math.max(0, (value - plateTotal(loading, shown)) / loading.sides);

  const commit = (next: number[]) => {
    const sorted = sortPlates(next);
    const total = plateTotal(loading, sorted);
    setBar({ value: total, plates: sorted });
    onChange(total);
  };

  useImperativeHandle(
    ref,
    () => ({
      flush() {
        const { value: v, editing: ed, text: t } = live.current;
        if (!ed || done.current) return v;
        const parsed = parseWeightInput(t);
        done.current = true;
        setEditing(false);
        if (parsed === null) return v;
        if (parsed !== v) onChange(parsed);
        return parsed;
      },
    }),
    [onChange],
  );

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) {
      const parsed = parseWeightInput(text);
      if (parsed !== null) onChange(parsed);
    }
    setEditing(false);
  };

  const sizes = [...loading.plates].sort((a, b) => a - b);
  const biggest = Math.max(...sizes, 1);
  const perSide = loading.sides === 2;
  const what = loading.sides === 2 ? 'pair' : 'plate';

  return (
    <>
      <div className="plate-panel">
        <div className="plate-bar" role="group" aria-label={perSide ? 'Plates on each side' : 'Plates'}>
          <span className="plate-sleeve" aria-hidden="true" />
          <span className="plate-collar" aria-hidden="true" />
          {shown.map((p, i) => (
            <button
              key={i}
              type="button"
              className="plate"
              aria-label={`Remove ${formatWeight(p)} kg ${what}`}
              style={{
                background: plateColor(p),
                color: plateInk(p),
                height: `${40 + 60 * Math.sqrt(p / biggest)}%`,
              }}
              onClick={() => commit(shown.filter((_, j) => j !== i))}
            >
              {formatWeight(p)}
            </button>
          ))}
          {rest > 0 && <span className="plate-rest">{`+${formatWeight(rest)}`}</span>}
          <span className="plate-bar-end" aria-hidden="true" />
        </div>
        <div className="plate-sum">
          <p className="hint">
            {shown.length === 0 && rest === 0
              ? `Empty ${formatWeight(loading.base)} kg — tap + to add ${perSide ? 'a pair' : 'a plate'}`
              : `${formatWeight(loading.base)} + ${perSide ? '2 × ' : ''}${formatWeight(
                  (value - loading.base) / loading.sides,
                )} kg`}
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            aria-label="Remove all plates"
            disabled={shown.length === 0 && rest === 0}
            onClick={() => commit([])}
          >
            Clear
          </button>
        </div>
        <div className="plate-add" role="group" aria-label="Add plates">
          {sizes.map((p) => (
            <button
              key={p}
              type="button"
              className="btn plate-add-btn"
              aria-label={`Add ${formatWeight(p)} kg ${what}`}
              onClick={() => commit([...shown, p])}
            >
              <span className="plate-chip" style={{ background: plateColor(p) }} aria-hidden="true" />+{formatWeight(p)}
            </button>
          ))}
        </div>
      </div>
      <div className="wheel plate-total">
        <span className="wheel-label">KG</span>
        {editing ? (
          <input
            className="wheel-input plate-total-value"
            type="text"
            inputMode="decimal"
            aria-label="KG"
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
        ) : (
          <button
            type="button"
            className="plate-total-value"
            aria-label={`KG ${formatWeight(value)}`}
            onClick={() => {
              done.current = false;
              setText(formatWeight(value));
              setEditing(true);
            }}
          >
            {formatWeight(value)}
          </button>
        )}
      </div>
    </>
  );
});
