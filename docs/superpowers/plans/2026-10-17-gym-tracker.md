# Rage with the machine — Gym Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user, offline-first gym logging PWA (Android + iPhone via "Add to Home Screen") with per-gym machine setups imported from Claude-generated files, fast wheel-based set logging, and e1RM / volume-load progress views.

**Architecture:** A static React + TypeScript app built with Vite and served from GitHub Pages. All data lives in IndexedDB (Dexie) on the phone. The code splits into pure domain logic (`src/domain`, framework-free, heavily unit-tested), a data layer (`src/db`, Dexie repo functions tested against fake-indexeddb), and UI screens (`src/ui`) that read through `useLiveQuery` and write only through repo functions. Navigation is a tiny hash router, so GitHub Pages needs no server rewrites.

**Tech Stack:** Node 24, TypeScript, React 18+, Vite, vite-plugin-pwa (+ @vite-pwa/assets-generator), Dexie + dexie-react-hooks, Chart.js, Vitest + jsdom + @testing-library/react + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-10-17-gym-tracker-design.md` (read it alongside this plan; § numbers below refer to it). Wireframe: `.superpowers/brainstorm/1077-1792240379/content/main-flow.html`. In the wireframe "Finish session" sits at the bottom; the spec overrides it: small, top corner.

## Global Constraints

- PWA only; no native builds, no developer accounts, no server component, no network calls except loading the app and its updates (§2, §4.1).
- Kilograms only; ISO-8601 weeks, Monday start (§2).
- No modal confirmations on the common logging path. The only confirmations are: backup restore (§3.8) and recomputing history after a plate base edit (§4.4).
- No nagging: no pop-ups, reminders, banners. "Last backup" is a passive text line (§3.8).
- Every completed set is written to IndexedDB immediately; no in-memory-only logging state (§3.4).
- Session auto-close default **30 min** of inactivity; end time = `lastActivityAt`; evaluated on app open/resume (§3.2).
- Logged `weight` meaning (§4.3a): plate machines = total (sled + plates); dumbbells = one dumbbell; barbell = bar + plates; bodyweight = added weight; assisted = assist weight; unilateral reps are per side.
- e1RM = Epley `weight × (1 + reps/30)`, reps = 1 → weight (§3.7). Volume load = Σ(weight × reps).
- Free-weight defaults (§4.2): dumbbells 1 kg steps from 1 kg up to 10, then 2 kg steps; barbell 2.5 kg steps from 20 kg; bodyweight added weight from 0.
- Machine file: `"format": "rwtm-machine"`, `"version": 1`, shape exactly as §5.3; any unknown field is a one-line error and nothing is imported.
- "Last time" = most recent previous session with this canonical exercise **at the same gym if one exists, otherwise at any gym** (§3.4, as edited by the owner).
- Categories, in this order: Legs, Chest, Back, Shoulders, Arms, Core, Full body (§3.3).
- Touch targets ≥ 44 px; layout must respect iOS safe-area insets.
- IDs: `crypto.randomUUID()`. Timestamps: epoch milliseconds (`number`).
- Never run a scaffolder that overwrites the project folder (it already contains `docs/`, `.superpowers/` and `gym-tracker_description.md`).

## Review Focus

1. **App killed or phone locked right after ✓**: the set must be there on reopen, and Home must offer "Resume session". Test: Task 5 `addSet persists across a fresh DB connection`; Task 8 `Home shows resume button for open session`.
2. **Reopening the app hours later mid-session**: the session must be closed at its last activity, not "now", and an empty one discarded. 29 vs 31 minutes must behave correctly. Test: Task 5 `closeStaleSessions` cases.
3. **Messy Claude output pasted in** (prose around it, ```json fences, braces inside prose or strings, unknown fields): JSON is extracted correctly or there's one clear error with nothing imported. Test: Task 6 extraction and validation cases.
4. **Typing a decimal with a comma** (`62,5`) on a Finnish-locale numeric keypad must give 62.5, and junk must be rejected without changing the value. Test: Task 2 `parseWeightInput`; Task 9 `typing 62,5 commits 62.5`.
5. **Restoring a wrong or corrupt backup file** must not wipe existing data. Test: Task 7 `invalid backup leaves data intact`.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, .gitignore
pwa-assets.config.ts                 PWA icon generation config
public/logo.svg                      source icon
.github/workflows/deploy.yml         GitHub Pages deploy
src/
  main.tsx                           React entry, bootstrap()
  bootstrap.ts                       persist storage, auto-close on open/resume, theme
  styles.css                         CSS variables (dark/light), layout, safe areas
  test/setup.ts                      jest-dom, fake-indexeddb/auto
  domain/                            pure logic, no React, no Dexie
    types.ts                         all shared types
    catalog.ts                       CATEGORIES, BUILT_IN_CATALOG, default loadings
    loading.ts                       wheelValues, snapToWheel, parseWeightInput, parseRepsInput
    metrics.ts                       e1rm, volumeLoad, summarizeSets, formatSummary
    dates.ts                         isoWeek, formatDate, formatTime
    slicing.ts                       Slice, filterSets, sliceOptions
    progress.ts                      buildSeries, buildTableRows, gymColor
    importMachine.ts                 extractMachineJson, parseMachineFile
    claudePrompt.ts                  buildClaudePrompt
    csv.ts                           setsToCsv
  db/
    db.ts                            Dexie schema (RwtmDB), db singleton, resetDb() for tests
    catalogRepo.ts                   getCatalog, addCustomEntries
    gymRepo.ts                       gyms + gym exercises + availableExercises + resolveItem
    sessionRepo.ts                   sessions, sets, auto-close, last time, prefill, recompute
    settingsRepo.ts                  getSettings, updateSettings
    backup.ts                        exportBackup, validateBackup, restoreBackup, buildCsvRows
  ui/
    router.ts                        parseRoute, navigate, useRoute
    App.tsx                          route → screen
    lib/share.ts                     shareOrDownload, readFileText
    components/Wheel.tsx             scroll-snap wheel with tap-to-type
    components/Sheet.tsx             bottom sheet (edit set, import preview)
    components/ImportMachineSheet.tsx
    components/ProgressChart.tsx     Chart.js wrapper
    screens/Home.tsx, Session.tsx, Picker.tsx, Logging.tsx,
            Gyms.tsx, GymDetail.tsx, ExerciseEdit.tsx, Progress.tsx, Settings.tsx
