import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { getCatalog } from '../../db/catalogRepo.js';
import { db } from '../../db/db.js';
import { listGyms } from '../../db/gymRepo.js';
import { CATEGORIES } from '../../domain/catalog.js';
import { formatDate } from '../../domain/dates.js';
import { formatWeight } from '../../domain/metrics.js';
import {
  bodyweightPoints,
  bodyweightSummary,
  buildSeries,
  buildSessionList,
  buildTableRows,
  gymColor,
  rollingAverage,
} from '../../domain/progress.js';
import { emptySlice, filterSets, sliceOptions } from '../../domain/slicing.js';
import { clearHistory } from '../../db/sessionRepo.js';
import ConfirmSheet from '../components/ConfirmSheet.js';
import HistorySheet from '../components/HistorySheet.js';
import SaveProgramSheet from '../components/SaveProgramSheet.js';
import ProgressChart from '../components/ProgressChart.js';
import TopBar from '../components/TopBar.js';
import { Fragment, html } from '../../lib/html.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {string} v */
const toNum = (v) => (v === '' ? null : Number(v));

/** @param {number} kg */
const bwText = (kg) => `BW ${formatWeight(kg)} kg`;

/** @param {number | null} d */
const signed = (d) => (d === null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${formatWeight(Math.abs(d))} kg`);

/**
 * Body weight points under the date slicers only (gym, category and exercise do not apply to body weight).
 * @param {ProgressPoint[]} points
 * @param {{ year: number | null, month: number | null, week: number | null }} dates
 */
const pointsInDates = (points, dates) => {
  const keep = new Set(
    filterSets(
      points.map((p) => /** @type {any} */ ({ sessionId: p.sessionId, completedAt: p.date })),
      { ...emptySlice(), ...dates },
      [],
    ).map((x) => x.sessionId),
  );
  return points.filter((p) => keep.has(p.sessionId));
};
/** @param {ProgressPoint[]} points */
const pointDates = (points) => sliceOptions(points.map((p) => /** @type {any} */ ({ completedAt: p.date })));

export default function Progress() {
  const [slice, setSlice] = useState(emptySlice);
  /** 'training' (sets by exercise or session) or 'bodyweight'. */
  const [mode, setMode] = useState('training');
  const [metric, setMetric] = useState('e1rm');
  /** The session whose sets are open in the history sheet. */
  const [opened, setOpened] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** A session being saved as a program: { sessionId, name }. */
  const [saving, setSaving] = useState(null);
  const [savedAs, setSavedAs] = useState(null);
  const data = useLiveQuery(async () => {
    const [sets, gyms, catalog, sessionRows] = await Promise.all([
      db.sets.toArray(),
      listGyms({ includeArchived: true }),
      getCatalog(),
      db.sessions.toArray(),
    ]);
    return { sets, gyms, catalog, sessionRows };
  }, []);

  const sets = data?.sets;
  const gyms = data?.gyms;
  const catalog = data?.catalog;
  const sessionRows = data?.sessionRows;

  const colorFor = useCallback((gymId) => gymColor(Math.max(0, gyms?.findIndex((g) => g.id === gymId) ?? 0)), [gyms]);
  const gymName = useCallback((gymId) => gyms?.find((g) => g.id === gymId)?.name ?? '', [gyms]);

  const view = useMemo(() => {
    if (!sets || !catalog || !sessionRows) return null;
    if (mode === 'bodyweight') {
      // Date slicers narrow body weight like sets; their options come from the body weight entries.
      const all = bodyweightPoints(sessionRows);
      const years = pointDates(all).years;
      const year = slice.year !== null && years.includes(slice.year) ? slice.year : null;
      const months = pointDates(pointsInDates(all, { year, month: null, week: null })).months;
      const month = slice.month !== null && months.includes(slice.month) ? slice.month : null;
      const weeks = pointDates(pointsInDates(all, { year, month, week: null })).weeks;
      const week = slice.week !== null && weeks.includes(slice.week) ? slice.week : null;
      const points = pointsInDates(all, { year, month, week });
      return {
        mode,
        years,
        months,
        weeks,
        anyBodyweight: all.length > 0,
        points,
        trend: rollingAverage(points),
        summary: bodyweightSummary(points),
      };
    }
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
      mode,
      filtered,
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
  }, [sets, catalog, sessionRows, slice, metric, mode]);

  if (!view || !gyms || !catalog)
    return html`
      <main className="screen progress">
        <${TopBar} route=${{ name: 'progress' }} title="Progress" />
      </main>
    `;
  const { ex, series, rows, sessions } = view;
  const bwView = view.mode === 'bodyweight' ? view : null;
  const bwById = new Map(
    sessionRows.filter((x) => typeof x.bodyweight === 'number').map((x) => [x.id, /** @type {number} */ (x.bodyweight)]),
  );
  const bwLine = (sessionId) =>
    bwById.has(sessionId) && html`<span className="row-bw">${bwText(/** @type {number} */ (bwById.get(sessionId)))}</span>`;

  const set = (patch) => setSlice((s) => ({ ...s, ...patch }));
  const toggleGym = (id) =>
    set({ gymIds: slice.gymIds.includes(id) ? slice.gymIds.filter((g) => g !== id) : [...slice.gymIds, id] });
  const setCategory = (category) => {
    const keep = category === null || catalog.find((c) => c.id === slice.catalogId)?.category === category;
    set({ category, catalogId: keep ? slice.catalogId : null });
  };
  const volumeTitle = ex?.assisted ? 'Volume (assist kg)' : ex?.kind === 'bodyweight' ? 'Volume (added kg)' : 'Volume';
  const fixedMetric = series ? series.metric === 'reps' || series.metric === 'assist' : false;

  const open = (r) =>
    setOpened({
      sessionId: r.sessionId,
      title: `${formatDate(r.date)} · ${gymName(r.gymId)}`,
      programName: `${gymName(r.gymId)} ${formatDate(r.date)}`.trim(),
    });
  const dateButton = (r) =>
    html`
    <button
      className="link-btn"
      onClick=${(e) => {
        e.stopPropagation();
        open(r);
      }}
    >
      ${formatDate(r.date)}
    </button>
  `;
  // The sheet shows every set of the session (body weight view has no filtered sets).
  const openedSets = opened
    ? (bwView ? sets : view.filtered).filter((x) => x.sessionId === opened.sessionId).sort((a, b) => a.completedAt - b.completedAt)
    : [];
  const nameById = new Map(catalog.map((c) => [c.id, c.name]));
  const sessionCount = new Set(sets.map((x) => x.sessionId)).size;

  const gymCell = (gymId) =>
    html`
    <td>
      <span className="dot" style=${{ background: colorFor(gymId) }} aria-hidden="true" />
      ${gymName(gymId)}
    </td>
  `;

  /** @param {{ anyBodyweight: boolean, points: ProgressPoint[], trend: { date: number, value: number }[], summary: any }} v */
  const bodyweightSection = (v) => {
    if (!v.anyBodyweight)
      return html`
      <div className="empty-bw">
        <p><strong>No body weight noted yet.</strong></p>
        <p className="hint">
          Type it in the BW field at the top of the session screen while you train. For a past session, open it from
          Training (tap its row) and use Add next to Body weight.
        </p>
      </div>
    `;
    if (v.points.length === 0) return html`<p className="hint">No body weight noted in this period.</p>`;
    const { summary } = v;
    const newestFirst = [...v.points].reverse();
    return html`
      <${Fragment}>
        <dl className="bw-summary">
          <div>
            <dt>Latest</dt>
            <dd>${`${formatWeight(summary.latest)} kg`}</dd>
            <dd className="bw-sub">${formatDate(summary.latestDate)}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>${signed(summary.change)}</dd>
            <dd className="bw-sub">${`over ${v.points.length} ${v.points.length === 1 ? 'entry' : 'entries'}`}</dd>
          </div>
          <div>
            <dt>4-wk avg</dt>
            <dd>${`${formatWeight(summary.average4w)} kg`}</dd>
            <dd className="bw-sub">to latest</dd>
          </div>
        </dl>
        <${ProgressChart}
          points=${v.points}
          metric="bodyweight"
          trend=${v.trend}
          gymName=${gymName}
          label="Body weight chart"
        />
        <p className="hint">Dots: each session's body weight. Dashed line: 4-week average.</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Gym</th>
                <th>Body weight</th>
              </tr>
            </thead>
            <tbody>
              ${newestFirst.map(
                (p) =>
                  html`
                <tr key=${p.sessionId} className="clickable" onClick=${() => open(p)}>
                  <td>${dateButton(p)}</td>
                  ${gymCell(p.gymId)}
                  <td>${`${formatWeight(p.value)} kg`}</td>
                </tr>
              `,
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">Tap a row to edit its body weight.</p>
      </${Fragment}>
    `;
  };

  return html`
    <main className="screen progress">
      <${TopBar} route=${{ name: 'progress' }} title="Progress" />

      <div className="segmented" role="group" aria-label="View">
        <button className="btn btn-small" aria-pressed=${mode === 'training'} onClick=${() => setMode('training')}>
          Training
        </button>
        <button className="btn btn-small" aria-pressed=${mode === 'bodyweight'} onClick=${() => setMode('bodyweight')}>
          Body weight
        </button>
      </div>

      <div className="slicers">
        ${
          !bwView &&
          html`
        <${Fragment}>
        <label className="field">
          Category
          <select value=${slice.category ?? ''} onChange=${(e) => setCategory(e.target.value || null)}>
            <option value="">All</option>
            ${CATEGORIES.map(
              (c) =>
                html`
              <option key=${c.id} value=${c.id}>
                ${c.name}
              </option>
            `,
            )}
          </select>
        </label>
        <label className="field">
          Exercise
          <select value=${slice.catalogId ?? ''} onChange=${(e) => set({ catalogId: e.target.value || null })}>
            <option value="">None</option>
            ${view.exercises.map(
              (c) =>
                html`
              <option key=${c.id} value=${c.id}>
                ${c.name}
              </option>
            `,
            )}
          </select>
        </label>
        </${Fragment}>
        `
        }
        <label className="field">
          Year
          <select value=${slice.year ?? ''} onChange=${(e) => set({ year: toNum(e.target.value), month: null, week: null })}>
            <option value="">All</option>
            ${view.years.map(
              (y) =>
                html`
              <option key=${y} value=${y}>
                ${y}
              </option>
            `,
            )}
          </select>
        </label>
        <label className="field">
          Month
          <select value=${slice.month ?? ''} onChange=${(e) => set({ month: toNum(e.target.value), week: null })}>
            <option value="">All</option>
            ${view.months.map(
              (m) =>
                html`
              <option key=${m} value=${m}>
                ${MONTH_NAMES[m - 1]}
              </option>
            `,
            )}
          </select>
        </label>
        <label className="field">
          Week
          <select value=${slice.week ?? ''} onChange=${(e) => set({ week: toNum(e.target.value) })}>
            <option value="">All</option>
            ${view.weeks.map(
              (w) =>
                html`
              <option key=${w} value=${w}>
                ${w}
              </option>
            `,
            )}
          </select>
        </label>
      </div>

      ${
        !bwView &&
        html`
      <div className="chips" role="group" aria-label="Gyms">
        ${gyms
          .filter((g) => view.gymsWithData.has(g.id))
          .map(
            (g) =>
              html`
            <button
              key=${g.id}
              className=${'btn btn-small chip' + (slice.gymIds.includes(g.id) ? ' chip-on' : '')}
              aria-pressed=${slice.gymIds.includes(g.id)}
              onClick=${() => toggleGym(g.id)}
            >
              <span className="dot" style=${{ background: colorFor(g.id) }} aria-hidden="true" />
              ${g.name}
            </button>
          `,
          )}
      </div>
      `
      }

      ${bwView && bodyweightSection(bwView)}

      ${
        ex &&
        series &&
        rows &&
        html`
        <${Fragment}>
          <div className="segmented" role="group" aria-label="Metric">
            <button
              className="btn btn-small"
              aria-pressed=${series.metric === 'e1rm'}
              disabled=${fixedMetric}
              onClick=${() => setMetric('e1rm')}
            >
              e1RM
              <span className="metric-sub">Estimated one-rep max: the most you could lift once, based on your best set</span>
            </button>
            <button
              className="btn btn-small"
              aria-pressed=${series.metric === 'volume'}
              disabled=${fixedMetric}
              onClick=${() => setMetric('volume')}
            >
              Volume
              <span className="metric-sub">Weight × reps of every set in the session, added up</span>
            </button>
          </div>
          ${
            series.points.length > 0 &&
            html`<${ProgressChart} points=${series.points} metric=${series.metric} colorFor=${colorFor} gymName=${gymName} />`
          }
          ${series.metric === 'reps' && html`<p className="hint">Bodyweight: total reps per session</p>`}
          ${series.metric === 'assist' && html`<p className="hint">Assisted: lower is better</p>`}
          ${rows.length === 0 && html`<p className="hint">No sessions for this selection.</p>`}
          ${
            rows.length > 0 &&
            html`
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Gym</th>
                    <th>Sets</th>
                    <th>Best e1RM</th>
                    <th>${volumeTitle}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(
                    (r) =>
                      html`
                    <tr key=${r.sessionId} className="clickable" onClick=${() => open(r)}>
                      <td>${dateButton(r)}</td>
                      ${gymCell(r.gymId)}
                      <td>${r.setsText}${bwLine(r.sessionId)}</td>
                      <td>${r.bestE1rm === null ? '–' : formatWeight(Math.round(r.bestE1rm * 10) / 10)}</td>
                      <td>${formatWeight(r.volume)}</td>
                    </tr>
                  `,
                  )}
                </tbody>
              </table>
            </div>
          `
          }
        </${Fragment}>
      `
      }

      ${
        sessions &&
        html`
        <${Fragment}>
          ${sessions.length === 0 && html`<p className="hint">No sessions logged yet.</p>`}
          ${
            sessions.length > 0 &&
            html`
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
                  ${sessions.map(
                    (s) =>
                      html`
                    <tr key=${s.sessionId} className="clickable" onClick=${() => open(s)}>
                      <td>${dateButton(s)}</td>
                      ${gymCell(s.gymId)}
                      <td>${s.exercises.join(', ')}${bwLine(s.sessionId)}</td>
                    </tr>
                  `,
                  )}
                </tbody>
              </table>
            </div>
          `
          }
        </${Fragment}>
      `
      }
      ${!!(rows?.length || sessions?.length) && html`<p className="hint">Tap a row to see or delete its sets, or save its session as a program.</p>`}
      ${savedAs && html`<p className="hint" role="status">${`Saved as program “${savedAs}”`}</p>`}

      ${
        sets.length > 0 &&
        html`
        <button className="btn btn-ghost btn-danger-text" onClick=${() => setConfirmClear(true)}>
          Clear all history
        </button>
      `
      }

      <${HistorySheet}
        key=${opened?.sessionId ?? ''}
        title=${opened?.title ?? ''}
        sets=${openedSets}
        nameOf=${ex ? null : (x) => nameById.get(x.catalogId) ?? x.catalogId}
        onClose=${() => setOpened(null)}
        sessionId=${opened?.sessionId ?? null}
        bodyweight=${opened ? (bwById.get(opened.sessionId) ?? null) : null}
        onSaveAsProgram=${
          opened
            ? () => {
                setSaving({ sessionId: opened.sessionId, name: opened.programName });
                setOpened(null);
              }
            : null
        }
      />
      <${SaveProgramSheet}
        sessionId=${saving?.sessionId ?? null}
        defaultName=${saving?.name ?? ''}
        onClose=${() => setSaving(null)}
        onSaved=${(p) => setSavedAs(p.name)}
      />
      <${ConfirmSheet}
        title="Clear all history?"
        message=${
          confirmClear
            ? `All ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} and ${sets.length} ${sets.length === 1 ? 'set' : 'sets'} at every gym will be deleted. Gyms and machines are kept. Export a backup in Settings first if you may want them back.`
            : null
        }
        confirmLabel="Delete all"
        onConfirm=${clearHistory}
        onClose=${() => setConfirmClear(false)}
      />
    </main>
  `;
}
