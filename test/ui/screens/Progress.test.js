import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym } from '../../../app/js/db/gymRepo.js';
import { db, resetDb } from '../../../app/js/db/db.js';
import { formatDate } from '../../../app/js/domain/dates.js';
import { gymColor } from '../../../app/js/domain/progress.js';
import Progress from '../../../app/js/ui/screens/Progress.js';
import { html } from '../../../app/js/lib/html.js';

const charts = vi.hoisted(() => ({ configs: [], destroyed: 0 }));
vi.mock('chart.js', () => {
  class Chart {
    static register = vi.fn();
    constructor(_canvas, config) {
      charts.configs.push(config);
    }
    destroy() {
      charts.destroyed++;
    }
  }
  return { Chart, LineController: {}, LineElement: {}, PointElement: {}, LinearScale: {}, Tooltip: {} };
});

const day = (m, d) => new Date(2026, m, d, 10).getTime();
let n = 0;
const mk = (p) => ({
  id: `s${n++}`,
  sessionId: 'a',
  gymId: 'g',
  catalogId: 'leg-press',
  gymExerciseId: null,
  order: 0,
  weight: 100,
  reps: 10,
  baseWeight: null,
  unit: 'kg',
  completedAt: day(0, 5),
  ...p,
});

let gA;
let gB;
beforeEach(async () => {
  await resetDb();
  location.hash = '';
  charts.configs.length = 0;
  charts.destroyed = 0;
  gA = (await addGym('Alpha')).id;
  gB = (await addGym('Beta')).id;
  await db.sets.bulkAdd([
    mk({ sessionId: 's1', gymId: gA, completedAt: day(0, 5), weight: 100, reps: 10 }),
    mk({
      sessionId: 's1',
      gymId: gA,
      catalogId: 'push-up',
      order: 1,
      weight: 0,
      reps: 12,
      completedAt: day(0, 5) + 60000,
    }),
    mk({ sessionId: 's2', gymId: gB, completedAt: day(1, 9), weight: 120, reps: 5 }),
    mk({ sessionId: 's2', gymId: gB, completedAt: day(1, 9) + 60000, weight: 110, reps: 8, order: 1 }),
  ]);
});

const lastConfig = () => charts.configs[charts.configs.length - 1];

test('no exercise selected: lists recent sessions, no chart', async () => {
  render(html`<${Progress} />`);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row');
  expect(within(table).getByRole('columnheader', { name: 'Exercises' })).toBeInTheDocument();
  expect(rows).toHaveLength(3); // header + 2 sessions
  expect(rows[1]).toHaveTextContent('Beta');
  expect(rows[1]).toHaveTextContent('Leg Press');
  expect(rows[2]).toHaveTextContent('Leg Press, Push-Up');
  expect(charts.configs).toHaveLength(0);
});

test('selecting exercise shows chart and table newest first', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'leg-press');
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(3);
  expect(rows[1]).toHaveTextContent('Beta');
  expect(rows[1]).toHaveTextContent('120×5, 110×8');
  expect(rows[2]).toHaveTextContent('Alpha');
  expect(rows[2]).toHaveTextContent('100×10');
  const cfg = lastConfig();
  const ds = cfg.data.datasets[0];
  expect(ds.parsing).toBe(false);
  expect(ds.data.map((p) => p.x)).toEqual([day(0, 5), day(1, 9)]);
  expect(ds.data[0].y).toBeCloseTo(100 * (1 + 10 / 30), 5);
  expect(ds.pointBackgroundColor).toEqual([gymColor(0), gymColor(1)]);
  expect(cfg.options.scales.y.reverse).toBeFalsy();
});

test('assisted exercise reverses the y axis and says lower is better', async () => {
  const user = userEvent.setup();
  await db.sets.add(mk({ catalogId: 'assisted-pull-up', sessionId: 's3', gymId: gA, weight: 30, reps: 8 }));
  render(html`<${Progress} />`);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'assisted-pull-up');
  expect(await screen.findByText('Assisted: lower is better')).toBeInTheDocument();
  expect(lastConfig().options.scales.y.reverse).toBe(true);
  expect(screen.getByRole('columnheader', { name: 'Volume (assist kg)' })).toBeInTheDocument();
});

test('gym chip filter narrows table rows', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'leg-press');
  const chip = screen.getByRole('button', { name: 'Alpha' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  await user.click(chip);
  expect(chip).toHaveAttribute('aria-pressed', 'true');
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows).toHaveLength(2);
  expect(rows[1]).toHaveTextContent('Alpha');
});

