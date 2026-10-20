// The app version shown in Settings → About. Bump it for every release (and bump VERSION in sw.js as well).
export const VERSION = "1.0.0";
export const REPO_URL = "https://github.com/jglueck21/OcWave";

// Desktop installers, built by .github/workflows/desktop.yml and attached to every GitHub Release under these
// fixed names, so "latest/download/<name>" always points at the newest version.
const LATEST = `${REPO_URL}/releases/latest`;
export const DOWNLOADS = {
  windows: { label: "Download for Windows (.exe)", href: `${LATEST}/download/OcWave-win-x64.exe` },
  macArm: { label: "Download for Mac, Apple Silicon (.dmg)", href: `${LATEST}/download/OcWave-mac-arm64.dmg` },
  macIntel: { label: "Download for Mac, Intel (.dmg)", href: `${LATEST}/download/OcWave-mac-x64.dmg` },
  all: LATEST,
};
