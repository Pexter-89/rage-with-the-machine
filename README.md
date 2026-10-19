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
