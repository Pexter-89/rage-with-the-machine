import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { addOnsFor, parseWeightInput } from '../../domain/loading';
import { formatWeight } from '../../domain/metrics';
import Wheel, { type WheelHandle } from './Wheel';

interface Props {
  label: string;
  weights: number[];
  addOns: number[];
  /** The total: stack weight plus the add-ons switched in. */
  value: number;
  onChange(total: number): void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A stack wheel with a switch per add-on weight (the "+2 kg" lever some machines have). The wheel picks the
 * stack weight; the logged weight is the total. Renders two children of the input row: the switches (full
 * width, above) and the wheel.
 */
export default forwardRef<WheelHandle, Props>(function AddOnStack({ label, weights, addOns, value, onChange }, ref) {
  // Which add-ons are on; re-derived only when the total changes from outside (prefill, the edit sheet).
  const [state, setState] = useState(() => ({ value, on: addOnsFor(weights, addOns, value) }));
  let on = state.on;
  if (state.value !== value) {
    on = addOnsFor(weights, addOns, value);
    setState({ value, on });
  }
  const extra = round2(addOns.reduce((s, a, i) => s + (on[i] ? a : 0), 0));
  const base = round2(value - extra);

  const wheel = useRef<WheelHandle>(null);
  useImperativeHandle(ref, () => ({
    flush: () => round2((wheel.current?.flush() ?? base) + extra),
  }));

  const commit = (nextBase: number, nextOn: boolean[]) => {
    const total = round2(nextBase + addOns.reduce((s, a, i) => s + (nextOn[i] ? a : 0), 0));
    setState({ value: total, on: nextOn });
    onChange(total);
  };

  return (
    <>
      <div className="addon-panel" role="group" aria-label="Add-on weights">
        {addOns.map((a, i) => (
          <button
            key={a}
            type="button"
            role="switch"
            aria-checked={on[i]}
            aria-label={`Add-on ${formatWeight(a)} kg`}
            className={'addon-switch' + (on[i] ? ' on' : '')}
            onClick={() => commit(base, on.map((x, j) => (j === i ? !x : x)))}
          >
            <span className="addon-track" aria-hidden="true">
              <span className="addon-thumb" />
            </span>
            +{formatWeight(a)} kg
          </button>
        ))}
        <span className="addon-total" aria-live="polite">
          {extra > 0 ? `${formatWeight(base)} + ${formatWeight(extra)} = ${formatWeight(value)} kg` : `${formatWeight(value)} kg`}
        </span>
      </div>
      <Wheel
        ref={wheel}
        label={label}
        values={weights}
        value={base}
        onChange={(b) => commit(b, on)}
        parse={parseWeightInput}
      />
    </>
  );
});
