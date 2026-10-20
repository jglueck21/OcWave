# OcWave desktop app

A thin [Electron](https://www.electronjs.org/) shell that opens the web app in its own window (macOS and Windows).
Nothing in the web app changes: `scripts/copy-app.js` copies the project root into `desktop/app`, and that folder is
what gets packaged. Edit the web app in the project root, never in `desktop/app`.

## Build it yourself

```bash
cd desktop
npm install
npm start            # run the desktop app (opens a window)
npm run dist:mac     # .dmg for Apple Silicon and Intel -> desktop/dist   (build on a Mac)
npm run dist:win     # .exe installer -> desktop/dist                     (best built on Windows)
```

## Release installers (GitHub Actions)

Pushing a version tag builds both installers on GitHub's own Mac and Windows machines and attaches them to a Release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The file names are fixed (`OcWave-mac-arm64.dmg`, `OcWave-mac-x64.dmg`, `OcWave-win-x64.exe`), so the download buttons
in Settings (`js/version.js`) always point at the newest release.

## Good to know

- **Not code-signed.** macOS: right-click the app, choose *Open* the first time. Windows: SmartScreen → *More info* →
  *Run anyway*. (The Mac build is ad-hoc signed without the hardened runtime, which Apple Silicon needs to launch it.)
- **Own library.** The desktop app stores its songs in its own database, separate from the browser version. Move songs
  over with Settings → Backup (export in one, restore in the other).
- **Origin.** The app is served from `app://ocwave`, a stable address, so the library survives updates.
- The web app's service worker is not used here (everything is already local).
