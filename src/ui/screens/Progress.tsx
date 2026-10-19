import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getCatalog } from '../../db/catalogRepo';
import { db } from '../../db/db';
import { listGyms } from '../../db/gymRepo';
import { CATEGORIES } from '../../domain/catalog';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/metrics';
import { buildSeries, buildSessionList, buildTableRows, gymColor } from '../../domain/progress';
import { emptySlice, filterSets, sliceOptions, type Slice } from '../../domain/slicing';
import type { Category } from '../../domain/types';
import ProgressChart from '../components/ProgressChart';
import TopBar from '../components/TopBar';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toNum = (v: string) => (v === '' ? null : Number(v));

export default function Progress() {
  const [slice, setSlice] = useState<Slice>(emptySlice);
  const [metric, setMetric] = useState<'e1rm' | 'volume'>('e1rm');
  const data = useLiveQuery(async () => {
    const [sets, gyms, catalog] = await Promise.all([
      db.sets.toArray(),
      listGyms({ includeArchived: true }),
      getCatalog(),
    ]);
    return { sets, gyms, catalog };
  }, []);

  const sets = data?.sets;
  const gyms = data?.gyms;
  const catalog = data?.catalog;

  const colorFor = useCallback(
    (gymId: string) => gymColor(Math.max(0, gyms?.findIndex((g) => g.id === gymId) ?? 0)),
    [gyms],
  );
  const gymName = useCallback((gymId: string) => gyms?.find((g) => g.id === gymId)?.name ?? '', [gyms]);

  const view = useMemo(() => {
    if (!sets || !catalog) return null;
    // Each date slicer's options come from the data left by every other slicer and any wider date slicer.
    const base = { ...slice, year: null, month: null, week: null };
    const years = sliceOptions(filterSets(sets, base, catalog)).years;
    const year = slice.year !== null && years.includes(slice.year) ? slice.year : null;
    const months = sliceOptions(filterSets(sets, { ...base, year }, catalog)).months;
    const month = slice.month !== null && months.includes(slice.month) ? slice.month : null;
    const weeks = sliceOptions(filterSets(sets, { ...base, year, month }, catalog)).weeks;
    const week = slice.week !== null && weeks.includes(slice.week) ? slice.week : null;
    const filtered = filterSets(sets, { ...slice, year, month, week }, catalog);
    const ex = slice.catalogId ? (catalog.find((c) => c.id === slice.catalogId) ?? null) : null;
    const withData = new Set(
      filterSets(sets, { ...emptySlice(), category: slice.category }, catalog).map((s) => s.catalogId),
    );
    return {
      years,
      months,
      weeks,
      ex,
      exercises: catalog.filter((c) => withData.has(c.id)),
      gymsWithData: new Set(sets.map((s) => s.gymId)),
      series: ex ? buildSeries(filtered, ex, metric) : null,
      rows: ex ? buildTableRows(filtered, ex) : null,
      sessions: ex ? null : buildSessionList(filtered, catalog),
    };
  }, [sets, catalog, slice, metric]);

  if (!view || !gyms || !catalog)
    return (
      <main className="screen progress">
        <TopBar route={{ name: 'progress' }} title="Progress" />
      </main>
    );
  const { ex, series, rows, sessions } = view;

  const set = (patch: Partial<Slice>) => setSlice((s) => ({ ...s, ...patch }));
  const toggleGym = (id: string) =>
    set({ gymIds: slice.gymIds.includes(id) ? slice.gymIds.filter((g) => g !== id) : [...slice.gymIds, id] });
  const setCategory = (category: Category | null) => {
    const keep = category === null || catalog.find((c) => c.id === slice.catalogId)?.category === category;
    set({ category, catalogId: keep ? slice.catalogId : null });
  };
  const volumeTitle = ex?.assisted ? 'Volume (assist kg)' : ex?.kind === 'bodyweight' ? 'Volume (added kg)' : 'Volume';
  const fixedMetric = series ? series.metric === 'reps' || series.metric === 'assist' : false;

  const gymCell = (gymId: string) => (
    <td>
      <span className="dot" style={{ background: colorFor(gymId) }} aria-hidden="true" />
      {gymName(gymId)}
    </td>
  );

  return (
    <main className="screen progress">
      <TopBar route={{ name: 'progress' }} title="Progress" />

      <div className="slicers">
        <label className="field">
          Category
          <select value={slice.category ?? ''} onChange={(e) => setCategory((e.target.value || null) as Category | null)}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Exercise
          <select value={slice.catalogId ?? ''} onChange={(e) => set({ catalogId: e.target.value || null })}>
            <option value="">None</option>
            {view.exercises.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Year
          <select value={slice.year ?? ''} onChange={(e) => set({ year: toNum(e.target.value), month: null, week: null })}>
            <option value="">All</option>
            {view.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Month
          <select value={slice.month ?? ''} onChange={(e) => set({ month: toNum(e.target.value), week: null })}>
            <option value="">All</option>
            {view.months.map((m) => (
              <option key={m} value={m}>
                {MONTH_NAMES[m - 1]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Week
          <select value={slice.week ?? ''} onChange={(e) => set({ week: toNum(e.target.value) })}>
            <option value="">All</option>
            {view.weeks.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chips" role="group" aria-label="Gyms">
        {gyms
          .filter((g) => view.gymsWithData.has(g.id))
          .map((g) => (
            <button
              key={g.id}
              className={'btn btn-small chip' + (slice.gymIds.includes(g.id) ? ' chip-on' : '')}
              aria-pressed={slice.gymIds.includes(g.id)}
              onClick={() => toggleGym(g.id)}
            >
              <span className="dot" style={{ background: colorFor(g.id) }} aria-hidden="true" />
              {g.name}
            </button>
          ))}
      </div>

      {ex && series && rows && (
        <>
          <div className="segmented" role="group" aria-label="Metric">
            <button
              className="btn btn-small"
              aria-pressed={series.metric === 'e1rm'}
              disabled={fixedMetric}
              onClick={() => setMetric('e1rm')}
            >
              e1RM
            </button>
            <button
              className="btn btn-small"
              aria-pressed={series.metric === 'volume'}
              disabled={fixedMetric}
              onClick={() => setMetric('volume')}
            >
              Volume
            </button>
          </div>
          {series.points.length > 0 && (
            <ProgressChart points={series.points} metric={series.metric} colorFor={colorFor} gymName={gymName} />
          )}
          {series.metric === 'reps' && <p className="hint">Bodyweight: total reps per session</p>}
          {series.metric === 'assist' && <p className="hint">Assisted: lower is better</p>}
          {rows.length === 0 && <p className="hint">No sessions for this selection.</p>}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Gym</th>
                    <th>Sets</th>
                    <th>Best e1RM</th>
                    <th>{volumeTitle}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sessionId}>
                      <td>{formatDate(r.date)}</td>
                      {gymCell(r.gymId)}
                      <td>{r.setsText}</td>
                      <td>{r.bestE1rm === null ? '–' : formatWeight(Math.round(r.bestE1rm * 10) / 10)}</td>
                      <td>{formatWeight(r.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {sessions && (
        <>
          {sessions.length === 0 && <p className="hint">No sessions logged yet.</p>}
          {sessions.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Gym</th>
                    <th>Exercises</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td>{formatDate(s.date)}</td>
                      {gymCell(s.gymId)}
                      <td>{s.exercises.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