test('metric toggle switches to volume', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'leg-press');
  expect(screen.getByRole('button', { name: /^e1RM/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /^e1RM/ })).toHaveTextContent(
    'Estimated one-rep max: the most you could lift once, based on your best set',
  );
  await user.click(screen.getByRole('button', { name: /^Volume/ }));
  expect(screen.getByRole('button', { name: /^Volume/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /^Volume/ })).toHaveTextContent(
    'Weight × reps of every set in the session, added up',
  );
  expect(lastConfig().data.datasets[0].data.map((p) => p.y)).toEqual([1000, 120 * 5 + 110 * 8]);
  expect(charts.destroyed).toBeGreaterThan(0);
});

test('bodyweight exercise shows total reps note and "–" for e1RM', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'push-up');
  expect(await screen.findByText('Bodyweight: total reps per session')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Volume (added kg)' })).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('–');
  expect(lastConfig().data.datasets[0].data.map((p) => p.y)).toEqual([12]);
});

test('year slicer offers only years with data and narrows the table', async () => {
  const user = userEvent.setup();
  await db.sets.add(mk({ sessionId: 's0', gymId: gA, completedAt: new Date(2025, 5, 1, 10).getTime() }));
  render(html`<${Progress} />`);
  const year = await screen.findByLabelText('Year');
  expect(
    within(year)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['All', '2025', '2026']);
  await user.selectOptions(year, '2025');
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows).toHaveLength(2);
  const month = screen.getByLabelText('Month');
  expect(
    within(month)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['All', 'Jun']);
});

test('Home button navigates home', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  await user.click(await screen.findByRole('button', { name: '‹ Home' }));
  expect(location.hash).toBe('#/');
});

test('tapping a row opens its sets; a set is deleted on the second tap, even from an ended session', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  const table = await screen.findByRole('table');
  await user.click(within(table).getAllByRole('row')[1]); // newest: Beta, two leg press sets
  const sheet = await screen.findByRole('dialog', { name: /Beta$/ });
  expect(within(sheet).getAllByRole('listitem')).toHaveLength(2);
  await user.click(within(sheet).getByRole('button', { name: 'Delete Leg Press · 120 kg × 5' }));
  expect(await db.sets.count()).toBe(4); // armed, not deleted
  await user.click(within(sheet).getByRole('button', { name: 'Confirm delete Leg Press · 120 kg × 5' }));
  await vi.waitFor(async () => expect(await db.sets.count()).toBe(3));
  await vi.waitFor(() => expect(within(sheet).getAllByRole('listitem')).toHaveLength(1));
});

test('Delete all in the sheet removes only the sets the row shows', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'leg-press');
  const table = await screen.findByRole('table');
  await user.click(within(table).getByRole('button', { name: formatDate(day(0, 5)) }));
  const sheet = await screen.findByRole('dialog', { name: /Alpha$/ });
  await user.click(within(sheet).getByRole('button', { name: 'Delete all 1' }));
  await user.click(within(sheet).getByRole('button', { name: 'Tap again to delete 1' }));
  await vi.waitFor(async () =>
    expect((await db.sets.toArray()).map((s) => s.catalogId).sort()).toEqual(['leg-press', 'leg-press', 'push-up']),
  );
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('Clear all history deletes every session and set after confirming, keeping the gyms', async () => {
  const user = userEvent.setup();
  await db.sessions.bulkAdd([
    { id: 's1', gymId: gA, startedAt: day(0, 5), endedAt: day(0, 5) + 3600_000, lastActivityAt: day(0, 5) },
    { id: 's2', gymId: gB, startedAt: day(1, 9), endedAt: day(1, 9) + 3600_000, lastActivityAt: day(1, 9) },
  ]);
  render(html`<${Progress} />`);
  await user.click(await screen.findByRole('button', { name: 'Clear all history' }));
  const dialog = await screen.findByRole('dialog', { name: 'Clear all history?' });
  expect(dialog).toHaveTextContent('All 2 sessions and 4 sets at every gym will be deleted.');
  await user.click(within(dialog).getByRole('button', { name: 'Delete all' }));
  await vi.waitFor(async () => expect(await db.sets.count()).toBe(0));
  expect(await db.sessions.count()).toBe(0);
  expect(await db.gyms.count()).toBe(2);
  expect(await screen.findByText('No sessions logged yet.')).toBeInTheDocument();
});

