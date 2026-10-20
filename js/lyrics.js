// Lyrics: embedded tags, .lrc files and an online lookup on LRCLIB (https://lrclib.net, free, no API key).
import * as db from "./db.js";
import { t } from "./i18n.js";
import { getLyricsOnline } from "./prefs.js";

const API = "https://lrclib.net/api";
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // don't re-query songs without lyrics for a week

const TIME_TAG = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
const WORD_TAG = /<(\d+):(\d+)(?:[.:](\d+))?>/g; // "enhanced LRC": <00:12.50>word <00:12.90>word

const seconds = (min, sec, frac = "0") => Number(min) * 60 + Number(sec) + Number(`0.${frac}`);
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

// Splits a line with word tags into [{ t, text }]. Text before the first tag starts with the line.
function parseWords(content, lineTime) {
  const tags = [...content.matchAll(WORD_TAG)];
  if (!tags.length) return null;
  const words = [];
  const add = (time, text) => text.trim() && words.push({ t: time, text: text.trim() });
  add(lineTime, content.slice(0, tags[0].index));
  tags.forEach((tag, i) => {
    const end = i + 1 < tags.length ? tags[i + 1].index : content.length;
    add(seconds(tag[1], tag[2], tag[3]), content.slice(tag.index + tag[0].length, end));
  });
  return words.length ? words : null;
}

// Parses LRC text into [{ t, text, words? }] sorted by time, or null when it has no timestamps.
// `words` is only present for enhanced LRC lines that carry per-word timestamps.
export function parseLrc(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const times = [...raw.matchAll(TIME_TAG)];
    if (!times.length) continue;
    const content = raw.replace(TIME_TAG, "").trim();
    for (const [, min, sec, frac] of times) {
      const t = seconds(min, sec, frac);
      const words = parseWords(content, t);
      lines.push(words ? { t, text: words.map((w) => w.text).join(CJK.test(content) ? "" : " "), words } : { t, text: content });
    }
  }
  return lines.length ? lines.sort((a, b) => a.t - b.t) : null;
}

/**
 * The words of line `i` with the time each one starts and ends: [{ text, s, e, space }].
 * Real timestamps are used when the lyrics have them (enhanced LRC). Otherwise the line is split into words and
 * the time until the next line is shared out by word length, assuming a natural singing pace, so the highlight
 * glides across the line. LRCLIB only provides line timing, so this estimate is what most songs get.
 */
