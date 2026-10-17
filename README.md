# Rage with the machine

A single-user, offline-first gym logging app (PWA). Log sets and sessions per machine, track progress with charts, and set up new gyms and machines from photos using Claude. All data stays on your phone.

## Install on your phone

The URL is `https://<your-github-username>.github.io/rage-with-the-machine/`.

- **iPhone:** open the URL in Safari, then Share, then Add to Home Screen.
- **Android:** open the URL in Chrome, then menu, then Install app (or Add to Home screen).

The URL must not change once you start logging, because your data is tied to it.

## Setting up a gym from photos

1. In the app, go to Settings and tap Copy Claude prompt.
2. Paste it into the Claude app together with a photo of the machine.
3. Import Claude's reply, either as a file or with Paste from Claude, at the gym screen or during a session.

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

1. Create a public repo named `rage-with-the-machine` on your GitHub account.
2. Settings, then Pages, then Source: GitHub Actions.
3. Push `main`. The workflow in `.github/workflows/deploy.yml` tests, builds with the right base path and deploys.
