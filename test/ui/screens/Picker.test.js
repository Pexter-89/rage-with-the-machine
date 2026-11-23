import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, saveGymExercise } from '../../../app/js/db/gymRepo.js';
import { db, resetDb } from '../../../app/js/db/db.js';
import { startSession } from '../../../app/js/db/sessionRepo.js';
import { BUILT_IN_CATALOG } from '../../../app/js/domain/catalog.js';
import Picker from '../../../app/js/ui/screens/Picker.js';
import { html } from '../../../app/js/lib/html.js';
import { toHash } from '../../../app/js/ui/router.js';

const mocks = vi.hoisted(() => ({ override: null }));
vi.mock('../../../app/js/db/catalogRepo.js', async (orig) => {
  const real = await orig();
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
  render(html`<${Picker} sessionId=${s.id} />`);
  await screen.findByRole('heading', { name: 'Legs' });
  const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(heads).toEqual(['Legs', 'Chest', 'Back', 'Shoulders', 'Full body']);
  const legs = within(screen.getByRole('heading', { name: 'Legs' }).closest('section'));
  expect(legs.getByRole('button', { name: /Leg Press/ })).toHaveTextContent('Technogym');
});

test('Picker item tap navigates to log route with item key', async () => {
  const { s, ge } = await seed();
  render(html`<${Picker} sessionId=${s.id} />`);
  await userEvent.click(await screen.findByRole('button', { name: /Leg Press/ }));
  expect(location.hash).toBe(toHash({ name: 'log', sessionId: s.id, key: ge.id }));
});

test('Back returns to the session', async () => {
  const { s } = await seed();
  render(html`<${Picker} sessionId=${s.id} />`);
  await userEvent.click(await screen.findByRole('button', { name: '‹ Back' }));
  expect(location.hash).toBe(toHash({ name: 'session', sessionId: s.id }));
});

test('an ended session redirects home', async () => {
  const { s } = await seed();
  await db.sessions.update(s.id, { endedAt: Date.now() });
  location.hash = `#/session/${s.id}/pick`;
  render(html`<${Picker} sessionId=${s.id} />`);
  await vi.waitFor(() => expect(location.hash).toBe(toHash({ name: 'home' })));
});

test('a missing session redirects home', async () => {
  location.hash = '#/session/nope/pick';
  render(html`<${Picker} sessionId="nope" />`);
  await vi.waitFor(() => expect(location.hash).toBe(toHash({ name: 'home' })));
});

test('Import machine from the picker navigates to the single created machine', async () => {
  const user = userEvent.setup();
  const { s, g } = await seed();
  render(html`<${Picker} sessionId=${s.id} />`);
  await user.click(await screen.findByRole('button', { name: 'Import machine' }));
  await user.click(screen.getByLabelText('Pasted text'));
  await user.paste(
    JSON.stringify({
      format: 'rwtm-machine',
      version: 1,
      machines: [
        {
          exercise: 'hack-squat',
          newExercise: null,
          label: 'Hammer',
          loading: { type: 'stack', weights: [10, 20] },
          notes: '',
        },
      ],
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  await vi.waitFor(async () => expect(await db.gymExercises.where('gymId').equals(g.id).count()).toBe(2));
  const created = (await db.gymExercises.toArray()).find((e) => e.catalogId === 'hack-squat');
  expect(location.hash).toBe(toHash({ name: 'log', sessionId: s.id, key: created.id }));
});

test('category headers carry a body figure and exercises an equipment icon', async () => {
  const g = await addGym('K');
  const s = await startSession(g.id, Date.now());
  const { container } = render(html`<${Picker} sessionId=${s.id} />`);
  const legs = await screen.findByRole('heading', { name: 'Legs' });
  expect(legs.querySelector('svg')).not.toBeNull();
  const squat = screen.getByRole('button', { name: /^Barbell Back Squat/ });
  expect(squat.querySelector('svg title')?.textContent).toBe('Barbell');
  expect(screen.getByRole('button', { name: /^Band Lateral Walk/ }).querySelector('svg title')?.textContent).toBe(
    'Resistance band',
  );
  expect(container.querySelectorAll('.pick-icon').length).toBeGreaterThan(20);
});