export function lineWords(lines, i, duration = 0) {
  const line = lines[i];
  if (!line?.text) return [];
  const next = lines[i + 1]?.t ?? (duration > line.t ? duration : line.t + 5);
  const spaced = !CJK.test(line.text);

  if (line.words?.length) {
    return line.words.map((word, k) => ({
      text: word.text,
      s: word.t,
      e: line.words[k + 1]?.t ?? Math.min(next, word.t + 1.2),
      space: spaced,
    }));
  }

  // No spaces in Chinese, Japanese and Korean lyrics: highlight character by character.
  const tokens = spaced ? line.text.split(/\s+/).filter(Boolean) : Array.from(line.text.replace(/\s+/g, ""));
  const gap = Math.max(0.4, next - line.t);
  // Seconds the line is actually sung: most of the time until the next line (singers rarely rush), but a short line
  // before a long break doesn't last the whole break (3 characters per second is a very slow ballad).
  const sung = Math.min(gap * 0.9, Math.max(1.5, line.text.length / 3));
  const weights = tokens.map((token) => (spaced ? token.length + 1 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = line.t;
  return tokens.map((token, k) => {
    const length = (weights[k] / total) * sung;
    const word = { text: token, s: cursor, e: cursor + length, space: spaced };
    cursor += length;
    return word;
  });
}

// Builds the stored lyrics object from raw text (plain or LRC).
export function toLyrics(text, source) {
  const synced = parseLrc(text);
  return {
    source,
    synced,
    plain: synced ? synced.map((line) => line.text).join("\n") : text.replace(/\r\n/g, "\n").trim(),
  };
}

const cleanTitle = (title) =>
  title
    .replace(/[([][^)\]]*(official|lyrics?|video|audio|remaster|live|feat|ft\.)[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+(remaster(ed)?|single version|radio edit).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves the parsed JSON, null for "not found" (4xx), or undefined for a temporary failure
// (offline, or the service answered 429/5xx). Temporary failures are retried a couple of times,
// since LRCLIB sometimes answers "server busy, retry in a moment".
async function getJson(url, attempt = 0) {
  try {
    const response = await fetch(url);
    if (response.ok) return await response.json();
    if (response.status !== 429 && response.status < 500) return null;
  } catch {
    /* network error: fall through to retry */
  }
  if (attempt >= 2) return undefined;
  await sleep(700 * (attempt + 1));
  return getJson(url, attempt + 1);
}

const usable = (hit) => hit && (hit.syncedLyrics || hit.plainLyrics || hit.instrumental);

// Returns { hit } (hit may be null when nothing was found) or { error: true } when offline.
async function lookupOnline(song) {
  const track = cleanTitle(song.title);
  const artist = song.artist && song.artist !== "Unknown artist" ? song.artist : "";
  const duration = Math.round(song.duration || 0);

  if (artist) {
    const params = new URLSearchParams({ track_name: track, artist_name: artist });
    if (duration) params.set("duration", duration);
    const exact = await getJson(`${API}/get?${params}`);
    if (usable(exact)) return { hit: exact };
  }

  const query = artist ? new URLSearchParams({ track_name: track, artist_name: artist }) : new URLSearchParams({ q: track });
  const results = await getJson(`${API}/search?${query}`);
  if (results === undefined) return { error: true }; // temporary failure: don't remember it as "no lyrics"
  const candidates = (Array.isArray(results) ? results : []).filter(usable);
  if (!candidates.length) return { hit: null };

  // Prefer synced lyrics and a duration close to the file's.
  const score = (hit) => (hit.syncedLyrics ? 0 : 10) + (duration && hit.duration ? Math.min(30, Math.abs(hit.duration - duration)) : 5);
  candidates.sort((a, b) => score(a) - score(b));
  const best = candidates[0];
  if (duration && best.duration && Math.abs(best.duration - duration) > 8) {
    // A different cut of the song: timestamps wouldn't line up, so only use plain text, and only
    // when the artist is known (a title-only match could easily be a different song).
    return artist ? { hit: best, plainOnly: true } : { hit: null };
  }
  return { hit: best };
}

// Resolves { status, lyrics?, song? } where status is "ok" | "none" | "disabled" | "error".
// Found (or confirmed missing) lyrics are cached on the song record.
export async function loadLyrics(song, { force = false } = {}) {
  const cached = song.lyrics;
  if (cached && !cached.none && (cached.synced || cached.plain || cached.instrumental)) return { status: "ok", lyrics: cached, song };
  if (cached?.none && !force && Date.now() - cached.checkedAt < RETRY_AFTER_MS) return { status: "none", song };
  if (!getLyricsOnline()) return { status: "disabled", song };

  const result = await lookupOnline(song);
  if (result.error) return { status: "error", song };
  if (!result.hit) {
    const updated = await db.updateSong(song.id, { lyrics: { none: true, checkedAt: Date.now() } });
    return { status: "none", song: updated || song };
  }
  const { hit, plainOnly } = result;
  let lyrics;
  if (hit.instrumental && !hit.plainLyrics && !hit.syncedLyrics) lyrics = { source: "lrclib", instrumental: true, synced: null, plain: "" };
  else if (plainOnly) lyrics = { source: "lrclib", synced: null, plain: hit.plainLyrics || toLyrics(hit.syncedLyrics, "lrclib").plain };
  else lyrics = toLyrics(hit.syncedLyrics || hit.plainLyrics, "lrclib");
  const updated = await db.updateSong(song.id, { lyrics });
  return { status: "ok", lyrics, song: updated || song };
}

// Saves lyrics from a user-provided .lrc/.txt file.
export async function importLyricsFile(song, file) {
  const lyrics = toLyrics(await file.text(), "file");
  if (!lyrics.plain) throw new Error(t("That file is empty."));
  return { lyrics, song: (await db.updateSong(song.id, { lyrics })) || song };
}
