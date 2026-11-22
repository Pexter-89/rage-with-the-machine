# Rage with the machine

A single-user gym logging app. Log sets and sessions per machine, track progress with charts, and set up new gyms and machines from photos using Claude.

## This branch: the Claude artifact fork

This branch is a long-lived fork of the PWA on `main`. It runs as a Claude artifact on claude.ai, with the
data stored in the artifact's database, and it has no build step: `app/` is the published artifact, file for
file (readable ES modules, React via `htm`, libraries from cdn.jsdelivr.net through an import map), so it can
be developed by asking Claude on claude.ai to edit and republish it. See [app/DEVELOPING.md](app/DEVELOPING.md)
for the file map, the data layout and how to sync changes back here. The PWA, its install steps and its
deployment live on `main`.

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

The data lives in the artifact's database. Use Settings, then Export backup, now and then, and save the file to iCloud Drive or Google Drive. Restore with Import backup. A CSV export is also available for analysis.

## Development

```
npm install
npm test         # vitest against app/js (node_modules copies of the CDN libraries)
npm run serve    # serves app/ at http://localhost:8080
```

To publish, publish `app/index.html` with the rest of `app/` as supporting files at the same paths and
`capabilities: {db: {rules: [{path: "", read: "admin", write: "admin"}]}, downloads: {}}`.
