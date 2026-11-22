# Gym programs (artifact fork)

A program is a reusable, gym-independent preset: an ordered list of exercises with target sets × reps.
Weights are not stored; logging prefill from last time on the machine already covers them.

## Data
- New Dexie table `programs` (fork schema version 2; never edit version 1):
  `{id: uuid, name, order, archived: false, items: [{catalogId, sets, reps}], createdAt: ms, updatedAt: ms}`.
  Items are embedded, so one program is one cloud doc.
- Session gets two optional, unindexed fields (absent in older data):
  `programId: string | null` and `plan: [{catalogId, sets, reps}]` — a snapshot taken at start, so editing
  the program later never rewrites history. A swap during the session edits `plan` only.
- Cloud: new collection `programs` mirrored like the others; the artifact's db rules need a `programs` rule
  (read/write admin) — republish with the full capability declaration.
- Backup: include `programs`; backups without it still import (treated as empty, programs left untouched
  or cleared consistently with how restore treats other tables). CSV unchanged.

## Home
- Each gym's start button is split: left half starts a free session (as now); right half opens that gym's
  program list.
- Program list (per gym context): every non-archived program, in `order`, each showing its exercise count
  and "N not at this gym" when some exercises are unavailable here. Tap → start a session from it.
  Each row has Edit. "New program" at the bottom.

## Program editor (like the gym editor)
- Name; ordered items, each: exercise name, sets × reps (steppers), move up/down, remove.
- "Add exercise" uses the existing exercise picker over the whole catalogue (built-in + custom).
- Delete program (in-page confirm sheet).

## Save as program
- Session screen (ongoing) and a completed session in history: "Save as program".
- Items = exercises in the order first logged; sets = number of kg/level sets logged for it;
  reps = median reps of those sets (rounded). Ask for a name (default: gym name + date).

## Session from a program
- Session screen shows the plan as a to-do list in plan order: name, target "3 × 10", progress "2/3",
  ticked when logged sets ≥ target. Log in any order, skip freely; extra exercises appear below as now.
- Machine resolution per item at this gym:
  - machine exercise with exactly one (non-hidden) machine at this gym → that machine;
  - several → the one last used for this exercise at this gym; if none used yet, ask once (sheet) and
    that choice becomes "last used" once a set is logged;
  - free/bodyweight exercises always available.
- Not available → card says "Not at this gym" with Swap: a sheet of alternatives in the same category
  available here (this gym's machines + free/bodyweight catalogue). Swapping replaces the plan item's
  catalogId (keeps sets × reps).
- Logging screen shows "Target 3 × 10" for planned exercises; with no history, the reps wheel starts at the
  target reps.