```
Tests sit next to their source as `*.test.ts(x)`.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/ui/App.tsx`, `src/test/setup.ts`, `src/ui/App.test.tsx`

**Interfaces:**
- Produces: npm scripts `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`); Vitest env `jsdom` with `src/test/setup.ts` (imports `@testing-library/jest-dom/vitest` and `fake-indexeddb/auto`); `vite.config.ts` reads `base` from `process.env.BASE_PATH ?? '/'`.

- [ ] **Step 1: Initialise git and ignore file.** Run `git init -b main`. `.gitignore`: `node_modules/`, `dist/`, `.superpowers/`, `*.local`, `dev-dist/`.
- [ ] **Step 2: Write `package.json` by hand (do NOT run `npm create vite`)** with `"type": "module"`, the scripts above, then install:
  - `npm i react react-dom dexie dexie-react-hooks chart.js`
  - `npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom fake-indexeddb vite-plugin-pwa @vite-pwa/assets-generator`
- [ ] **Step 3: Write `tsconfig.json`** (strict, `jsx: react-jsx`, `moduleResolution: bundler`, `types: ["vitest/globals"]`), `vite.config.ts` (react plugin, `test` block as above), `index.html` (root div, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`).
- [ ] **Step 4: Write the failing smoke test** `src/ui/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import App from './App';
test('renders app title', () => {
  render(<App />);
  expect(screen.getByText('Rage with the machine')).toBeInTheDocument();
});
```
- [ ] **Step 5: Run `npm test`.** Expected: FAIL (App missing).
- [ ] **Step 6: Create `src/ui/App.tsx`** (renders the title) and `src/main.tsx` (mounts App).
- [ ] **Step 7: Run `npm test` and `npm run build`.** Expected: test PASS, build succeeds.
- [ ] **Step 8: Commit** `git add -A && git commit -m "chore: scaffold Vite React TS app with Vitest"`

---

### Task 2: Domain types, exercise catalogue, loading wheels

**Files:**
- Create: `src/domain/types.ts`, `src/domain/catalog.ts`, `src/domain/loading.ts`
- Test: `src/domain/catalog.test.ts`, `src/domain/loading.test.ts`

**Interfaces:**
- Produces (`types.ts`):
```ts
export type Category = 'legs'|'chest'|'back'|'shoulders'|'arms'|'core'|'fullbody';
export type Kind = 'machine'|'free'|'bodyweight';
export type Unit = 'kg'|'level';
export type Loading =
  | { type: 'stack'; weights: number[]; unit?: Unit }            // unit default 'kg'
  | { type: 'plate'; base: number; step: number }
  | { type: 'free'; start: number; step: number; max: number; bigStepFrom?: number; bigStep?: number }
  | { type: 'bodyweight'; step: number; max: number };
export interface CatalogExercise { id: string; name: string; category: Category; kind: Kind;
  unilateral?: boolean; assisted?: boolean; defaultLoading?: Loading; builtIn: boolean }
export interface Gym { id: string; name: string; order: number; archived: boolean }
export interface GymExercise { id: string; gymId: string; catalogId: string; label: string;
  notes: string; loading: Loading; hidden: boolean }
export interface Session { id: string; gymId: string; startedAt: number; endedAt: number|null; lastActivityAt: number }
export interface SetEntry { id: string; sessionId: string; gymId: string; catalogId: string;
  gymExerciseId: string|null; order: number; weight: number; reps: number;
  baseWeight: number|null; unit: Unit; completedAt: number }
export interface PickerItem { key: string; catalogId: string; gymExerciseId: string|null;
  name: string; label: string; category: Category; loading: Loading; unilateral: boolean; assisted: boolean }
export interface Settings { theme: 'system'|'dark'|'light'; autoCloseMinutes: number; lastBackupAt: number|null }
```
- Produces (`catalog.ts`): `CATEGORIES: {id: Category; name: string}[]` in Global Constraints order; `DUMBBELL_LOADING`, `BARBELL_LOADING`, `BODYWEIGHT_LOADING: Loading`; `BUILT_IN_CATALOG: CatalogExercise[]` (60–80 entries, all `builtIn: true`).
- Produces (`loading.ts`): `wheelValues(l: Loading): number[]`, `snapToWheel(values: number[], w: number): number`, `parseWeightInput(s: string): number|null`, `parseRepsInput(s: string): number|null`.

- [ ] **Step 1: Write failing tests.**
```ts
// catalog.test.ts
import { BUILT_IN_CATALOG, CATEGORIES } from './catalog';
const ids = BUILT_IN_CATALOG.map(e => e.id);
test('ids unique kebab-case', () => {
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach(id => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/));
});
test('every category has ≥3 exercises', () =>
  CATEGORIES.forEach(c => expect(BUILT_IN_CATALOG.filter(e => e.category === c.id).length).toBeGreaterThanOrEqual(3)));
test('free/bodyweight have defaultLoading, machines do not', () =>
  BUILT_IN_CATALOG.forEach(e => expect(!!e.defaultLoading).toBe(e.kind !== 'machine')));
