import { navigate, parentOf } from '../router.js';
import { html } from '../../lib/html.js';

const UP_NAMES = {
  home: 'Home',
  session: 'Session',
  pick: 'Exercises',
  log: 'Exercise',
  gyms: 'Gyms',
  gym: 'Gym',
  exercise: 'Exercise',
  progress: 'Progress',
  settings: 'Settings',
};

/**
 * Screen header: an Up button to the menu level above (the same place the phone's back button goes),
 * the title, and optional actions on the right. Rendered while data loads too, so no screen is ever a dead end.
 * @param {{ route: Route, title?: ReactNode, children?: ReactNode }} props
 */
export default function TopBar({ route, title, children }) {
  const parent = parentOf(route);
  return html`
    <header className="bar">
      ${
        parent &&
        html`
        <button className="btn btn-ghost btn-small btn-up" onClick=${() => navigate(parent)}>
          ‹ ${UP_NAMES[parent.name]}
        </button>
      `
      }
      <h1 className="title">${title}</h1>
      ${children}
    </header>
  `;
}
