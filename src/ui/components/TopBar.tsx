import type { ReactNode } from 'react';
import { navigate, parentOf, type Route } from '../router';

const UP_NAMES: Record<Route['name'], string> = {
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
 */
export default function TopBar({ route, title, children }: { route: Route; title?: ReactNode; children?: ReactNode }) {
  const parent = parentOf(route);
  return (
    <header className="bar">
      {parent && (
        <button className="btn btn-ghost btn-small btn-up" onClick={() => navigate(parent)}>
          ‹ {UP_NAMES[parent.name]}
        </button>
      )}
      <h1 className="title">{title}</h1>
      {children}
    </header>
  );
}