test('ids the plan relies on exist', () => {
  for (const id of ['leg-press','lat-pulldown','chest-press','seated-row','dumbbell-bench-press',
    'barbell-back-squat','pull-up','assisted-pull-up','one-arm-dumbbell-row']) expect(ids).toContain(id);
});
test('flags', () => {
  const by = (id: string) => BUILT_IN_CATALOG.find(e => e.id === id)!;
  expect(by('one-arm-dumbbell-row').unilateral).toBe(true);
  expect(by('assisted-pull-up').assisted).toBe(true);
  expect(by('pull-up').kind).toBe('bodyweight');
});
// loading.test.ts
import { wheelValues, snapToWheel, parseWeightInput, parseRepsInput } from './loading';
import { DUMBBELL_LOADING, BARBELL_LOADING, BODYWEIGHT_LOADING } from './catalog';
test('stack sorted', () => expect(wheelValues({type:'stack',weights:[15,5,10]})).toEqual([5,10,15]));
test('plate from base', () => {
  const v = wheelValues({type:'plate',base:62,step:2.5});
  expect(v.slice(0,3)).toEqual([62,64.5,67]); expect(v.at(-1)).toBe(462);
});
test('dumbbell', () => {
  const v = wheelValues(DUMBBELL_LOADING);
  expect(v.slice(0,12)).toEqual([1,2,3,4,5,6,7,8,9,10,12,14]); expect(v.at(-1)).toBe(60);
});
test('barbell', () => { const v = wheelValues(BARBELL_LOADING); expect(v.slice(0,2)).toEqual([20,22.5]); expect(v.at(-1)).toBe(300); });
test('bodyweight', () => { const v = wheelValues(BODYWEIGHT_LOADING); expect(v.slice(0,3)).toEqual([0,2.5,5]); expect(v.at(-1)).toBe(100); });
test('snap', () => { expect(snapToWheel([5,10,15],12)).toBe(10); expect(snapToWheel([5,10,15],13)).toBe(15); expect(snapToWheel([5,10,15],12.5)).toBe(15); });
test('parseWeightInput', () => {
  expect(parseWeightInput('62,5')).toBe(62.5); expect(parseWeightInput(' 70 ')).toBe(70);
  expect(parseWeightInput('0')).toBe(0); expect(parseWeightInput('-5')).toBeNull(); expect(parseWeightInput('abc')).toBeNull();
  expect(parseWeightInput('')).toBeNull();
});
test('parseRepsInput', () => {
  expect(parseRepsInput('8')).toBe(8); expect(parseRepsInput('8.5')).toBeNull(); expect(parseRepsInput('0')).toBeNull();
});
```
- [ ] **Step 2: Run `npx vitest run src/domain`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Default loadings: dumbbell `{type:'free',start:1,step:1,max:60,bigStepFrom:10,bigStep:2}`, barbell `{type:'free',start:20,step:2.5,max:300}`, bodyweight `{type:'bodyweight',step:2.5,max:100}`. Plate wheel runs to `base + 400`. Round every generated value to 2 decimals to avoid float drift. Snap ties round up. The catalogue contents are the implementer's choice within the tests, including kettlebell/cable exercises as they see fit (kettlebell default `{type:'free',start:4,step:4,max:48}`).
- [ ] **Step 4: Run `npx vitest run src/domain`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: domain types, built-in catalogue and loading wheels`

---

### Task 3: Metrics, dates, slicing, progress series

**Files:**
- Create: `src/domain/metrics.ts`, `src/domain/dates.ts`, `src/domain/slicing.ts`, `src/domain/progress.ts`
- Test: `metrics.test.ts`, `dates.test.ts`, `slicing.test.ts`, `progress.test.ts` (same folder)

**Interfaces:**
- Consumes: types from Task 2.
- Produces:
```ts
// metrics.ts
e1rm(weight: number, reps: number): number
volumeLoad(sets: {weight:number; reps:number}[]): number
interface SetSummary { count: number; minWeight: number; maxWeight: number; minReps: number; maxReps: number }
summarizeSets(sets: {weight:number; reps:number}[]): SetSummary | null
formatSummary(s: SetSummary, unit: Unit): string   // "3 sets · 8–12 reps · 92–112 kg"; single values without dash; 'level' → "L" suffix, e.g. "7–9 L"
// dates.ts
isoWeek(ts: number): { year: number; week: number }
formatDate(ts: number): string    // "10 Oct 2026"
formatTime(ts: number): string    // "17:42"
// slicing.ts
interface Slice { catalogId: string|null; category: Category|null; gymIds: string[]; year: number|null; month: number|null; week: number|null }
emptySlice(): Slice
filterSets(sets: SetEntry[], slice: Slice, catalog: CatalogExercise[]): SetEntry[]
sliceOptions(sets: SetEntry[]): { years: number[]; months: number[]; weeks: number[] }   // present in data, ascending
// progress.ts
type MetricKind = 'e1rm'|'volume'|'reps'|'assist'
interface ProgressPoint { sessionId: string; date: number; gymId: string; value: number }
buildSeries(sets: SetEntry[], ex: CatalogExercise, requested: 'e1rm'|'volume'): { metric: MetricKind; points: ProgressPoint[] }
interface TableRow { sessionId: string; date: number; gymId: string; setsText: string; bestE1rm: number|null; volume: number }
buildTableRows(sets: SetEntry[]): TableRow[]
gymColor(index: number): string
```

- [ ] **Step 1: Write failing tests** (helper `mkSet(partial)` in each test file building a full `SetEntry` with defaults):
```ts
// metrics
expect(e1rm(100,1)).toBe(100); expect(e1rm(100,10)).toBeCloseTo(133.33,2); expect(e1rm(100,0)).toBe(0);
expect(volumeLoad([{weight:62,reps:10},{weight:72,reps:8}])).toBe(1196);
expect(summarizeSets([{weight:62,reps:10},{weight:72,reps:8}])).toEqual({count:2,minWeight:62,maxWeight:72,minReps:8,maxReps:10});
expect(summarizeSets([])).toBeNull();
expect(formatSummary({count:3,minWeight:92,maxWeight:112,minReps:8,maxReps:12},'kg')).toBe('3 sets · 8–12 reps · 92–112 kg');
expect(formatSummary({count:1,minWeight:50,maxWeight:50,minReps:10,maxReps:10},'kg')).toBe('1 set · 10 reps · 50 kg');
// dates
expect(isoWeek(new Date(2026,0,1).getTime())).toEqual({year:2026,week:1});
expect(isoWeek(new Date(2024,11,30).getTime())).toEqual({year:2025,week:1});
expect(isoWeek(new Date(2027,0,1).getTime())).toEqual({year:2026,week:53});
// slicing (fixture: sets across 2 gyms, Dec 2026 → Jan 2027, two exercises)
test('gym filter, empty gymIds = all'); test('year+month');
test('week uses ISO year: year 2026 + week 53 matches 2027-01-01');
test('category filter keeps only exercises in category');
// progress
test('e1rm: one point per session, best set, sorted by date, carries gymId');
test('volume: sum per session');
test('bodyweight exercise → metric reps, value = total reps');
test('assisted exercise → metric assist, value = min weight');
test('level-unit sets are excluded from series');
test('buildTableRows newest first, setsText "62×10, 72×8", level sets "7 L×10", bestE1rm null for bodyweight');
```
Write each named test with concrete fixture values and `expect` assertions matching the behaviour stated in its name.
- [ ] **Step 2: Run `npx vitest run src/domain`.** Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Slicing compares local-time year/month (`month` 1–12) and `isoWeek().year/week` (when `week` is set together with `year`, the ISO year is matched). `gymColor` returns from a fixed 8-colour palette readable on dark and light backgrounds.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: metrics, ISO weeks, slicing and progress series`

---

### Task 4: Database schema, catalogue, gyms, gym exercises, settings

**Files:**
- Create: `src/db/db.ts`, `src/db/catalogRepo.ts`, `src/db/gymRepo.ts`, `src/db/settingsRepo.ts`
- Test: `src/db/gymRepo.test.ts`, `src/db/catalogRepo.test.ts`, `src/db/settingsRepo.test.ts`

**Interfaces:**
- Consumes: types and `BUILT_IN_CATALOG` (Task 2).
- Produces:
```ts
// db.ts — Dexie tables
class RwtmDB extends Dexie {
  gyms: Table<Gym,string>; customCatalog: Table<CatalogExercise,string>;
  gymExercises: Table<GymExercise,string>; sessions: Table<Session,string>;
  sets: Table<SetEntry,string>; kv: Table<{key:string; value:unknown},string> }
