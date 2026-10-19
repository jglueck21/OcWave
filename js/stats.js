// Per-song statistics (liked, play count, last played), cached in memory so the UI can read them synchronously.
import * as db from "./db.js";

const stats = new Map(); // song id -> { id, favorite, playCount, lastPlayed }
const listeners = new Set();

export async function init() {
  stats.clear();
  for (const record of await db.getAllStats()) stats.set(record.id, record);
  notify();
}

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = (id) => listeners.forEach((fn) => fn(id));

export const get = (id) => stats.get(id) || { id, favorite: false, playCount: 0, lastPlayed: 0 };
export const isFavorite = (id) => !!stats.get(id)?.favorite;
export const playCount = (id) => stats.get(id)?.playCount || 0;
export const lastPlayed = (id) => stats.get(id)?.lastPlayed || 0;

async function change(id, fn) {
  const next = await db.updateStats(id, fn);
  stats.set(id, next);
  notify(id);
  return next;
}

export async function setFavorite(id, favorite) {
  return change(id, (s) => ({ ...s, favorite, likedAt: favorite ? Date.now() : 0 }));
}

export const toggleFavorite = (id) => setFavorite(id, !isFavorite(id));

// Marks a song as just started (for "Recently played").
export const touch = (id) => change(id, (s) => ({ ...s, lastPlayed: Date.now() }));

// Local calendar day as "YYYY-MM-DD" (the key of the per-day history).
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const bumpDay = (record, { seconds = 0, plays = 0 }) => {
  const key = dayKey();
  const day = record.days?.[key] || { s: 0, p: 0 };
  return { ...record.days, [key]: { s: Math.round(day.s + seconds), p: day.p + plays } };
};

// Counts one listen (called once a song has really been listened to).
export const countPlay = (id) =>
  change(id, (s) => ({ ...s, playCount: (s.playCount || 0) + 1, lastPlayed: Date.now(), days: bumpDay(s, { plays: 1 }) }));

// Adds listening time to a song's totals, its per-day history and the hour-of-day histogram. Silent: the
// lists don't need to redraw for it.
export async function addListening(id, seconds) {
  const hour = new Date().getHours();
  const next = await db.updateStats(id, (s) => {
    const hours = Array.from({ length: 24 }, (_, h) => s.hours?.[h] || 0);
    hours[hour] += seconds;
    return { ...s, listenSec: (s.listenSec || 0) + seconds, days: bumpDay(s, { seconds }), hours };
  });
  stats.set(id, next);
}

// Waveform peaks (an array of small integers) used by the player's seek bar.
export const waveOf = (id) => stats.get(id).wave || null;
export async function setWave(id, wave) {
  const next = await db.updateStats(id, (s) => ({ ...s, wave }));
  stats.set(id, next);
}

// Stores a song's measured loudness without telling the UI (it is not something to redraw lists for).
export async function setLoudness(id, loudness, peak) {
  const next = await db.updateStats(id, (s) => ({ ...s, loudness, peak, scanned: true }));
  stats.set(id, next);
}

// Songs sorted by a criterion, restricted to the given list of songs.
export function favorites(songs) {
  return songs.filter((s) => isFavorite(s.id)).sort((a, b) => (stats.get(b.id).likedAt || 0) - (stats.get(a.id).likedAt || 0));
}
export function recent(songs, limit = 50) {
  return songs.filter((s) => lastPlayed(s.id) > 0).sort((a, b) => lastPlayed(b.id) - lastPlayed(a.id)).slice(0, limit);
}
export function mostPlayed(songs, limit = 50) {
  return songs.filter((s) => playCount(s.id) > 0).sort((a, b) => playCount(b.id) - playCount(a.id) || lastPlayed(b.id) - lastPlayed(a.id)).slice(0, limit);
}

// Used by backup/restore.
export const all = () => [...stats.values()];
export function forget(ids) {
  ids.forEach((id) => stats.delete(id));
  notify();
}
export function reset() {
  stats.clear();
  notify();
}
