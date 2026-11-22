import { useRef, useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { getCatalog } from '../../db/catalogRepo.js';
import { db } from '../../db/db.js';
import { exportGymFile, listGymMachines, saveGymExercise } from '../../db/gymRepo.js';
import { CATEGORIES } from '../../domain/catalog.js';
import ExportSheet from '../components/ExportSheet.js';
import ImportMachineSheet from '../components/ImportMachineSheet.js';
import { oneLine } from '../lib/errors.js';
import TopBar from '../components/TopBar.js';
import { navigate } from '../router.js';
import { html } from '../../lib/html.js';

/** @param {{ gymId: string }} props */
export default function GymDetail({ gymId }) {
  const [importing, setImporting] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const fileRef = useRef(null);
  const data = useLiveQuery(async () => {
    const gym = await db.gyms.get(gymId);
    const [catalog, machines, mine] = await Promise.all([
      getCatalog(),
      listGymMachines(gymId),
      db.gymExercises.where('gymId').equals(gymId).toArray(),
    ]);
    return { gym, catalog, machines, mine };
  }, [gymId]);

  if (!data)
    return html`
      <main className="screen">
        <${TopBar} route=${{ name: 'gym', gymId }} />
      </main>
    `;
  const { gym, catalog, machines, mine } = data;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const freeLike = catalog.filter((e) => (e.kind === 'free' || e.kind === 'bodyweight') && e.defaultLoading);
  const overrideOf = (e) => mine.find((ge) => ge.catalogId === e.id);

  async function exportGym() {
    setExportError(null);
    try {
      const file = await exportGymFile(gymId);
      const slug =
        (gym?.name ?? 'gym')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'gym';
      const text = JSON.stringify(file, null, 2);
      setExporting({
        title: 'Export gym file',
        filename: `rwtm-gym-${slug}.json`,
        text,
        blob: new Blob([text], { type: 'application/json' }),
      });
    } catch (e) {
      setExportError(oneLine(e));
    }
  }

  async function toggleHidden(e) {
    const o = overrideOf(e);
    if (o) await db.gymExercises.update(o.id, { hidden: !o.hidden });
    else
      await saveGymExercise({ gymId, catalogId: e.id, label: '', notes: '', loading: e.defaultLoading, hidden: true });
  }

  function openFreeEditor(e) {
    const o = overrideOf(e);
    navigate(o ? { name: 'exercise', gymId, geId: o.id } : { name: 'exercise', gymId, geId: 'new', catalogId: e.id });
  }

  return html`
    <main className="screen">
      <${TopBar} route=${{ name: 'gym', gymId }} title=${gym?.name ?? ''} />

      <h2 className="section-title">Machines</h2>
      ${machines.length === 0 && html`<p className="hint">No machines yet. Import a file from Claude or add one manually.</p>`}
      <ul className="list">
        ${machines.map((ge) => {
          const name = byId.get(ge.catalogId)?.name ?? ge.catalogId;
          return html`
            <li key=${ge.id}>
              <button
                className="btn btn-primary btn-left grow"
                onClick=${() => navigate({ name: 'exercise', gymId, geId: ge.id })}
              >
                <span>${ge.label ? `${name} — ${ge.label}` : name}</span>
                ${ge.hidden && html`<span className="tag">Hidden</span>`}
              </button>
            </li>
          `;
        })}
      </ul>

      <h2 className="section-title">Gym file</h2>
      <p className="hint left">
        Send this gym to someone, or give the file to Claude to edit and load it back with Replace.
      </p>
      <div className="nav-row">
        <button className="btn btn-ghost" onClick=${() => void exportGym()}>
          Export gym file
        </button>
        <button className="btn btn-ghost" onClick=${() => setImporting({ replace: true })}>
          Replace from file
        </button>
      </div>
      ${
        exportError &&
        html`
        <p className="error" role="alert">
          ${exportError}
        </p>
      `
      }

      <h2 className="section-title">Free weights & bodyweight</h2>
      ${CATEGORIES.map((c) => {
        const inCat = freeLike.filter((e) => e.category === c.id);
        if (inCat.length === 0) return null;
        return html`
          <section key=${c.id}>
            <h3 className="column-title">${c.name}</h3>
            <ul className="list">
              ${inCat.map((e) => {
                const hidden = overrideOf(e)?.hidden ?? false;
                return html`
                  <li key=${e.id} className=${'row free-row' + (hidden ? ' archived' : '')}>
                    <button className="btn btn-ghost btn-left grow" onClick=${() => openFreeEditor(e)}>
                      ${e.name}
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      aria-label=${`${hidden ? 'Show' : 'Hide'} ${e.name} here`}
                      aria-pressed=${hidden}
                      onClick=${() => void toggleHidden(e)}
                    >
                      ${hidden ? 'Show here' : 'Hide here'}
                    </button>
                  </li>
                `;
              })}
            </ul>
          </section>
        `;
      })}

      <div className="bottom-actions">
        <input
          ref=${fileRef}
          type="file"
          hidden
          multiple
          aria-label="Machine file"
          accept=".json,.md,.txt,application/json,text/plain,text/markdown"
          onChange=${(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length > 0) setImporting({ files });
          }}
        />
        <button className="btn btn-primary" onClick=${() => fileRef.current?.click()}>
          Import machine files
        </button>
        <button className="btn btn-ghost" onClick=${() => setImporting({})}>
          Paste from Claude
        </button>
        <button className="btn btn-ghost" onClick=${() => navigate({ name: 'exercise', gymId, geId: 'new' })}>
          Add manually
        </button>
      </div>

      <${ExportSheet} item=${exporting} onClose=${() => setExporting(null)} />
      ${
        importing &&
        html`
        <${ImportMachineSheet}
          mode=${importing.replace ? 'replace' : 'add'}
          gymId=${gymId}
          initialFiles=${importing.files}
          onClose=${() => setImporting(null)}
          onImported=${() => {}}
        />
      `
      }
    </main>
  `;
}