// indexes: gyms 'id,order'; customCatalog 'id'; gymExercises 'id,gymId,catalogId';
// sessions 'id,gymId,startedAt,endedAt'; sets 'id,sessionId,catalogId,gymId,gymExerciseId,completedAt'; kv 'key'
export let db: RwtmDB;  export async function resetDb(): Promise<void>   // tests: delete + reopen
// catalogRepo.ts
getCatalog(): Promise<CatalogExercise[]>                 // built-in + custom
addCustomEntries(entries: CatalogExercise[]): Promise<void>   // throws if id collides with existing
// gymRepo.ts
addGym(name: string): Promise<Gym>;  renameGym(id, name): Promise<void>
listGyms(opts?: {includeArchived?: boolean}): Promise<Gym[]>   // sorted by order
moveGym(id: string, delta: -1|1): Promise<void>;  setGymArchived(id, archived: boolean): Promise<void>
deleteGym(id: string): Promise<void>       // throws GymHasSessionsError if sessions exist; also deletes its gymExercises
saveGymExercise(ge: Omit<GymExercise,'id'> & {id?: string}): Promise<GymExercise>
deleteGymExercise(id: string): Promise<void>
listGymMachines(gymId: string): Promise<GymExercise[]>    // kind 'machine' only, sorted by catalogue name then label
availableExercises(gymId: string, catalog: CatalogExercise[]): Promise<PickerItem[]>
resolveItem(gymId: string, key: string, catalog: CatalogExercise[]): Promise<PickerItem|null>
// settingsRepo.ts
getSettings(): Promise<Settings>   // defaults {theme:'system', autoCloseMinutes:30, lastBackupAt:null}
updateSettings(patch: Partial<Settings>): Promise<Settings>
```
- PickerItem key: `gymExerciseId` when present, else `'c:' + catalogId`.

- [ ] **Step 1: Write failing tests** (`beforeEach(resetDb)`):
```ts
test('addGym orders sequentially; listGyms hides archived by default');
test('moveGym swaps order with neighbour; no-op at ends');
test('deleteGym throws GymHasSessionsError when a session exists, else removes gym and its gymExercises');
test('availableExercises: machines of this gym + every free/bodyweight catalogue entry with defaultLoading', async () => {
  const g = await addGym('Kamppi'); const cat = await getCatalog();
  await saveGymExercise({gymId:g.id,catalogId:'leg-press',label:'Technogym',notes:'',loading:{type:'plate',base:62,step:2.5},hidden:false});
  const items = await availableExercises(g.id, cat);
  expect(items.find(i => i.catalogId==='leg-press')!.loading).toEqual({type:'plate',base:62,step:2.5});
  expect(items.some(i => i.catalogId==='lat-pulldown')).toBe(false);          // machine not at this gym
  expect(items.find(i => i.catalogId==='dumbbell-bench-press')!.key).toBe('c:dumbbell-bench-press');
});
test('gym override of a free exercise replaces default loading; hidden override removes it');
test('two machines mapped to same catalogue id both appear, distinguished by label');
test('resolveItem round-trips keys from availableExercises');
test('addCustomEntries rejects an id that already exists');
test('settings defaults and patch');
```
- [ ] **Step 2: Run `npx vitest run src/db`.** Expected: FAIL.
- [ ] **Step 3: Implement** the files with the signatures above.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: Dexie schema, catalogue, gyms and gym exercises`

---

### Task 5: Sessions, sets, auto-close, last time, prefill

**Files:**
- Create: `src/db/sessionRepo.ts`
- Test: `src/db/sessionRepo.test.ts`

**Interfaces:**
- Consumes: Task 4 repo, `summarizeSets` (Task 3).
- Produces:
```ts
getOpenSession(): Promise<Session|null>
startSession(gymId: string, now: number): Promise<Session>        // finishes any open session first
finishSession(id: string, now: number): Promise<void>             // endedAt = now; deletes session if it has no sets
closeStaleSessions(now: number, timeoutMin: number): Promise<void> // stale: now - lastActivityAt > timeoutMin*60000 → endedAt = lastActivityAt, or delete if no sets
addSet(sessionId: string, item: PickerItem, weight: number, reps: number, now: number): Promise<SetEntry>
updateSet(id: string, patch: {weight?: number; reps?: number}, now: number): Promise<void>
deleteSet(id: string, now: number): Promise<void>
setsForItem(sessionId: string, item: PickerItem): Promise<SetEntry[]>   // ordered
interface LastTime { sessionId: string; gymId: string; date: number; sets: SetEntry[] }
getLastTime(catalogId: string, gymId: string, excludeSessionId: string): Promise<LastTime|null>
prefill(current: SetEntry[], last: LastTime|null): {weight: number; reps: number} | null
interface ExerciseSummary { key: string; catalogId: string; gymExerciseId: string|null; firstAt: number; sets: SetEntry[] }
sessionExercises(sessionId: string): Promise<ExerciseSummary[]>     // ordered by first set time
recomputePlateHistory(gymExerciseId: string, oldBase: number, newBase: number): Promise<number>  // returns count changed
```
- `addSet`: `order` = existing count for (session, item) + 1; `gymId` from the session; `baseWeight` = plate `base` else null; `unit` = stack `unit ?? 'kg'`, else `'kg'`; bumps `session.lastActivityAt = now`. `updateSet`/`deleteSet` also bump it. All writes happen in one Dexie transaction each.

