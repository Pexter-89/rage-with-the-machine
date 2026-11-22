import { equipmentOf } from '../../domain/catalog.js';
import PickerColumns from './PickerColumns.js';
import Sheet from './Sheet.js';
import { html } from '../../lib/html.js';

/**
 * The exercise picker over the whole catalogue (built-in and custom), not one gym's equipment: programs
 * hold exercises, and each gym supplies its own machine for them.
 * @param {{ open: boolean, catalog: CatalogExercise[], onPick: (catalogId: string) => void, onClose: () => void }} props
 */
export default function ExercisePickerSheet({ open, catalog, onPick, onClose }) {
  const items = catalog
    .map((e) => ({ key: e.id, name: e.name, label: '', category: e.category, equipment: equipmentOf(e) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return html`
    <${Sheet} open=${open} title="Add exercise" onClose=${onClose}>
      ${
        open &&
        html`
        <${PickerColumns}
          className="in-sheet"
          items=${items}
          onPick=${(i) => {
            onPick(i.key);
            onClose();
          }}
        />
      `
      }
    </${Sheet}>
  `;
}
