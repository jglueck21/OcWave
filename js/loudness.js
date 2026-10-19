// Volume normalisation. Each song is decoded once (at a low sample rate, to keep memory small) and its
// integrated loudness is measured the way EBU R128 / ReplayGain 2 do (K-weighting plus gating). The
// result is stored with the song's stats; the player turns it into a gain so every song plays at about
// the same loudness without clipping.
import * as db from "./db.js";
import { getNormalize } from "./prefs.js";
import * as stats from "./stats.js";

const TARGET_LUFS = -14; // the level most streaming services use
const MAX_BOOST_DB = 12;
const MAX_CUT_DB = 15;
const RATE = 11025;
const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (progress) => listeners.forEach((fn) => fn(progress));

/* ------------------------------- Measuring ------------------------------- */

// Returns { loudness (LUFS), peak (0..1) } or null when the file can't be decoded.
export async function measure(blob) {
  if (!OfflineContext) return null;
  try {
    const decoded = await new OfflineContext(2, 1, RATE).decodeAudioData(await blob.arrayBuffer());
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      for (const sample of decoded.getChannelData(c)) peak = Math.max(peak, Math.abs(sample));
    }

    // K-weighting: a high-pass around 38 Hz and a shelf that lifts the highs by about 4 dB.
    const offline = new OfflineContext(decoded.numberOfChannels, decoded.length, RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    const highpass = Object.assign(offline.createBiquadFilter(), { type: "highpass" });
    highpass.frequency.value = 38;
    highpass.Q.value = 0.5;
    const shelf = Object.assign(offline.createBiquadFilter(), { type: "highshelf" });
    shelf.frequency.value = 1700;
    shelf.gain.value = 4;
    source.connect(highpass).connect(shelf).connect(offline.destination);
    source.start();
    const weighted = await offline.startRendering();

    // Mean power of 400 ms blocks, then the standard two-step gate (absolute -70 LUFS, relative -10 LU).
    const block = Math.round(RATE * 0.4);
    const channels = Array.from({ length: weighted.numberOfChannels }, (_, c) => weighted.getChannelData(c));
    const powers = [];
    for (let start = 0; start + block <= weighted.length; start += block) {
      let power = 0;
      for (const data of channels) {
        let sum = 0;
        for (let i = start; i < start + block; i++) sum += data[i] * data[i];
        power += sum / block;
      }
      powers.push(power);
    }
    const toLufs = (power) => -0.691 + 10 * Math.log10(power);
    const audible = powers.filter((power) => power > 0 && toLufs(power) > -70);
    if (!audible.length) return null;
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    const relativeGate = toLufs(mean(audible)) - 10;
    const gated = audible.filter((power) => toLufs(power) > relativeGate);
    return { loudness: toLufs(mean(gated.length ? gated : audible)), peak };
  } catch (error) {
    console.warn("Loudness measurement failed", error);
    return null;
  }
}

// Linear gain that brings a measured song to the target loudness (1 when unknown or switched off).
export function gainFor(id) {
  if (!getNormalize()) return 1;
  const { loudness, peak } = stats.get(id);
  if (!Number.isFinite(loudness)) return 1;
  let db = Math.min(MAX_BOOST_DB, Math.max(-MAX_CUT_DB, TARGET_LUFS - loudness));
  if (peak > 0) db = Math.min(db, -0.5 - 20 * Math.log10(peak)); // never boost into clipping
  return 10 ** (db / 20);
}

/* ------------------------------- Scanning ------------------------------- */

const isDone = (id) => !!stats.get(id).scanned;
let chain = Promise.resolve(); // one decode at a time keeps memory use low
const pending = new Map();

// Runs heavy audio-decoding work one job at a time (shared with the waveform analysis).
export function exclusive(job) {
  const run = chain.then(job);
  chain = run.catch(() => {});
  return run;
}

async function analyse(id) {
  const song = await db.getSong(id);
  const result = song?.blob ? await measure(song.blob) : null;
  if (song) await stats.setLoudness(id, result?.loudness ?? null, result?.peak ?? null);
  return !!result;
}

// Measures one song now (or soon): resolves true when new data was stored.
export function ensure(id) {
  if (!getNormalize() || isDone(id)) return Promise.resolve(false);
  if (!pending.has(id)) {
    pending.set(id, exclusive(() => (isDone(id) ? false : analyse(id))).finally(() => pending.delete(id)));
  }
  return pending.get(id);
}

let scanning = false;
let progress = { done: 0, total: 0 };
export const getProgress = () => progress;

// Analyses every song that hasn't been measured yet, in the background. Safe to call repeatedly.
export async function scan(prioritise) {
  if (scanning || !getNormalize()) return;
  scanning = true;
  try {
    const ids = (await db.getAllSongs()).map((song) => song.id);
    progress = { done: ids.filter(isDone).length, total: ids.length };
    emit(progress);
    const todo = ids.filter((id) => !isDone(id));
    if (prioritise != null && todo.includes(prioritise)) todo.unshift(...todo.splice(todo.indexOf(prioritise), 1));
    for (const id of todo) {
      if (!getNormalize()) break;
      await ensure(id);
      progress = { done: progress.done + 1, total: progress.total };
      emit(progress);
      await new Promise((resolve) => setTimeout(resolve, 40)); // let the UI breathe
    }
  } finally {
    scanning = false;
  }
}

// Starts a background scan shortly after the current work settles.
export const kick = () => setTimeout(() => scan(), 1500);

// Snapshot for the settings page.
export async function status() {
  const ids = (await db.getAllSongs()).map((song) => song.id);
  return { done: ids.filter(isDone).length, total: ids.length };
}