- [ ] **Step 1: Write failing tests:**
```ts
test('addSet persists across a fresh DB connection', async () => {
  // start session, addSet, then db.close(); reopen new RwtmDB(); expect set present and session open
});
test('closeStaleSessions: 31 min idle → closed at lastActivityAt', async () => {
  const s = await startSession(g.id, T0); await addSet(s.id, item, 62, 10, T0 + 60_000);
  await closeStaleSessions(T0 + 60_000 + 31*60_000, 30);
  expect((await db.sessions.get(s.id))!.endedAt).toBe(T0 + 60_000);
});
test('closeStaleSessions: 29 min idle → still open');
test('closeStaleSessions: stale empty session is deleted');
test('startSession while another is open finishes the previous one');
test('finishSession on empty session deletes it');
test('addSet order, baseWeight snapshot for plate, unit level for level stack, bumps lastActivityAt');
test('getLastTime prefers same gym even if another gym is more recent', ...);
test('getLastTime falls back to other gym; excludes current session; null when none');
test('prefill: last current set wins; else last set of lastTime; else null');
test('sessionExercises groups by item in first-logged order');
test('recomputePlateHistory shifts weight by newBase-oldBase only for sets with baseWeight===oldBase');
```
- [ ] **Step 2: Run `npx vitest run src/db/sessionRepo.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** `src/db/sessionRepo.ts`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sessions, sets, auto-close and last-time lookup`

---

### Task 6: Machine file import and Claude prompt

**Files:**
- Create: `src/domain/importMachine.ts`, `src/domain/claudePrompt.ts`; Modify: `src/db/gymRepo.ts` (add `importMachines`)
- Test: `src/domain/importMachine.test.ts`, `src/domain/claudePrompt.test.ts`, `src/db/gymRepo.test.ts`

**Interfaces:**
- Produces:
```ts
extractMachineJson(text: string): unknown | null
interface ParsedMachine { catalogId: string; label: string; notes: string; loading: Loading }
type ParseResult = { ok: true; machines: ParsedMachine[]; newExercises: CatalogExercise[] } | { ok: false; error: string }
parseMachineFile(text: string, catalog: CatalogExercise[]): ParseResult
buildClaudePrompt(catalog: CatalogExercise[]): string
// gymRepo.ts
importMachines(gymId: string, parsed: Extract<ParseResult,{ok:true}>): Promise<GymExercise[]>  // one transaction: custom entries then gym exercises
```
- `extractMachineJson`: scan for each `{`, find its matching `}` with a brace counter that skips string literals (honouring `\"` escapes), `JSON.parse` the slice, and return the first object whose `format === 'rwtm-machine'`. Before scanning, normalise curly quotes `“ ” ‘ ’` to straight ones.
- Validation: `version` must be 1; `machines` non-empty array; allowed machine keys exactly `exercise,newExercise,label,loading,notes`; `exercise` must be in catalogue or equal `newExercise.id`; `newExercise` keys `id,name,category,kind` with a valid category/kind; machine `loading.type` ∈ `stack|plate`; stack `weights` non-empty, positive, strictly ascending after sort, `unit` ∈ `kg|level` if present; plate `base ≥ 0`, `step > 0`. Error strings are one line, prefixed `Machine N: ` when machine-specific.
- Prompt must contain: every catalogue line as `id — name (category, kind)`; the §5.3 example; rules: pick an id from the list, else fill `newExercise`; read stack weights/sled weight from the photo, ask the user if not visible; convert lb stacks to kg rounded to 0.1; for numbered plates ask kg per plate, else use `"unit": "level"` with the plate numbers; output one ```json code block, no other fields, optionally also a downloadable `.json` file.

- [ ] **Step 1: Write failing tests:**
```ts
const valid = `{"format":"rwtm-machine","version":1,"machines":[{"exercise":"leg-press","newExercise":null,"label":"Technogym","loading":{"type":"plate","base":62,"step":2.5},"notes":"Seat 5"}]}`;
test('plain JSON', () => expect(extractMachineJson(valid)).toMatchObject({format:'rwtm-machine'}));
test('markdown with prose, a {brace} in prose and a fence', () =>
  expect(extractMachineJson(`Here you go {as asked}:\n\`\`\`json\n${valid}\n\`\`\`\nEnjoy!`)).toMatchObject({version:1}));
test('brace inside string value', () => expect(extractMachineJson(valid.replace('Seat 5','Seat } 5'))).not.toBeNull());
test('curly quotes normalised'); test('returns null when no machine JSON');
test('valid file parses to machines', () => {
  const r = parseMachineFile(valid, BUILT_IN_CATALOG);
  expect(r).toEqual({ok:true, newExercises:[], machines:[{catalogId:'leg-press',label:'Technogym',notes:'Seat 5',loading:{type:'plate',base:62,step:2.5}}]});
});
test('unknown exercise id → error naming the id');
test('newExercise accepted and returned as custom (builtIn false)');
test('unknown field → "Machine 1: unknown field \\"foo\\""');
test('empty stack weights → error'); test('version 2 → error'); test('level stack accepted');
// claudePrompt
test('prompt lists every catalogue id incl. custom, contains rwtm-machine example and lb/level rules');
// gymRepo
test('importMachines adds custom entry and gym exercises atomically; failure adds nothing');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: Claude machine-file import and prompt generator`

---

### Task 7: Backup, restore and CSV export

**Files:**
- Create: `src/db/backup.ts`, `src/domain/csv.ts`
- Test: `src/db/backup.test.ts`, `src/domain/csv.test.ts`

**Interfaces:**
- Produces:
```ts
interface BackupFile { format: 'rwtm-backup'; version: 1; exportedAt: number; data: {
  gyms: Gym[]; customCatalog: CatalogExercise[]; gymExercises: GymExercise[]; sessions: Session[]; sets: SetEntry[]; settings: Settings } }
exportBackup(now: number): Promise<BackupFile>
validateBackup(json: unknown): { ok: true; file: BackupFile } | { ok: false; error: string }
restoreBackup(file: BackupFile): Promise<void>   // one rw transaction: clear all tables, bulkAdd all
interface CsvRow { completedAt: number; gym: string; exercise: string; category: string; machine: string;
  setNo: number; weight: number; reps: number; unit: Unit; baseWeight: number|null }
