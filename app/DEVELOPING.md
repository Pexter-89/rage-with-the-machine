# Developing the artifact

This folder is the whole app, file for file as it is published. There is no build step: the browser runs
these files directly. Edit a file, publish the folder again, reload.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page: stylesheet link, the import map (library versions), `<script type="module" src="js/main.js">` |
| `styles.css` | All styles. Colours are tokens on `:root` / `[data-theme]`; with no theme saved the page follows `prefers-color-scheme` |
| `js/main.js` | Startup: in-memory fallback, cloud load, loading/error/retry screen, sync banners, renders `App` |
| `js/bootstrap.js` | Theme, closing stale sessions, persistent storage request |
| `js/lib/html.js` | `html` tag (htm bound to React.createElement) and `Fragment`; every UI file imports it |
| `js/lib/useLiveQuery.js` | `useLiveQuery(query, deps)`: re-renders when the Dexie tables a query read change |
| `js/db/db.js` | Dexie database `rwtm`: tables and schema version |
| `js/db/cloudSync.js` | Sync between Dexie and the artifact `db` capability |
| `js/db/*Repo.js`, `backup.js`, `demo.js` | Reads and writes for gyms/machines, sessions/sets, settings, catalogue, backups, demo data |
| `js/domain/*.js` | Pure logic: exercise catalogue, loading/weights, records and progress, CSV, Claude prompt and import format, `types.js` (record shapes as JSDoc) |
| `js/ui/App.js`, `router.js` | Screen switch and hash routes (`#/gyms`, `#/session/<id>` ...) |
| `js/ui/screens/*.js` | One file per screen: Home, Gyms, GymDetail, ExerciseEdit, Session, Picker, Logging, Progress, Settings |
| `js/ui/components/*.js` | Sheets, wheels, plate picker, chart, icons, rest timer |
| `js/ui/lib/*.js` | In-page confirm sheet, file save/share (downloads capability), error text |

Tests live outside this folder (`test/`, mirroring `js/`) so they are not published.

## Data

The artifact's `db` capability is the source of truth; Dexie (IndexedDB, or an in-memory copy when the frame
refuses IndexedDB) is the working store. On start the page loads every collection and replaces its local
copy, then writes each local change through and applies changes made elsewhere (for example by Claude with
its data tools) while open. Publish with:

```
capabilities: { db: { rules: [{ path: "", read: "admin", write: "admin" }] }, downloads: {} }
```

One collection per Dexie table, one document per row. Document id = the row's `id` (`key` for `kv`), with
characters outside `A-Z a-z 0-9 _ - . : @ +` written as `~xx` bytes (`encodeDocId` in `cloudSync.js`). The
body is the row as JSON:

| Collection | Document body |
| --- | --- |
| `gyms` | `{ id, name, order, archived }` |
| `gymExercises` | `{ id, gymId, catalogId, label, notes, loading, hidden }`: a machine at a gym |
| `customCatalog` | `{ id, name, category, kind, equipment?, unilateral?, assisted?, defaultLoading?, builtIn: false }` |
| `sessions` | `{ id, gymId, startedAt, endedAt, lastActivityAt, bodyweight? }` (times in ms; `endedAt` null while open) |
| `sets` | `{ id, sessionId, gymId, catalogId, gymExerciseId, order, weight, reps, baseWeight, unit, completedAt }` |
| `kv` | `settings`: `{ key: "settings", value: { theme, autoCloseMinutes, lastBackupAt } }` |

`loading` is one of `{ type: "stack", weights, unit?, addOns? }`, `{ type: "plate", base, step }`,
`{ type: "plates", base, plates, sides }`, `{ type: "free", start, step, max, bigStepFrom?, bigStep? }` or
`{ type: "bodyweight", step, max }`. Built-in exercises (`catalogId`) are in `js/domain/catalog.js`. See
`js/domain/types.js` for every field.

A schema change needs a new `this.version(n)` in `db.js` (never edit version 1) and, if the cloud documents
change shape, a migration that rewrites them.

## Changing a feature

1. Find the screen or module in the table above (a screen's text is usually a good search term).
2. Edit the file. UI is plain function components returning `html` templates; data goes through the repo
   modules, and screens read it with `useLiveQuery`.
3. Publish this folder again (all files, same artifact) and reload. Open the browser console for errors.
4. If you change behaviour, update the matching test under `test/` when you are back in the repo.

## Conventions

- No build, no TypeScript, no JSX. Modern ES modules with `.js` in every relative import.
- Markup: ``html`<div className="x" onClick=${fn}>${text}</div>` ``. Components go in `${}`:
  ``html`<${Sheet} open=${o} onClose=${c}>...</${Sheet}>` ``; fragments use `<${Fragment}>`. HTML
  entities are not decoded: type the character (`&`, `×`).
- Libraries come only from the import map in `index.html`, cdn.jsdelivr.net `/+esm` URLs pinned to exact
  versions that match `package.json`. Code imports them by bare name (`'react'`, `'dexie'`), so the same
  files run in the tests from node_modules. React must load once: keep `react` and `react-dom` on the same
  version (react-dom's build imports `/npm/react@<version>/+esm`, the URL `react` maps to).
- Comments explain why; JSDoc types where they help a reader.

## Syncing with GitHub

The repo (fork branch) holds `app/` plus `test/`, `vitest.config.js` and `package.json`.

- After changing the artifact on claude.ai: copy the changed files from the published artifact into `app/`
  (same paths), then `npm install && npm test`, and commit.
- To publish from the repo: publish `app/index.html` with every other file in `app/` as supporting files at
  the same relative paths, to the same artifact URL.
- Local run: `npm run serve` (serves `app/` at http://localhost:8080; outside claude.ai it uses local IndexedDB).
