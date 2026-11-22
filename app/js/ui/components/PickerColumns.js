import { CATEGORIES } from '../../domain/catalog.js';
import { BodyIcon, EquipmentIcon } from './Icons.js';
import { html } from '../../lib/html.js';

/**
 * @typedef {object} PickerColumnItem
 * @property {string} key
 * @property {string} name
 * @property {string} [label]
 * @property {Category} category
 * @property {Equipment} equipment
 */

/**
 * The exercise picker's layout: one column per body-part category (only those with items), each a list of
 * exercise buttons with their equipment icon. Used by the session's picker and by programs (choosing an
 * exercise for a program, swapping one a gym lacks).
 * @param {{ items: PickerColumnItem[], onPick: (item: PickerColumnItem) => void, className?: string }} props
 */
export default function PickerColumns({ items, onPick, className = '' }) {
  const columns = CATEGORIES.map((c) => ({ ...c, items: items.filter((i) => i.category === c.id) })).filter(
    (c) => c.items.length > 0,
  );
  return html`
    <div className=${('columns ' + className).trim()}>
      ${columns.map(
        (c) =>
          html`
        <section key=${c.id} className="column">
          <h2 className="column-title">
            <${BodyIcon} category=${c.id} className="column-icon" />
            ${c.name}
          </h2>
          <div className="column-items">
            ${c.items.map(
              (i) =>
                html`
              <button key=${i.key} className="btn pick-item" onClick=${() => onPick(i)}>
                <span className="pick-head">
                  <${EquipmentIcon} equipment=${i.equipment} className="pick-icon" />
                  <span className="card-name">${i.name}</span>
                </span>
                ${i.label && html`<span className="card-label">${i.label}</span>`}
              </button>
            `,
            )}
          </div>
        </section>
      `,
      )}
    </div>
  `;
}