setsToCsv(rows: CsvRow[]): string
buildCsvRows(): Promise<CsvRow[]>   // in backup.ts, joins sets with gyms/catalogue/gymExercises, ordered by completedAt
```
- CSV header exactly: `date,time,gym,exercise,category,machine,set,weight,reps,unit,base_weight,e1rm`; RFC 4180 quoting (fields containing `,` `"` or newline are quoted, `"` doubled); `\r\n` line endings; `date` `YYYY-MM-DD` and `time` `HH:MM` local; `e1rm` 1 decimal, empty for `unit === 'level'` and bodyweight.

- [ ] **Step 1: Write failing tests:**
```ts
test('backup round-trips losslessly', async () => {
  // seed gym, machine, custom catalog entry, session with 2 sets, settings; b = await exportBackup(T);
  // await resetDb(); await restoreBackup(b); expect(await exportBackup(T)).toEqual(b)
});
test('validateBackup rejects wrong format, wrong version, missing tables');
test('invalid backup leaves data intact', async () => {
  // seed; const v = validateBackup({format:'nope'}); expect(v.ok).toBe(false);
  // also: restoreBackup with a file whose sets contain a duplicate id rejects and previous data still present
});
test('csv header and quoting', () => {
  const csv = setsToCsv([{completedAt:new Date(2026,9,17,17,42).getTime(),gym:'Gym, "Big"',exercise:'Leg Press',
    category:'Legs',machine:'Technogym',setNo:1,weight:92,reps:10,unit:'kg',baseWeight:62}]);
  expect(csv.split('\r\n')[0]).toBe('date,time,gym,exercise,category,machine,set,weight,reps,unit,base_weight,e1rm');
  expect(csv.split('\r\n')[1]).toBe('2026-10-17,17:42,"Gym, ""Big""",Leg Press,Legs,Technogym,1,92,10,kg,62,122.7');
});
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: JSON backup/restore and CSV export`

---

### Task 8: App shell, router, theme, Home and Gyms list

**Files:**
- Create: `src/ui/router.ts`, `src/bootstrap.ts`, `src/styles.css`, `src/ui/screens/Home.tsx`, `src/ui/screens/Gyms.tsx`; Modify: `src/ui/App.tsx`, `src/main.tsx`
- Test: `src/ui/router.test.ts`, `src/ui/screens/Home.test.tsx`, `src/ui/screens/Gyms.test.tsx`

**Interfaces:**
- Produces:
```ts
type Route =
 | {name:'home'} | {name:'session'; sessionId:string} | {name:'pick'; sessionId:string}
 | {name:'log'; sessionId:string; key:string} | {name:'gyms'} | {name:'gym'; gymId:string}
 | {name:'exercise'; gymId:string; geId:string|'new'; catalogId?: string} | {name:'progress'} | {name:'settings'}
parseRoute(hash: string): Route        // unknown → home
toHash(r: Route): string               // '#/session/abc/log/c%3Adumbbell-bench-press'
navigate(r: Route): void;  useRoute(): Route
applyTheme(theme: Settings['theme']): void   // sets document.documentElement.dataset.theme = 'dark'|'light' (system resolves via matchMedia)
bootstrap(): Promise<void>   // navigator.storage?.persist?.(); applyTheme; closeStaleSessions on start and on visibilitychange→visible
```
- Layout per wireframe: Home = title, gym buttons (large, stacked, no scroll for ≤10), bottom row Gyms | Progress | Settings. Gyms = list (tap → gym screen), ↑/↓ reorder buttons, rename, archive toggle, "Add gym" at bottom (inline name field + Save).
- `styles.css`: CSS variables for both themes, `[data-theme=dark]`/`[data-theme=light]`; `env(safe-area-inset-*)` padding; buttons min-height 44px.

- [ ] **Step 1: Write failing tests:**
```ts
test('parseRoute/toHash round-trip for every route kind incl. encoded key');
test('Home lists active gyms in order as start buttons');
test('tapping a gym starts a session and navigates to it', async () => {
  // render Home; click 'Kamppi'; expect(location.hash).toMatch(/^#\/session\//); expect(await getOpenSession()).not.toBeNull()
});
test('Home shows resume button for open session', async () => {
  // startSession(g.id, Date.now()); render; expect(screen.getByRole('button',{name:/Resume session at Kamppi/})).toBeInTheDocument()
});
test('Gyms: add, rename, move up, archive');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**, then `npm run dev` and check Home and Gyms in the browser at phone width (375×812), in both themes. Expected: PASS; layout matches wireframe screen 1.
- [ ] **Step 5: Commit** `feat: app shell, router, theme, Home and Gyms screens`

---

### Task 9: Wheel picker component

**Files:**
- Create: `src/ui/components/Wheel.tsx` (+ styles in `styles.css`)
- Test: `src/ui/components/Wheel.test.tsx`

**Interfaces:**
- Produces: `<Wheel label: string; values: number[]; value: number; onChange(v: number): void; parse(s: string): number|null; suffix?: string />`
- Behaviour: vertical scroll container, `scroll-snap-type: y mandatory`, item height 44 px, 3 visible rows with the selected one centred and highlighted. On scroll settle (`scrollend`, with a 120 ms debounce fallback), `onChange(values[round(scrollTop/44)])`. Scrolls to `value` on mount and when `value` changes. If `value` isn't in `values`, it's inserted in sorted order for display. Tapping the selected number swaps it for `<input inputMode="decimal">` (focused, preselected). Enter/blur commits via `parse`; `null` reverts without calling `onChange`.

- [ ] **Step 1: Write failing tests:**
```tsx
test('shows selected value'); 
test('typing 62,5 commits 62.5', async () => {
  const onChange = vi.fn();
  render(<Wheel label="KG" values={[60,62,64]} value={62} onChange={onChange} parse={parseWeightInput} />);
  await user.click(screen.getByRole('button',{name:'KG 62'}));
  const input = screen.getByRole('textbox'); await user.clear(input); await user.type(input,'62,5{Enter}');
  expect(onChange).toHaveBeenCalledWith(62.5);
});
test('invalid typed value reverts and does not call onChange');
test('value not in values is displayed');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**, then check scrolling by hand in the browser at phone width. Expected: PASS; the wheel snaps cleanly and selects the centred value.
- [ ] **Step 5: Commit** `feat: scroll-snap wheel picker with tap-to-type`

---

### Task 10: Session and Exercise picker screens

**Files:**
- Create: `src/ui/screens/Session.tsx`, `src/ui/screens/Picker.tsx`
- Test: `Session.test.tsx`, `Picker.test.tsx`

**Interfaces:**
- Consumes: `sessionExercises`, `finishSession`, `availableExercises`, `summarizeSets`/`formatSummary`, `formatTime`, `CATEGORIES`, router.
- Session layout: header with gym name, "Started 17:42 · 38 min" (re-renders each minute), **small "Finish" button in the top-right corner** (`aria-label="Finish session"`); middle list of exercise cards (name, label, `formatSummary`) → tap opens the log route; bottom full-width "＋ Log exercise" → pick route. If the session is closed (e.g. auto-closed), redirect home.
- Picker layout: horizontally scrollable row (`scroll-snap-type: x`) of category columns in `CATEGORIES` order, each ~1/3 viewport wide, showing only categories that have items. Each column scrolls vertically. Each item is a button with name and, if present, label. Tap → `navigate({name:'log', sessionId, key})`. "‹ Back" at bottom.

- [ ] **Step 1: Write failing tests:**
```tsx
test('Session shows gym, start time and a Finish session button');
test('Finish session ends session and navigates home');
test('Session lists logged exercises with summary "2 sets · 8–10 reps · 62–72 kg"');
test('Log exercise navigates to picker');
test('Picker shows category columns in order, skipping empty ones, with labelled machines');
test('Picker item tap navigates to log route with item key');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**, then check in the browser at phone width. Expected: PASS; matches wireframe screens 2–3 with Finish in the top corner.
- [ ] **Step 5: Commit** `feat: session and exercise picker screens`

