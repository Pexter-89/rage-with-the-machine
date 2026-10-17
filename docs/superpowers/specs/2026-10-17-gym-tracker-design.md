# Rage with the machine — gym tracker: design

Date: 2026-10-17
Source: `gym-tracker_description.md` (owner's original description) plus the brainstorming conversation of the same date.
Wireframes: `.superpowers/brainstorm/1077-1792240379/content/main-flow.html`

Items marked **[builder's call]** were decided by Claude during design, not by the owner; they can be changed without consulting the owner if there's a good reason.

---

## 1. Intent and why

A private, single-user gym log for a phone. The owner and their partner each run their own copy, with no shared data and no accounts.

Today the owner logs workouts in Notion, which takes too many taps per set and makes automation and analysis tedious. Store-bought apps are bloated and push premium upgrades. The goal is the **shortest possible path from walking into a gym to logging a set**, gym-specific machine setups so the owner never has to remember things like "what does the sled weigh here", and progress views that answer questions without manual work.

### Goals
- Log a set with a couple of wheel scrolls and one tap, one-handed, between sets.
- Each gym has its own machine list, built mostly by importing files that Claude generates from machine photos.
- The same exercise done at different gyms is comparable, because every exercise maps to one canonical name.
- Progress graphs (e1RM or volume load) and a table, sliced by gym, exercise, year, month and week.
- Data stays on the phone and the owner fully controls it (backup and restore files, CSV export).
- Works offline in the gym.

### Non-goals
- Multiple users, accounts, cloud sync, or sharing between partners.
- Importing history from Notion. The app starts from an empty database.
- Social features, coaching, programs/routines, rest timers, nutrition, or anything else not listed here.
- Correcting for pulley ratios or machine differences across gyms. These remain visible as noise in the graphs, mitigated by colouring graph points by gym.

### Anti-goals (failure even if it "works")
- Feature bloat, extra screens, confirmation dialogs on the common path.
- Nagging of any kind (pop-ups, reminders, upsell-style prompts).
- Data lock-in. All data must be exportable in open formats.
- Losing logged sets because the app was closed, crashed or the phone locked.

---

## 2. Constraints

- **Platforms:** Android and iPhone. **No Apple or Google developer accounts.**
- Therefore the app is a **Progressive Web App (PWA)**, installed with the browser's "Add to Home Screen" and run full-screen and offline. *(Decided with the owner, who was told about the trade-off on file control.)*
- It needs a free static host. **[builder's call]** GitHub Pages; any static host works. The app has no server component, and training data never leaves the device.
- Users: one person per installed copy. There are two installs (owner and partner), possibly one Android and one iPhone.
- Units: **[builder's call]** kilograms only.
- Week numbering: **[builder's call]** ISO-8601 weeks (Monday start).

---

## 3. Screens and behaviour

General UI rule: large touch targets, minimal text, no modal confirmations on the common logging path. Dark/light theme (see Settings).

### 3.1 Home
- One large **"Start session" button per gym**, listed vertically (maximum ~10 gyms, all fit on screen without scrolling). Tapping one immediately starts a session at that gym and opens the Session screen.
- Bottom row of smaller buttons: **Gyms**, **Progress**, **Settings**.
- If a session is already open (not finished and not timed out), **[builder's call]** Home shows a "Resume session at X" button at the top instead of making the user start a new one. Starting a session at another gym implicitly finishes the open one.

### 3.2 Gym session
- Top: gym name, session start time and elapsed time.
- **Small "Finish session" button in a top corner**, deliberately small and out of the way so it isn't pressed by accident *(owner's decision)*.
- Middle: list of exercises logged this session, in order. Each shows a summary (sets, weight range, reps range). Tapping one reopens it in the Logging screen to add or adjust sets.
- Bottom: big **"Log exercise"** button, always in the same spot.
- **Auto-close:** a session with no activity (no set completed or edited) for **30 minutes** is closed automatically *(owner's decision)*. Its end time is the time of its last activity. Because a PWA can't run in the background, this is evaluated lazily whenever the app opens or resumes. The 30-minute timeout is adjustable in Settings. **[builder's call]**
- A session with zero sets is discarded rather than stored. **[builder's call]**

### 3.3 Exercise picker (opened by "Log exercise")
- **Several large vertical scrolling lists side by side, one per body-area category; swipe sideways to reach more categories** *(owner confirmed the side-by-side, swipe-sideways layout)*. About three columns are visible at a time on a phone.
- Categories: **[builder's call]** Legs, Chest, Back, Shoulders, Arms, Core, Full body. The owner suggested "legs, torso, shoulders, arms, full body"; torso was split into Chest and Back because the combined list would be long. Core was added for abs and lower-back work.
- Each column lists the exercises available at this gym in that category: this gym's machines plus the built-in free-weight and bodyweight exercises (§4.2). Each exercise is a button. Tapping it opens the Logging screen.
- Also on this screen: a small **"Import machine"** action, so a machine can be added from a Claude file in the middle of a session (§5). After import the new machine is selected straight away.

### 3.4 Exercise logging
- Top: exercise name (and the gym-specific machine label, if there is one).
- **"Last time" reminder:** from the most recent previous session containing this canonical exercise (at the same gym if available, the last time at any gym if same not available, **[builder's call]**, showing which gym and the date): number of sets, reps range, weight range.
- Completed sets for this exercise in this session are listed above the input row.
- Bottom: **input row** = **weight wheel** | **reps wheel** | **✓ Complete set** button.
  - Wheels are touch scroll-wheels (scroll-snap pickers). Tapping the number lets you type an exact value with the numeric keyboard.
  - Weight wheel values depend on the exercise's loading type (§4.3).
  - **[builder's call]** A new row is pre-filled with the previous set's weight and reps. The first set of an exercise is pre-filled from the last set of "last time", if there is one. An identical set is therefore one tap.
- ✓ moves the row up into the completed list and creates a new pre-filled row at the bottom.
- **Saving is continuous:** every completed set is written to storage immediately. There is no "save" step and no "finish exercise" step. The user just goes back to the Session screen. *(The owner's phrase "everything will be logged once the session is completed" was interpreted, and agreed, as "no explicit save", not "nothing persists until the end".)*
- **[builder's call]** A completed set can be edited or deleted (long-press, or tap → small edit sheet). Editing sets of past, closed sessions is **out of scope for v1**.

### 3.5 Gym locations
- List of existing gyms (tap to open). An **"Add gym"** button at the bottom. Adding a gym asks only for its name.
- **[builder's call]** The gyms can be reordered (order = order of buttons on Home). A gym can be renamed. A gym with logged sessions can't be deleted, only archived (hidden from Home).

### 3.6 Single gym location
- Scrollable list of this gym's machine exercises as buttons (tap → edit).
- Bottom: **"Import machine file"** button (opens the phone's file picker) *(owner's spec)*. Also **[builder's call]** **"Paste from Claude"** (paste the text instead of a file; see §5) and **"Add manually"**.
- Edit exercise: canonical exercise (chosen from catalogue), label, loading type and its parameters, notes. Built-in free-weight exercises can be hidden per gym from here. **[builder's call]**

### 3.7 Progress
Owner's spec: slicers for locations, exercise types, year, month, week. A graph per exercise in either **e1RM** or **volume load** (user-selectable), plus a table. Owner left specifics to Claude; the following is all **[builder's call]**:
- **Slicers** (top, compact chips/dropdowns): Exercise (canonical, single-select, required for the graph), Gym (multi-select, default all), Year, Month, Week (filter the date range; choosing a narrower one narrows within the wider). A category filter narrows the exercise dropdown.
- **Metric toggle:** e1RM | Volume load.
  - e1RM per set = Epley `weight × (1 + reps/30)` (reps = 1 → weight). Per session, the graph point is the **best set's e1RM**.
  - Volume load per session = Σ(weight × reps) over that exercise's sets.
  - Bodyweight exercises without added weight: e1RM not meaningful; graph shows **total reps per session** instead and says so.
- **Graph:** x = date, y = metric. One point per session, **points coloured by gym** (with legend) *(owner's idea)*, thin line connecting them.
- **Table** below the graph: one row per session of the selected exercise: date, gym, sets as `weight × reps` list, best e1RM, volume load. Newest first.
- With no exercise selected: the table lists recent sessions (date, gym, exercises done) and no graph is shown.

### 3.8 Settings
- **Theme:** Dark / Light / System.
- **Export backup:** writes the full database as a single JSON file and hands it to the phone's share sheet (save to iCloud Drive / Google Drive / Files…). This **replaces the owner's "location of the file to save data" setting**, because iOS web apps can't choose a save location *(discussed and accepted by the owner)*.
- **Import backup:** restores from such a file (replaces all data, after one confirmation, the one confirmation in the app).
- **Export CSV:** all logged sets as a flat CSV (date, time, gym, canonical exercise, category, machine label, set #, weight, reps, base weight, e1RM) for external analysis *(agreed with the owner)*.
- **Copy Claude prompt:** copies the machine-import prompt (§5.2) to the clipboard.
- **Session auto-close timeout** (default 30 min).
- Small "last backup: N days ago" line next to Export, purely informational, **never a pop-up** (anti-goal: nagging).

---

## 4. Data

### 4.1 Storage
- **[builder's call]** IndexedDB in the browser, via a thin wrapper library. Request persistent storage (`navigator.storage.persist()`) on first launch to reduce the chance the browser evicts the data.
- Everything is local. No network calls except loading the app itself and updates.

### 4.2 Canonical exercise catalogue
This is the backbone of cross-gym comparability.
- Each **catalogue exercise** has: a stable `id` (slug, e.g. `leg-press`), display `name` ("Leg Press"), `category` (§3.3), and `kind`: `machine` | `free` | `bodyweight`.
- The app ships a **built-in catalogue** (≈60–80 common exercises; **[builder's call]** on the exact list).
- The **free** and **bodyweight** catalogue exercises are **available at every gym automatically** (owner: "cataloguing all the dumbbells makes no sense"), with default wheel settings: dumbbells 1 kg steps from 1 kg (step 2 kg above 10 kg, **[builder's call]**), barbell lifts 2.5 kg steps from 20 kg, bodyweight = reps plus optional added weight starting at 0.
- **Machine** catalogue exercises appear at a gym only when that gym has a machine mapped to them.
- Users (via Claude files or manually) can add **custom catalogue entries** when nothing fits. Custom entries become part of the catalogue and are included in the Claude prompt from then on, so later imports reuse them.

### 4.3 Gym exercises (machines) and loading types
A **gym exercise** belongs to one gym and points to one catalogue exercise. Fields: `label` (optional, e.g. "Technogym leg press"), `notes` (seat height, pin positions, etc.), and `loading`:
- **`stack`:** selectorised machine. `weights: number[]` = exactly the values printed on the stack (e.g. 5, 10, 15 … or whatever the photo shows). The weight wheel offers only those values.
- **`plate`:** plate-loaded. `base: number` (e.g. sled 62 kg) and `step: number` (e.g. 2.5). The wheel starts at `base` and increases in `step`s.
- Free and bodyweight exercises use the defaults above. **[builder's call]** A gym may override the defaults (e.g. a gym whose dumbbells go in 2.5 kg steps).
- Typing any value is always allowed regardless of loading type. If a pre-filled weight isn't on this machine's wheel, the wheel snaps to the nearest value. **[builder's call]**
- **Pound or numbered stacks** **[builder's call]**: the Claude prompt tells Claude to convert pound stacks to kg (rounded to 0.1 kg). For stacks labelled only with plate numbers (1–20), Claude asks the user for the kg per plate. If that's unknown, the machine is stored with `"unit": "level"`, its sets are kept out of e1RM/volume comparisons with kg machines, and they're shown with an "L" suffix.
- **Assisted machines** (assisted pull-up/dip) **[builder's call]**: logged as the assist weight; catalogue flags them `assisted`; graphs invert the sense (lower = better) and say so.

### 4.3a What the logged weight means **(owner's decisions + builder's calls)**
- Plate machines: **total load** (sled + plates) *(owner)*.
- Dumbbells: **the weight of one dumbbell**, the number printed on it, even when two are used *(owner)*.
- One-arm / one-leg exercises (catalogue flag `unilateral`): reps are **per side**. **[builder's call]**
- Barbell: total bar + plates. **[builder's call]**
- Weighted bodyweight moves: the **added** weight (0 = bodyweight only). Body weight isn't tracked, so for these the graph uses reps (or added weight at a given rep count) instead of e1RM. **[builder's call]**
- Volume load is always Σ(logged weight × reps). For dumbbells this means per-dumbbell volume. It's consistent over time, which is what matters for progress. **[builder's call]**
- Two machines at one gym may map to the same canonical exercise (e.g. two different leg presses); they're distinguished by label and both appear in the picker. **[builder's call]**

### 4.4 Logged data
- **Session:** id, gym, startedAt, endedAt (null while open), lastActivityAt.
- **Set:** id, session, catalogue exercise id, gym exercise id (null for free/bodyweight), order within exercise, `weight` = **total load** (for plate machines: sled + plates, owner's decision), `reps`, `baseWeight` snapshot (sled weight at time of logging, so history can be recomputed if a sled weight turns out wrong), completedAt.
- **[builder's call]** If a plate machine's `base` is edited later, the app offers to recompute that machine's historic sets (`weight - oldBase + newBase`).

---

## 5. Machine import from Claude

### 5.1 Flow
1. At the gym, the owner photographs a machine (ideally including the weight stack or sled label) and sends it to the Claude app along with the **machine-import prompt** (copied from Settings, §5.2).
2. Claude replies with a machine file.
3. In the gym tracker, either in the Single gym screen or in the Exercise picker during a session, the owner taps **Import machine file** (file picker) or **Paste from Claude** (clipboard text). Paste is the fallback for when getting a file from the Claude mobile app into the phone's file system is awkward.
4. The app validates the file and shows **one compact preview** (canonical name, category, loading, weights) with Import / Edit. On Import it is added to the current gym.

### 5.2 The prompt
- Generated **inside the app** from the current catalogue (built-in + custom), so the names Claude chooses always match the app. It instructs Claude to:
  - pick the canonical exercise `id` from the embedded list. Only if nothing fits, propose a new entry (id, name, category, kind),
  - read the stack weights or sled/base weight from the photo, or ask the user if they're not visible,
  - output exactly the JSON format below, in a single code block, and optionally also as a downloadable `.json` file.
- One file may contain several machines (one photo of several machines, or several photos in one conversation).

### 5.3 File format
JSON, versioned. **[builder's call]** on details beyond this shape:
```json
{
  "format": "rwtm-machine",
  "version": 1,
  "machines": [
    {
      "exercise": "leg-press",
      "newExercise": null,
      "label": "Technogym Pure leg press",
      "loading": { "type": "plate", "base": 62, "step": 2.5 },
      "notes": "Seat at notch 5"
    },
    {
      "exercise": "lat-pulldown",
      "newExercise": null,
      "label": "Gym80 lat pulldown",
      "loading": { "type": "stack", "weights": [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100] },
      "notes": ""
    }
  ]
}
```
- `newExercise`, when used: `{ "id", "name", "category", "kind" }`.
- The importer accepts `.json`, `.md` or `.txt` and plain pasted text. It extracts the first JSON object that has `"format": "rwtm-machine"` from anywhere in the text, so a Markdown reply with a code block works as-is.
- Invalid or unknown fields produce a clear one-line error. Nothing is half-imported.

---

## 6. How it gets built **[builder's call throughout, owner delegated stack choice]**

- **TypeScript + React + Vite**, PWA via a Vite PWA plugin (service worker, web manifest, offline caching, icons).
- **IndexedDB** via Dexie.
- Charts: a lightweight charting library (e.g. uPlot or Chart.js). Choose for small bundle and touch friendliness.
- Scroll-wheel pickers: custom component built on CSS scroll-snap (no heavy UI kit).
- Tests: Vitest for logic (import parsing/validation, e1RM/volume, session auto-close, slicing, CSV/backup round-trip). A few component tests for the logging row.
- Hosting: from the **owner's personal GitHub account** *(owner)*. The owner asked for a private repo reachable via a shared link. GitHub can't do that on a free plan: Pages from a private repo needs a paid plan, and even then the site itself is public. The owner said public is fine in that case, so the **default is a public repo + GitHub Pages**, deployed with GitHub Actions. The alternative, if the owner prefers private code, is a private GitHub repo deployed through Cloudflare Pages (free, needs a Cloudflare account). The resulting URL is public but unlisted. Either way, training data never leaves the phone.
- **The app's URL must be final before the first real logging**, because the browser ties stored data to it. Changing the URL later means export + re-import of backups on both phones.
- The project folder is not yet a git repository and needs initialising.
- **Owner checkpoint** **[builder's call]**: once the import feature works with sample files, the owner runs the Claude prompt with real machine photos from their gyms and imports the result on a phone. That tells us whether file import or paste is the practical path on iOS. The checkpoint doesn't block other work.
- Archived gyms remain selectable in Progress filters. **[builder's call]**
- App updates: the service worker picks up new versions. **[builder's call]** Apply the update on the next app launch, never interrupting an open session.

## 7. Left to the builder
- Exact built-in catalogue contents and category assignments.
- Visual design (colours, typography, iconography) within the "large, clean, no clutter" brief and the wireframe layout.
- Choice of chart and wrapper libraries.
- Backup JSON schema (must include a version number and round-trip losslessly).
- Exact wording of the Claude prompt, provided it meets §5.2 and is tested against a few real machine photos.

## 8. Open items owned by the owner (defined later)
- The owner said the Progress and Settings screens were "to be defined later"; §3.7 and §3.8 are Claude's proposals for v1 and can be revised after use.
