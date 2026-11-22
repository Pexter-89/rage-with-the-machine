# Rage with the machine

A single-user, offline-first gym logging app (PWA). Log sets and sessions per machine, track progress with charts, and set up new gyms and machines from photos using Claude. All data stays on your phone.

## Install on your phone

The URL is <https://pexter-89.github.io/rage-with-the-machine/>.

- **iPhone:** open the URL in Safari, then Share, then Add to Home Screen.
- **Android:** open the URL in Chrome, then menu, then Install app (or Add to Home screen).

The URL must not change once you start logging, because your data is tied to it. Renaming the repo or the GitHub account changes the URL, and the app then starts empty (restore from a backup). The repo name also sets the base path in `.github/workflows/deploy.yml` (`BASE_PATH: /rage-with-the-machine/`), so a rename must update that too.

## Setting up a gym from photos

1. In the app, go to Settings and tap Copy Claude prompt.
2. Paste it into the Claude app together with a photo of the machine.
3. Import Claude's reply, either as a file or with Paste from Claude, at the gym screen or during a session.

Photos can go to Claude one at a time or all at once. The import sheet takes several files in one go (and more can be added before importing), or several of Claude's replies pasted together. Machines already at the gym are skipped, and each machine can be unticked before importing.

## Sharing and editing a gym

On a gym's screen, Export gym file saves the gym and all its equipment as one file. Send it to someone, who loads it with Gyms, then Import gym from file. Or give it to Claude with the changes you want and load Claude's reply back with Replace from file: the gym's equipment becomes exactly the file's. A machine with the same exercise and label is updated in place so its history stays with it; equipment no longer in the file is deleted, or hidden if it has logged sets.

## Trying out Progress

Settings, then Load demo data, adds two demo gyms with about five months of made-up workouts. Remove demo data deletes them and everything logged at them; your own data is not touched.

## Backups

Data lives only on the phone. Use Settings, then Export backup, regularly, and save the file to iCloud Drive or Google Drive. Restore with Import backup. A CSV export is also available for analysis.

## Development

```
npm install
npm run dev
npm test
npm run build
npm run generate-pwa-assets
```

## Deploying

One-time GitHub setup:

1. Create a public repo named `rage-with-the-machine` under the [Pexter-89](https://github.com/Pexter-89) account.
2. Settings, then Pages, then Source: GitHub Actions.
3. Push `main`. The workflow in `.github/workflows/deploy.yml` tests, builds with the right base path and deploys.

## Claude artifact build

`npm run build:artifact` writes `dist-artifact/index.html`: one self-contained page (no service worker) to
publish as a Claude artifact with `capabilities: {db: {rules: [{path: "", read: "admin", write: "admin"}]}, downloads: {}}`.
In that build the data lives in the artifact's `db` (see `src/db/cloudSync.ts`): one collection per table
(`gyms`, `customCatalog`, `gymExercises`, `sessions`, `sets`, `kv`), one document per row, document id = the
row's `id` (`key` for `kv`), body = the row as JSON. The page loads every collection on start and replaces its
local copy with it, writes local changes through, and applies changes made elsewhere (for example by Claude)
while it is open. Without the capability it runs on local IndexedDB like the PWA.