---

### Task 11: Exercise logging screen

**Files:**
- Create: `src/ui/screens/Logging.tsx`, `src/ui/components/Sheet.tsx`
- Test: `src/ui/screens/Logging.test.tsx`

**Interfaces:**
- Consumes: `resolveItem`, `setsForItem`, `getLastTime`, `prefill`, `addSet`, `updateSet`, `deleteSet`, `wheelValues`, `snapToWheel`, `parseWeightInput`, `parseRepsInput`, `Wheel`.
- Layout (wireframe screen 4): title = name, label under it; "Last time" box (`formatDate`, gym name, `formatSummary`) or nothing if none; completed sets list (`#  weight kg  × reps`); bottom row: weight Wheel | reps Wheel (values 1–50) | "✓" button (`aria-label="Complete set"`); "‹ Back to session" below.
- Initial row: `prefill(current, last)`. If null, weight = first wheel value and reps = 10. The prefilled weight is snapped to the wheel for stack machines only; typed values are kept as typed.
- Labels: reps wheel label "REPS / SIDE" when `unilateral`; weight suffix "L" when stack unit is `level`; "+KG" label for bodyweight; "ASSIST KG" for assisted.
- Tapping a completed set opens `Sheet` with two Wheels, Save and Delete.

- [ ] **Step 1: Write failing tests:**
```tsx
test('shows last time from same gym: "Last time · 10 Oct 2026 · Kamppi" and summary');
test('prefills from last time last set');
test('Complete set saves to DB and new row prefilled with that set', async () => {
  // click Complete set; expect((await db.sets.toArray()).length).toBe(1); expect row shows same values
});
test('editing a completed set via sheet updates DB; delete removes it');
test('unilateral exercise labels reps per side');
test('no last time and no sets → weight = first wheel value, reps 10');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**, then do a full manual pass in the browser at phone width: start a session → pick → log 3 sets → back → session card summary. Expected: PASS; each identical set takes one tap.
- [ ] **Step 5: Commit** `feat: exercise logging screen`

---

### Task 12: Gym detail, exercise editor, machine import UI

**Files:**
- Create: `src/ui/screens/GymDetail.tsx`, `src/ui/screens/ExerciseEdit.tsx`, `src/ui/components/ImportMachineSheet.tsx`, `src/ui/lib/share.ts`; Modify: `src/ui/screens/Picker.tsx` (add import action)
- Test: `GymDetail.test.tsx`, `ExerciseEdit.test.tsx`, `ImportMachineSheet.test.tsx`

**Interfaces:**
- Consumes: `listGymMachines`, `saveGymExercise`, `deleteGymExercise`, `getCatalog`, `parseMachineFile`, `importMachines`, `recomputePlateHistory`.
- Produces:
```ts
readFileText(file: File): Promise<string>                 // share.ts
shareOrDownload(filename: string, blob: Blob): Promise<void>  // navigator.share({files}) when canShare, else <a download>
<ImportMachineSheet gymId: string; onClose(): void; onImported(created: GymExercise[]): void />
```
- GymDetail: header with gym name; scrollable list of machine buttons (`name — label`) → ExerciseEdit; section "Free weights & bodyweight" listing those catalogue entries with a per-gym "Hide here" toggle and a tap → ExerciseEdit for a loading override; bottom buttons: **Import machine file**, **Paste from Claude**, **Add manually**.
- ImportMachineSheet: hidden `<input type="file" accept=".json,.md,.txt,application/json,text/plain,text/markdown">`; paste area = textarea plus a "Paste" button calling `navigator.clipboard.readText()` when available. After parsing it shows a preview list (name, category, loading summary such as "Stack 5–100 kg" / "Plate, sled 62 kg, +2.5") with **Import**, or the one-line error.
- ExerciseEdit: catalogue select grouped by category (with "＋ New exercise" → name/category/kind fields); label; loading type (stack: weights text parsed by splitting on commas/spaces with `parseWeightInput`, plus a kg/level unit toggle; plate: base + step; free/bodyweight: start/step/max); notes; Save; Delete. If a plate `base` changed and sets exist with the old base, Save asks once "Recompute N past sets for the new sled weight?" and calls `recomputePlateHistory` on yes.
- Picker gets a small "Import machine" button. After import, if exactly one machine was created, navigate straight to its log route.

- [ ] **Step 1: Write failing tests:**
```tsx
test('GymDetail lists machines and opens editor');
test('Hide here toggle removes free exercise from availableExercises');
test('ImportMachineSheet: pasted markdown → preview → Import creates gym exercise and calls onImported');
test('ImportMachineSheet: bad file shows one-line error and imports nothing');
test('ExerciseEdit: create stack machine from "5, 10, 15 20"');
test('ExerciseEdit: changing plate base with history asks to recompute and shifts weights');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**, then manually import a sample `.md` file via the file picker and via paste in the browser. Expected: PASS; the machine appears in the gym and in the picker.
- [ ] **Step 5: Commit** `feat: gym detail, exercise editor and machine import`

---

### Task 13: Progress screen

**Files:**
- Create: `src/ui/screens/Progress.tsx`, `src/ui/components/ProgressChart.tsx`
- Test: `src/ui/screens/Progress.test.tsx` (mock `chart.js` with `vi.mock`)

