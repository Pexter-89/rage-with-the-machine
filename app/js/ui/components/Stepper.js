import { html } from '../../lib/html.js';

/**
 * A small number stepper: − value +. `name` labels the buttons for screen readers ("Fewer sets for …").
 * @param {{ value: number, min: number, max: number, unit: string, name: string, onChange: (n: number) => void }} props
 */
export default function Stepper({ value, min, max, unit, name, onChange }) {
  return html`
    <span className="stepper" role="group" aria-label=${`${unit} for ${name}`}>
      <button
        className="btn btn-ghost btn-icon"
        aria-label=${`Fewer ${unit} for ${name}`}
        disabled=${value <= min}
        onClick=${() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="stepper-value" aria-live="polite">${value}</span>
      <button
        className="btn btn-ghost btn-icon"
        aria-label=${`More ${unit} for ${name}`}
        disabled=${value >= max}
        onClick=${() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  `;
}