test('a completed session in history can be saved as a program', async () => {
  const user = userEvent.setup();
  render(html`<${Progress} />`);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row');
  await user.click(rows[rows.length - 1]); // oldest: s1 at Alpha, leg press then push-up
  const sheet = await screen.findByRole('dialog', { name: /Alpha$/ });
  await user.click(within(sheet).getByRole('button', { name: 'Save as program' }));
  const save = await screen.findByRole('dialog', { name: 'Save as program' });
  expect(within(save).getByLabelText('Program name')).toHaveValue(`Alpha ${formatDate(day(0, 5))}`);
  await user.click(within(save).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(`Saved as program “Alpha ${formatDate(day(0, 5))}”`)).toBeInTheDocument();
  const [p] = await db.programs.toArray();
  expect(p.items).toEqual([
    { catalogId: 'leg-press', sets: 1, reps: 10 },
    { catalogId: 'push-up', sets: 1, reps: 12 },
  ]);
});

describe('body weight', () => {
  const session = (id, gymId, startedAt, bodyweight) =>
    db.sessions.add({ id, gymId, startedAt, endedAt: startedAt + 3600_000, lastActivityAt: startedAt, bodyweight });

  test('session rows show the body weight noted for that session', async () => {
    await session('s1', gA, day(0, 5), 82.5);
    await session('s2', gB, day(1, 9));
    render(html`<${Progress} />`);
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    await vi.waitFor(() => expect(rows[2]).toHaveTextContent('BW 82.5 kg'));
    expect(rows[1]).not.toHaveTextContent('BW');
  });

  test('the history sheet edits an ended session’s body weight (decimal comma), refuses bad values, clears it', async () => {
    const user = userEvent.setup();
    await session('s1', gA, day(0, 5), 82.5);
    render(html`<${Progress} />`);
    const table = await screen.findByRole('table');
    await user.click(within(table).getAllByRole('row')[2]);
    const sheet = await screen.findByRole('dialog', { name: /Alpha$/ });
    expect(sheet).toHaveTextContent('Body weight · 82.5 kg');
    await user.click(within(sheet).getByRole('button', { name: 'Edit body weight' }));
    const input = within(sheet).getByLabelText('Body weight, kg');
    expect(input).toHaveValue('82.5');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('below 500 kg');
    expect((await db.sessions.get('s1')).bodyweight).toBe(82.5);
    await user.clear(input);
    await user.type(input, '81,7{Enter}');
    await vi.waitFor(async () => expect((await db.sessions.get('s1')).bodyweight).toBe(81.7));
    expect(await within(sheet).findByText('Body weight · 81.7 kg')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Edit body weight' }));
    await user.clear(within(sheet).getByLabelText('Body weight, kg'));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await vi.waitFor(async () => expect((await db.sessions.get('s1')).bodyweight).toBeNull());
    expect(await within(sheet).findByRole('button', { name: 'Add body weight' })).toBeInTheDocument();
  });

  test('Body weight view: empty state explains the BW field', async () => {
    const user = userEvent.setup();
    render(html`<${Progress} />`);
    await user.click(await screen.findByRole('button', { name: 'Body weight' }));
    expect(screen.getByText('No body weight noted yet.')).toBeInTheDocument();
    expect(screen.getByText(/BW field at the top of the session screen/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Exercise')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Gyms' })).toBeNull();
    expect(charts.configs).toHaveLength(0);
  });

  test('Body weight view: chart with 4-week average, summary, date slicers apply, gyms do not', async () => {
    const user = userEvent.setup();
    await session('s1', gA, day(0, 5), 84);
    await session('s2', gB, day(1, 9), 82);
    await session('s3', gA, new Date(2025, 11, 20, 10).getTime(), 86);
    render(html`<${Progress} />`);
    await user.click(await screen.findByRole('button', { name: 'Body weight' }));
    const cfg = lastConfig();
    expect(cfg.data.datasets[0].data.map((p) => p.y)).toEqual([86, 84, 82]);
    expect(cfg.data.datasets[1].borderDash).toBeTruthy();
    expect(screen.getByText('Latest').nextSibling).toHaveTextContent('82 kg');
    expect(screen.getByText('Change').nextSibling).toHaveTextContent('−4 kg');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);

    await user.selectOptions(screen.getByLabelText('Year'), '2026');
    expect(lastConfig().data.datasets[0].data.map((p) => p.y)).toEqual([84, 82]);
    expect(screen.getByText('Change').nextSibling).toHaveTextContent('−2 kg');

    // Rows open the session sheet, where the body weight can be edited.
    await user.click(within(screen.getByRole('table')).getAllByRole('row')[1]);
    const sheet = await screen.findByRole('dialog', { name: /Beta$/ });
    expect(sheet).toHaveTextContent('Body weight · 82 kg');
  });
});