**Interfaces:**
- Consumes: `filterSets`, `sliceOptions`, `buildSeries`, `buildTableRows`, `gymColor`, `listGyms({includeArchived:true})`, `getCatalog`.
- Produces: `<ProgressChart points: ProgressPoint[]; metric: MetricKind; colorFor(gymId: string): string />`. This is a Chart.js line chart with `parsing:false`, a time-like linear x axis showing date ticks, per-point `pointBackgroundColor`, a thin grey connecting line, the y axis reversed for `assist`, and a legend of gyms present. Register only the Chart.js components it uses.
- Slicers row: Category, Exercise (options limited by category and to exercises with data), Gym (multi-select chips), Year, Month, Week (options from `sliceOptions` of the currently filtered data). Metric toggle e1RM | Volume. A note under the chart when the metric is `reps` ("Bodyweight: total reps per session") or `assist` ("Assisted: lower is better").
- Table: columns Date, Gym, Sets, Best e1RM, Volume. Without an exercise selected: recent sessions (Date, Gym, Exercises) and no chart.

- [ ] **Step 1: Write failing tests:**
```tsx
test('no exercise selected: lists recent sessions, no chart');
test('selecting exercise shows chart and table newest first');
test('gym chip filter narrows table rows');
test('metric toggle switches to volume');
test('bodyweight exercise shows total reps note');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests**, then seed demo data in dev (a temporary console snippet, not committed) and check the chart at phone width in both themes. Expected: PASS; points coloured by gym.
- [ ] **Step 5: Commit** `feat: progress screen with slicers, chart and table`

---

### Task 14: Settings screen

**Files:**
- Create: `src/ui/screens/Settings.tsx`
- Test: `src/ui/screens/Settings.test.tsx`

**Interfaces:**
- Consumes: `getSettings`, `updateSettings`, `applyTheme`, `exportBackup`, `validateBackup`, `restoreBackup`, `buildCsvRows`, `setsToCsv`, `buildClaudePrompt`, `getCatalog`, `shareOrDownload`, `readFileText`.
- Items in order: Theme (System / Dark / Light segmented); **Export backup** → `rwtm-backup-YYYY-MM-DD.json`, sets `lastBackupAt`, with passive text beside it "Last backup: never" / "today" / "N days ago"; **Import backup** → file picker → `validateBackup` → error line, or one confirm "Replace all data with this backup?" → `restoreBackup`; **Export CSV** → `rwtm-sets-YYYY-MM-DD.csv`; **Copy Claude prompt** → `navigator.clipboard.writeText(buildClaudePrompt(catalog))` and a transient "Copied" label; **Auto-close after** number input, minutes, 5–240.

- [ ] **Step 1: Write failing tests:**
```tsx
test('theme change persists and sets data-theme');
test('export backup calls shareOrDownload with dated filename and updates last backup text to "today"');
test('import of invalid backup shows error and does not ask to confirm');
test('copy prompt writes prompt containing "rwtm-machine" to clipboard');
test('auto-close minutes clamps to 5–240 and saves');
```
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: settings screen`

---

### Task 15: PWA: manifest, offline, icons, iOS polish

**Files:**
- Create: `public/logo.svg`, `pwa-assets.config.ts`; Modify: `vite.config.ts`, `index.html`, `package.json` (script `generate-pwa-assets`)

**Interfaces:**
- `VitePWA({ registerType: 'prompt', injectRegister: 'auto', manifest: { name: 'Rage with the machine', short_name: 'RWTM', display: 'standalone', start_url: '.', scope: '.', background_color, theme_color, icons }, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] } })`. Use `'prompt'` with no prompt UI: a new service worker waits and activates on the next launch, so an open session is never interrupted (§6). Do not call `updateSW`.
- `index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-touch-icon`, `theme-color` for both colour schemes.

- [ ] **Step 1: Create the icon** (a simple bold "RWTM" or barbell mark on a solid background), then run `npx pwa-assets-generator` to produce PNGs into `public/`.
- [ ] **Step 2: Configure the plugin and meta tags.**
- [ ] **Step 3: Run `npm run build`.** Expected: `dist/sw.js` and `dist/manifest.webmanifest` exist; the manifest lists 192 and 512 icons.
- [ ] **Step 4: Offline check.** Run `npm run preview`, open it in the browser pane, reload once (SW installed), stop the preview server, reload. Expected: the app still loads and existing data is visible.
- [ ] **Step 5: Run `npm test`.** Expected: all PASS.
- [ ] **Step 6: Commit** `feat: PWA manifest, offline caching and icons`

---

### Task 16: Deploy to GitHub Pages and owner checkpoint

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md` (install-on-phone steps, backup advice, link to the Claude-prompt flow)

**Interfaces:**
- Workflow: on push to `main` → `actions/checkout`, `actions/setup-node` (24, npm cache), `npm ci`, `npm test`, `BASE_PATH=/rage-with-the-machine/ npm run build`, `actions/upload-pages-artifact` (dist), `actions/deploy-pages`. Permissions `pages: write`, `id-token: write`.

- [ ] **Step 1: Write the workflow and README.** In the README: on iPhone open in **Safari** → Share → Add to Home Screen; on Android open in Chrome → Install app. Export a backup regularly.
- [ ] **Step 2: Build with the production base locally:** `BASE_PATH=/rage-with-the-machine/ npm run build`. Expected: success; asset URLs in `dist/index.html` start with `/rage-with-the-machine/`.
- [ ] **Step 3: Commit** `ci: GitHub Pages deploy workflow`
- [ ] **Step 4: Owner action (ask first, don't do unprompted).** The owner creates a **public** repo `rage-with-the-machine` on their personal GitHub account and sets Settings → Pages → Source to "GitHub Actions". With the owner's explicit go-ahead, add the remote and `git push -u origin main`. Expected: the workflow succeeds and the app is live at `https://<owner>.github.io/rage-with-the-machine/`. **This URL is final**, since stored data is tied to it (§6).
- [ ] **Step 5: Owner checkpoint on real phones** (doesn't block the work above): install on both phones; log a short session; kill the app mid-session and reopen (resume works); copy the Claude prompt, photograph a real machine in the Claude app, import the reply both as a file and by paste; export a backup. Report back which import path works on iOS and whether the prompt needs tuning. Prompt tweaks go into `src/domain/claudePrompt.ts` with its tests.
