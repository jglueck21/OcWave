// User preferences kept in localStorage: appearance, playback and equalizer settings.
export const ACCENTS = {
  blue: { label: "Blue", color: "#3b82f6" },
  cyan: { label: "Cyan", color: "#06b6d4" },
  green: { label: "Green", color: "#22c55e" },
  yellow: { label: "Yellow", color: "#eab308" },
  orange: { label: "Orange", color: "#f97316" },
  pink: { label: "Pink", color: "#ec4899" },
  purple: { label: "Purple", color: "#a855f7" },
  brown: { label: "Brown", color: "#b4783c" },
  gray: { label: "Gray", color: "#94a3b8" },
};

export const RECORDS = {
  color: "Colored",
  classic: "Classic",
  splatter: "Splatter",
  clear: "Clear",
};

export const EQ_BANDS = ["60 Hz", "230 Hz", "910 Hz", "3.6 kHz", "14 kHz"];
export const EQ_PRESETS = {
  flat: { label: "Flat", gains: [0, 0, 0, 0, 0] },
  bass: { label: "Bass boost", gains: [7, 4, 0, -1, -1] },
  treble: { label: "Treble boost", gains: [-2, -1, 0, 4, 7] },
  vocal: { label: "Vocal", gains: [-3, -1, 4, 3, -1] },
  rock: { label: "Rock", gains: [5, 3, -2, 3, 5] },
  electronic: { label: "Electronic", gains: [6, 3, 0, 2, 5] },
};

// Hex values the old version stored under "sidebar-theme".
const LEGACY_HEX = {
  "#007bff": "blue", "#00a5b0": "cyan", "#ff7f00": "orange", "#8e44ad": "purple", "#ff5e78": "pink",
  "#6c757d": "gray", "#f1c40f": "yellow", "#28a745": "green", "#8b5a2b": "brown",
};

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

/* ------------------------------- Appearance ------------------------------- */

export function getAccent() {
  const saved = read("ocwave.accent");
  if (ACCENTS[saved]) return saved;
  return LEGACY_HEX[read("sidebar-theme", "")] || "blue";
}
// The saved preference: "system" (follow the device, default), "dark" or "light".
export const getMode = () => {
  const saved = read("ocwave.mode", "system");
  return saved === "light" || saved === "dark" ? saved : "system";
};
const deviceDark = window.matchMedia?.("(prefers-color-scheme: dark)");
export const resolveMode = () => {
  const mode = getMode();
  return mode === "system" ? (deviceDark && !deviceDark.matches ? "light" : "dark") : mode;
};
// While following the device, flip live when the device changes (e.g. at sunset).
deviceDark?.addEventListener?.("change", () => getMode() === "system" && applyAppearance());
export const getDesign = () => ((read("ocwave.design") || read("playerDesign", "")) === "vinyl" ? "vinyl" : "cover");
export const getRecord = () => (RECORDS[read("ocwave.record")] ? read("ocwave.record") : "color");
export const getSleeve = () => read("ocwave.sleeve", "0") === "1";

export function applyAppearance() {
  const root = document.documentElement;
  const hex = ACCENTS[getAccent()].color;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--on-accent", luminance > 0.62 ? "#10131a" : "#ffffff");
  root.dataset.theme = resolveMode();
  root.dataset.design = getDesign();
  root.dataset.recordStyle = getRecord(); // data-record-style (not data-record: the settings buttons use that name)
  root.dataset.sleeve = getSleeve() ? "1" : "0";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolveMode() === "dark" ? "#0b0c10" : "#f4f5f8");
}

export function setAccent(key) {
  write("ocwave.accent", key);
  applyAppearance();
}
export function setMode(mode) {
  write("ocwave.mode", mode);
  applyAppearance();
}
export function setDesign(design) {
  write("ocwave.design", design);
  applyAppearance();
}
export function setRecord(style) {
  write("ocwave.record", style);
  applyAppearance();
}
export function setSleeve(on) {
  write("ocwave.sleeve", on ? "1" : "0");
  applyAppearance();
}

/* -------------------------------- Playback -------------------------------- */

export const getLyricsOnline = () => read("ocwave.lyricsOnline", "1") === "1";
export const setLyricsOnline = (on) => write("ocwave.lyricsOnline", on ? "1" : "0");

// Crossfade length in seconds (0 = off).
export const getCrossfade = () => Math.min(12, Math.max(0, Number(read("ocwave.crossfade", "0")) || 0));
export const setCrossfade = (seconds) => write("ocwave.crossfade", String(seconds));

// Volume normalisation: evens out loud and quiet songs (songs are analysed once in the background).
export const getNormalize = () => read("ocwave.normalize", "0") === "1";
export const setNormalize = (on) => write("ocwave.normalize", on ? "1" : "0");

// Live visualiser in the full player.
export const getVisualizer = () => read("ocwave.viz", "1") === "1";
export const setVisualizer = (on) => write("ocwave.viz", on ? "1" : "0");

// Waveform drawn on the full player's seek bar.
export const getWaveSeek = () => read("ocwave.wave", "1") === "1";
export const setWaveSeek = (on) => write("ocwave.wave", on ? "1" : "0");

export function getEq() {
  try {
    const saved = JSON.parse(read("ocwave.eq", "null"));
    if (saved && Array.isArray(saved.gains) && saved.gains.length === EQ_BANDS.length) return saved;
  } catch {
    /* fall through to defaults */
  }
  return { on: true, preset: "flat", gains: [...EQ_PRESETS.flat.gains] };
}
export const setEqPrefs = (eq) => write("ocwave.eq", JSON.stringify(eq));
