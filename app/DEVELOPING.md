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
| `js/db/db.js` | Dexie database `rwtm`: tables and schema versions (2 added `programs`) |
| `js/db/cloudSync.js` | Sync between Dexie and the artifact `db` capability |
| `js/db/*Repo.js`, `backup.js`, `demo.js` | Reads and writes for gyms/machines, sessions/sets, programs (`programRepo.js`: list, add/edit/move/delete, start a session from one, swap a plan item, save a session as one), settings, catalogue, backups, demo data |
| `js/domain/*.js` | Pure logic: exercise catalogue, loading/weights, records and progress, programs (`programs.js`: availability at a gym, machine choice, swap alternatives, plan progress, session → program), CSV, Claude prompt and import format, JSON from pasted text (`jsonText.js`), `types.js` (record shapes as JSDoc) |
| `js/ui/App.js`, `router.js` | Screen switch and hash routes as plain `#name`s the claude.ai host passes through (`#gyms`, `#session--<id>`, `#programs--<gymId>--<programId or new>`, `#prefs` ...; segments escape non-alphanumerics as `-xx`; old `#/path` links still parse) |
| `js/ui/screens/*.js` | One file per screen: Home, Gyms, GymDetail, ExerciseEdit, Session (with a program's plan as a to-do list), Picker, Logging, Programs (a gym's program list), ProgramEdit, Progress, Settings |
| `js/ui/components/*.js` | Sheets (including `ExportSheet`: Save file / Copy / the text, `PasteBox`: paste-to-import, `ExercisePickerSheet`: the whole catalogue, `SaveProgramSheet`), `PickerColumns` (the picker's category columns), wheels, stepper, plate picker, chart, icons, rest timer |
| `js/ui/lib/*.js` | In-page confirm sheet, file save/share (downloads capability), error text, `swipeNav.js` (swipe right = back, left = forward; installed once in `main.js`) |

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
| `sessions` | `{ id, gymId, startedAt, endedAt, lastActivityAt, bodyweight?, programId?, plan? }` (times in ms; `endedAt` null while open) |
| `sets` | `{ id, sessionId, gymId, catalogId, gymExerciseId, order, weight, reps, baseWeight, unit, completedAt }` |
| `kv` | `settings`: `{ key: "settings", value: { theme, autoCloseMinutes, lastBackupAt } }` |
| `programs` | `{ id, name, order, archived, items: [{ catalogId, sets, reps }], createdAt, updatedAt }`: a gym-independent program |

Programs hold catalogue exercises and target sets × reps, never weights or machines; each gym supplies its
own machine (the only visible one, else the one last used there, else the user is asked once). A session
started from a program has `programId` and `plan` (`[{ catalogId, sets, reps }]`, a copy taken at start, so
editing or deleting the program never rewrites history; swapping a missing exercise edits only `plan`). Both
fields are absent on sessions logged without a program and in older data. `bodyweight` is typed in the BW field on the
Session screen while it is open; Progress shows it on session rows, edits it on ended sessions too
(`setHistoryBodyweight`) and charts it in its Body weight view. Backups carry `programs` (backup
format still version 1); a backup without the list restores with no programs.

`loading` is one of `{ type: "stack", weights, unit?, addOns? }`, `{ type: "plate", base, step }`,
`{ type: "plates", base, plates, sides }`, `{ type: "free", start, step, max, bigStepFrom?, bigStep? }` or
`{ type: "bodyweight", step, max }`. Built-in exercises (`catalogId`) are in `js/domain/catalog.js`. See
`js/domain/types.js` for every field.

A schema change needs a new `this.version(n)` in `db.js` (never edit earlier versions; version 2 added
`programs`) and, if the cloud documents change shape, a migration that rewrites them. A new table also goes
into `TABLES`/`PRIMARY_KEY` in `cloudSync.js`, the backup, and the artifact's db rules (below).

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
- Choose files does not work in the Claude Android app (its WebView opens no picker); `navigator.share` is
  refused and `<a download>` does nothing there. So every import must also accept paste, and every export
  must also offer Copy:
  - Import: next to "Choose file", a "Paste" option (`PasteBox`, or the machine sheet's text area). Both
    routes call one function that takes the text; JSON is read with `parseJsonText`, which also accepts a
    ```json fence or prose around the object.
  - Export: open `ExportSheet` with `{ title, filename, text, blob, onDone? }`. "Save file" tries the
    downloads capability and then the browser's paths; "Copy" calls `clipboard.writeText` in the click
    handler and, if refused, selects the read-only text and says "Select all and copy". `onDone` runs only
    after a confirmed save or copy (Export backup stamps "Last backup" there).
  - Text areas holding file contents are uncontrolled (read through a ref), so a ~1 MB backup does not
    re-render the screen on every change.

- Back and forward are swipes (`js/ui/lib/swipeNav.js`), because the Claude Android app's back button and
  edge gesture exit the artifact. Swipe right does what browser back does in `router.js` (`goBack`: close
  the top sheet, else up one level; nothing at Home); swipe left (`goForward`) returns to the screen the last
  back step left, and only then. A touch is a swipe when it starts more than 32px (`EDGE_PX`) from either
  edge (Android owns those), is horizontal at 12px (|dx| > 1.5·|dy|; otherwise it is left to scrolling) and
  is released past a third of the width or flung (> 0.5 px/ms, > 60px). Touches starting in form fields,
  `.wheel`, `canvas`, or anything that scrolls sideways (`overflow-x: auto|scroll` and wider than its box)
  never swipe. **Mark any other horizontally interactive element (a slider, a sideways drag) with
  `data-no-swipe`**, which covers it and everything inside it. Do not add a sheet drag-to-close sideways:
  a horizontal swipe on a sheet already closes it.

## The published artifact

- Link: https://claude.ai/artifact/1hz2hEAuUHzNTyBzoud7pc. Always republish to this link (from another
  conversation pass it as `url`); a new link means a new, empty database.
- Capabilities declared at first publish (omit `capabilities` on republish to keep them):
  `{db:{rules:[{path:<each of gyms, customCatalog, gymExercises, sessions, sets, kv, programs>, read:"admin", write:"admin"}]}, user:{}, downloads:true}`.
  Adding a collection means restating the full declaration with a rule for it. The `programs` rule came
  with programs: the publish that first ships them must restate the declaration including it (a rule per
  collection; a single `path: ""` rule covers it already), or the page cannot load the `programs`
  collection and stops at the load error screen.
- `index.html` is page content only: claude.ai adds the doctype/head/body skeleton at publish.
- The data lives in the artifact's database, not in the page, so republishing never touches it.

## Syncing with GitHub

The repo (fork branch) holds `app/` plus `test/`, `vitest.config.js` and `package.json`.

- After changing the artifact on claude.ai: copy the changed files from the published artifact into `app/`
  (same paths), then `npm install && npm test`, and commit.
- To publish from the repo: publish `app/index.html` with every other file in `app/` as supporting files at
  the same relative paths, to the same artifact URL.
- Local run: `npm run serve` (serves `app/` at http://localhost:8080; outside claude.ai it uses local IndexedDB).

## Known items for later

- **Set documents.** Each set is its own doc in `sets` (~1,250 a year at 3 sessions × 8 sets a week). The app loads every collection at startup, and the db guidance is "hundreds to low thousands" of docs per queried collection. If startup slows (likely after 2–3 years), store each session's sets inside its `sessions/<id>` doc — change only the cloud mapping in `js/db/cloudSync.js` (and the skills' doc shapes); keep Dexie rows as they are so the fork stays close to `main` and backups stay compatible. Hard cap is 25,000 docs.
