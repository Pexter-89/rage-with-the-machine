import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, saveGymExercise } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { startSession } from '../../db/sessionRepo';
import { BUILT_IN_CATALOG } from '../../domain/catalog';
import type { CatalogExercise } from '../../domain/types';
import Picker from './Picker';

const mocks = vi.hoisted(() => ({ override: null as null | (() => CatalogExercise[]) }));
vi.mock('../../db/catalogRepo', async (orig) => {
  const real = await orig<typeof import('../../db/catalogRepo')>();
  return { ...real, getCatalog: async () => (mocks.override ? mocks.override() : real.getCatalog()) };
});

beforeEach(async () => {
  mocks.override = null;
  await resetDb();
  location.hash = '';
});

async function seed() {
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now());
  const ge = await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: { type: 'stack', weights: [60, 62] },
    hidden: false,
  });
  return { g, s, ge };
}

test('Picker shows category columns in order, skipping empty ones, with labelled machines', async () => {
  mocks.override = () => BUILT_IN_CATALOG.filter((e) => e.category !== 'core' && e.category !== 'arms');
  const { s } = await seed();
  render(<Picker sessionId={s.id} />);
  await screen.findByRole('heading', { name: 'Legs' });
  const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(heads).toEqual(['Legs', 'Chest', 'Back', 'Shoulders', 'Full body']);
  const legs = within(screen.getByRole('heading', { name: 'Legs' }).closest('section') as HTMLElement);
  expect(legs.getByRole('button', { name: /Leg Press/ })).toHaveTextContent('Technogym');
});

test('Picker item tap navigates to log route with item key', async () => {
  const { s, ge } = await seed();
  render(<Picker sessionId={s.id} />);
  await userEvent.click(await screen.findByRole('button', { name: /Leg Press/ }));
  expect(location.hash).toBe(`#/session/${s.id}/log/${ge.id}`);
});

test('Back returns to the session', async () => {
  const { s } = await seed();
  render(<Picker sessionId={s.id} />);
  await userEvent.click(await screen.findByRole('button', { name: '‹ Back' }));
  expect(location.hash).toBe(`#/session/${s.id}`);
});

test('an ended session redirects home', async () => {
  const { s } = await seed();
  await db.sessions.update(s.id, { endedAt: Date.now() });
  location.hash = `#/session/${s.id}/pick`;
  render(<Picker sessionId={s.id} />);
  await vi.waitFor(() => expect(location.hash).toBe('#/'));
});

test('a missing session redirects home', async () => {
  location.hash = '#/session/nope/pick';
  render(<Picker sessionId="nope" />);
  await vi.waitFor(() => expect(location.hash).toBe('#/'));
});
