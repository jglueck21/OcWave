// Waveform for the player's seek bar: the song is decoded once (mono, low sample rate), reduced to a few
// hundred peak values, and stored with the song's stats so it never has to be computed again.
import * as db from "./db.js";
import { exclusive } from "./loudness.js";
import * as stats from "./stats.js";

export const BARS = 180;
const RATE = 8000;
const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
const pending = new Map();

async function compute(blob) {
  if (!OfflineContext) return null;
  try {
    const decoded = await new OfflineContext(1, 1, RATE).decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
    const per = Math.max(1, Math.floor(decoded.length / BARS));
    const peaks = [];
    for (let bar = 0; bar < BARS; bar++) {
      let peak = 0;
      const end = Math.min(decoded.length, (bar + 1) * per);
      for (let i = bar * per; i < end; i += 2) {
        for (const data of channels) peak = Math.max(peak, Math.abs(data[i]));
      }
      peaks.push(peak);
    }
    // Normalise so quiet songs still draw a readable shape; sqrt keeps small details visible.
    const top = Math.max(...peaks) || 1;
    return peaks.map((p) => Math.round(Math.sqrt(p / top) * 100));
  } catch (error) {
    console.warn("Waveform analysis failed", error);
    return null;
  }
}

// Resolves the song's waveform (array of BARS values 0..100) or null when it can't be decoded.
export function getWaveform(id) {
  const known = stats.waveOf(id);
  if (known) return Promise.resolve(known);
  if (!pending.has(id)) {
    pending.set(
      id,
      exclusive(async () => {
        const song = await db.getSong(id);
        const wave = song?.blob ? await compute(song.blob) : null;
        if (wave) await stats.setWave(id, wave);
        return wave;
      }).finally(() => pending.delete(id))
    );
  }
  return pending.get(id);
}
