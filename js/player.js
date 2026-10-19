// Playback engine. Two <audio> "decks" live for the whole session: while one plays, the next song is
// preloaded on the other, which gives near-gapless playback and makes crossfading possible. Music keeps
// playing while the user browses between views.
import * as db from "./db.js";
import { dominantColor, getDuration, normalizeAudio } from "./meta.js";
import { EQ_PRESETS, getCrossfade, getEq, setEqPrefs } from "./prefs.js";
import { t } from "./i18n.js";
import * as loudness from "./loudness.js";
import * as stats from "./stats.js";
import { toast } from "./ui.js";

const STORAGE_KEY = "ocwave.player";
const EQ_TYPES = ["lowshelf", "peaking", "peaking", "peaking", "highshelf"];
const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000];

const listeners = new Set();
const timeListeners = new Set();
const cache = new Map(); // song id -> song record
let loadToken = 0;
let lastPersist = 0;

export const state = {
  base: [], // queue in playlist order
  order: [], // queue in play order (shuffled when shuffle is on)
  pos: -1,
  song: null,
  playing: false,
  shuffle: false,
  repeat: "off", // off | all | one
  volume: 0.8,
  muted: false,
  rate: 1,
  source: null, // { type, id, name }
  color: [90, 90, 110],
  sleep: null, // { mode: "time", endsAt } | { mode: "song" }
};

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const subscribeTime = (fn) => (timeListeners.add(fn), () => timeListeners.delete(fn));
export const getCached = (id) => cache.get(id);
const emit = () => listeners.forEach((fn) => fn(state));

/* --------------------------------- Decks --------------------------------- */

function makeDeck() {
  const audio = new Audio();
  audio.preload = "auto";
  return { audio, source: null, gain: null, url: null, songId: null };
}
const decks = [makeDeck(), makeDeck()];
let active = 0;
const cur = () => decks[active];
const idle = () => decks[1 - active];
const A = () => cur().audio;

export const getTime = () => ({ current: A().currentTime || 0, duration: A().duration || state.song?.duration || 0 });

/* ------------------------------ Web Audio graph ------------------------------ */
// decks -> normalisation gain -> deck gain (crossfade) -> 5 EQ filters -> headroom -> volume -> speakers
//                                                                          \-> analyser (visualiser)

let ctx = null;
let eqFilters = [];
let headroom = null;
let analyser = null;
let volumeNode = null;
let volumeScale = 1; // used by the sleep timer fade-out

function ensureGraph() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    eqFilters = EQ_TYPES.map((type, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = EQ_FREQUENCIES[i];
      filter.Q.value = type === "peaking" ? 1 : 0.7;
      return filter;
    });
    eqFilters.reduce((previous, next) => (previous.connect(next), next));
    headroom = ctx.createGain();
    volumeNode = ctx.createGain();
    eqFilters.at(-1).connect(headroom);
    headroom.connect(volumeNode);
    volumeNode.connect(ctx.destination);
    analyser = ctx.createAnalyser(); // listens after the EQ but before the volume, so the visuals ignore the volume slider
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    headroom.connect(analyser);
    for (const deck of decks) {
      deck.source = ctx.createMediaElementSource(deck.audio);
      deck.norm = ctx.createGain();
      deck.gain = ctx.createGain();
      deck.gain.gain.value = deck === cur() ? 1 : 0;
      deck.source.connect(deck.norm);
      deck.norm.connect(deck.gain);
      deck.gain.connect(eqFilters[0]);
      deck.audio.volume = 1; // the volume node handles loudness from now on
    }
    applyEq();
    applyVolume();
    applyNormalization();
    ctx.addEventListener("statechange", keepRunning);
  } catch (error) {
    console.warn("Web Audio unavailable, EQ and crossfade are disabled.", error);
    ctx = null;
  }
  return ctx;
}

// iOS can suspend or "interrupt" the audio context (calls, Siri, locking). Bring it back while a song should be playing.
function keepRunning() {
  if (ctx && ctx.state !== "running" && state.playing && !A().paused) ctx.resume().catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  keepRunning();
  preloadNext(); // restore the gapless preload skipped while in the background
});

function applyVolume() {
  const level = (state.muted ? 0 : state.volume) * volumeScale;
  if (ctx) volumeNode.gain.setTargetAtTime(level, ctx.currentTime, 0.015);
  else decks.forEach((deck) => (deck.audio.volume = level));
}

// For the live visualiser: null until the first song has started.
export const getAnalyser = () => analyser;

// Sets every deck's normalisation gain from its song's measured loudness (1 = unchanged).
export function applyNormalization({ instant = false } = {}) {
  if (!ctx) return;
  for (const deck of decks) {
    const gain = deck.songId != null ? loudness.gainFor(deck.songId) : 1;
    if (instant) deck.norm.gain.setValueAtTime(gain, ctx.currentTime);
    else deck.norm.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
  }
}

export function applyEq() {
  if (!ctx) return;
  const eq = getEq();
  const gains = eq.on ? eq.gains : eq.gains.map(() => 0);
  eqFilters.forEach((filter, i) => filter.gain.setTargetAtTime(gains[i], ctx.currentTime, 0.02));
  // Lower the overall level a little when boosting, to avoid clipping.
  headroom.gain.setTargetAtTime(10 ** (-Math.max(0, ...gains) / 40), ctx.currentTime, 0.02);
}

export function setEq(patch) {
  const eq = { ...getEq(), ...patch };
  if (patch.preset && EQ_PRESETS[patch.preset]) eq.gains = [...EQ_PRESETS[patch.preset].gains];
  setEqPrefs(eq);
  applyEq();
  return eq;
}

async function startPlayback(deck) {
  ensureGraph();
  if (ctx?.state === "suspended") await ctx.resume().catch(() => {});
  return deck.audio.play();
}

/* ------------------------------ Persistence ------------------------------ */

function persist(force = false) {
  const now = Date.now();
  if (!force && now - lastPersist < 3000) return;
  lastPersist = now;
  try {
    const { base, order, pos, shuffle, repeat, volume, muted, rate, source } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ base, order, pos, shuffle, repeat, volume, muted, rate, source, time: A().currentTime || 0 }));
  } catch {
    /* storage unavailable */
  }
}

function shuffled(ids) {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function cacheSongs(ids) {
  const missing = ids.filter((id) => !cache.has(id));
  (await db.getSongsByIds(missing)).forEach((song) => cache.set(song.id, song));
}

/* ------------------------------ Loading ------------------------------ */

// Puts a song's audio into a deck. Resolves the song, or null if it no longer exists.
async function prepareDeck(deck, id) {
  const song = cache.get(id) || (await db.getSong(id));
  if (!song?.blob) return null;
  cache.set(id, song);
  if (deck.url) URL.revokeObjectURL(deck.url);
  deck.url = URL.createObjectURL(song.blob);
  deck.audio.src = deck.url;
  deck.audio.playbackRate = state.rate;
  deck.songId = id;
  if (ctx) deck.norm.gain.setValueAtTime(loudness.gainFor(id), ctx.currentTime);
  loudness.ensure(id).then((measured) => measured && deck.songId === id && applyNormalization());
  return song;
}

function nextPos() {
  if (state.pos + 1 < state.order.length) return state.pos + 1;
  return state.repeat === "all" && state.order.length ? 0 : -1;
}

// Preloads the upcoming song on the idle deck so the switch is instant.
function preloadNext() {
  const pos = state.repeat === "one" ? -1 : nextPos();
  const id = pos >= 0 ? state.order[pos] : undefined;
  if (id !== undefined && id !== state.order[state.pos] && idle().songId !== id) prepareDeck(idle(), id);
}

function setGains(activeDeck) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const deck of decks) {
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(deck === activeDeck ? 1 : 0, now);
  }
}

let crossfadeToken = 0;

async function loadCurrent({ autoplay, startTime = 0 }) {
  const token = ++loadToken;
  crossfadeToken++; // cancels a running crossfade
  const id = state.order[state.pos];

  let song;
  // While the screen is locked, iOS only lets an audio element that the user already started play on its own, so
  // in the background the next song is loaded into the deck that is playing instead of switching decks.
  if (!document.hidden && idle().songId === id && idle().url) {
    A().pause(); // the preloaded deck already holds this song
    active = 1 - active;
    song = cache.get(id);
  } else {
    song = await prepareDeck(cur(), id);
    if (token !== loadToken) return;
  }
  if (!song) {
    purge([id]);
    return;
  }
  idle().audio.pause();
  setGains(cur());
  const audio = A();
  audio.playbackRate = state.rate;
  if (startTime) {
    if (audio.readyState >= 1) audio.currentTime = startTime;
    else audio.addEventListener("loadedmetadata", () => (audio.currentTime = startTime), { once: true });
  } else if (audio.currentTime > 0) {
    audio.currentTime = 0;
  }

  state.song = song;
  resetListening(song.id);
  updateMediaSession();
  setColorFor(song);
  emit();
  if (autoplay) {
    try {
      await startPlayback(cur());
    } catch (error) {
      if (error.name === "NotSupportedError" && (await repairCurrentSong())) return;
      if (error.name !== "AbortError") toast(t("Couldn't play this song."), { type: "error" });
    }
  }
  if (!document.hidden) preloadNext();
}

function setColorFor(song) {
  dominantColor(song.cover).then((color) => {
    if (state.song?.id === song.id) {
      state.color = color;
      emit();
    }
  });
}

/* ------------------------------ Crossfade ------------------------------ */

async function startCrossfade(seconds) {
  const token = ++crossfadeToken;
  let pos = nextPos();
  if (pos === 0 && state.shuffle && state.pos !== 0) {
    state.order = shuffled(state.order);
    idle().songId = null; // the preloaded song may no longer be next
  }
  const id = state.order[pos];
  const out = cur();
  const incoming = idle();
  if (incoming.songId !== id && !(await prepareDeck(incoming, id))) return;
  if (token !== crossfadeToken) return;

  state.pos = pos;
  state.song = cache.get(id);
  resetListening(id);
  active = 1 - active;
  incoming.audio.currentTime = 0;
  incoming.audio.playbackRate = state.rate;

  const now = ctx.currentTime;
  out.gain.gain.cancelScheduledValues(now);
  out.gain.gain.setValueAtTime(out.gain.gain.value, now);
  out.gain.gain.linearRampToValueAtTime(0, now + seconds);
  incoming.gain.gain.cancelScheduledValues(now);
  incoming.gain.gain.setValueAtTime(0, now);
  incoming.gain.gain.linearRampToValueAtTime(1, now + seconds);

  updateMediaSession();
  setColorFor(state.song);
  persist(true);
  emit();
  startPlayback(incoming).catch(() => {});
  setTimeout(() => {
    if (token !== crossfadeToken) return;
    out.audio.pause();
    preloadNext();
  }, seconds * 1000 + 150);
}

function maybeCrossfade(time) {
  const seconds = getCrossfade();
  if (!seconds || !ctx || document.hidden || !time.duration || state.repeat === "one" || state.sleep?.mode === "song") return;
  const remaining = time.duration - time.current;
  if (remaining > seconds + 0.2 || remaining < 0.3 || time.duration < seconds * 2 + 2) return;
  if (nextPos() < 0 || crossfadeActive()) return;
  startCrossfade(Math.min(seconds, remaining));
}

// A crossfade is running while the idle deck is also audible.
const crossfadeActive = () => !idle().audio.paused;

/* ------------------------------ Controls ------------------------------ */

export async function playQueue(ids, { start = 0, shuffle, source = null } = {}) {
  if (!ids.length) return;
  if (shuffle !== undefined) state.shuffle = shuffle;
  state.base = [...ids];
  state.source = source;
  await cacheSongs(ids);
  const startId = state.base[Math.min(start, ids.length - 1)];
  idle().songId = null;
  if (state.shuffle) {
    state.order = [startId, ...shuffled(state.base.filter((id) => id !== startId))];
    state.pos = 0;
  } else {
    state.order = [...state.base];
    state.pos = state.order.indexOf(startId);
  }
  persist(true);
  await loadCurrent({ autoplay: true });
}

export async function playAt(pos) {
  if (pos < 0 || pos >= state.order.length) return;
  state.pos = pos;
  persist(true);
  await loadCurrent({ autoplay: true });
}

// Queue editing: "Play next" and "Add to queue".
export async function enqueue(ids, { next = false } = {}) {
  if (!state.order.length) return playQueue(ids, { source: { type: "queue", name: "Queue" } });
  await cacheSongs(ids);
  const at = next ? state.pos + 1 : state.order.length;
  state.order.splice(at, 0, ...ids);
  state.base.splice(next ? Math.max(0, state.base.indexOf(state.order[state.pos]) + 1) : state.base.length, 0, ...ids);
  idle().songId = null;
  preloadNext();
  persist(true);
  emit();
}

export function togglePlay() {
  if (!state.song) return;
  if (A().paused) startPlayback(cur()).catch(() => {});
  else {
    A().pause();
    idle().audio.pause(); // also stops a song that is fading out during a crossfade
  }
}

export function next() {
  if (!state.order.length) return;
  playAt((state.pos + 1) % state.order.length);
}

export function prev() {
  if (!state.order.length) return;
  if (A().currentTime > 3 || state.pos === 0) A().currentTime = 0;
  else playAt(state.pos - 1);
}

export function seek(seconds) {
  if (Number.isFinite(A().duration)) A().currentTime = Math.min(Math.max(0, seconds), A().duration);
}
export const seekBy = (delta) => seek(A().currentTime + delta);

export function setVolume(value) {
  state.volume = Math.min(1, Math.max(0, value));
  state.muted = false;
  applyVolume();
  persist(true);
  emit();
}

export function toggleMute() {
  state.muted = !state.muted;
  applyVolume();
  persist(true);
  emit();
}

export function setRate(rate) {
  state.rate = rate;
  decks.forEach((deck) => (deck.audio.playbackRate = rate));
  persist(true);
  emit();
}

export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  const currentId = state.order[state.pos];
  if (state.shuffle) {
    state.order = [currentId, ...shuffled(state.base.filter((id) => id !== currentId))].filter((id) => id !== undefined);
    state.pos = state.order.length ? 0 : -1;
  } else {
    state.order = [...state.base];
    state.pos = Math.max(0, state.order.indexOf(currentId));
  }
  idle().songId = null;
  preloadNext();
  persist(true);
  emit();
}

export function cycleRepeat() {
  state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
  idle().songId = null;
  preloadNext();
  persist(true);
  emit();
}

/* ------------------------------ Queue editing ------------------------------ */

const refreshQueue = () => {
  idle().songId = null; // the preloaded "next" song may have changed
  preloadNext();
  persist(true);
  emit();
};
const removeFromBase = (id) => {
  const index = state.base.indexOf(id);
  if (index >= 0) state.base.splice(index, 1);
};

// Moves the entry at play-order position `from` to position `to`.
export function moveInQueue(from, to) {
  const last = state.order.length - 1;
  if (from === to || from < 0 || to < 0 || from > last || to > last) return;
  const [moved] = state.order.splice(from, 1);
  state.order.splice(to, 0, moved);
  if (from === state.pos) state.pos = to;
  else if (from < state.pos && to >= state.pos) state.pos--;
  else if (from > state.pos && to <= state.pos) state.pos++;
  if (!state.shuffle) state.base = [...state.order]; // without shuffle the play order is the playlist order
  refreshQueue();
}

export function removeFromQueue(pos) {
  if (pos < 0 || pos >= state.order.length) return;
  const id = state.order[pos];
  if (state.order.length === 1) return clear();
  state.order.splice(pos, 1);
  removeFromBase(id);
  if (pos === state.pos) {
    // The current song was removed: carry on with whatever took its place.
    state.pos = Math.min(pos, state.order.length - 1);
    idle().songId = null;
    loadCurrent({ autoplay: !A().paused });
    return;
  }
  if (pos < state.pos) state.pos--;
  refreshQueue();
}

// Removes everything after the current song.
export function clearUpcoming() {
  if (state.pos < 0 || state.pos >= state.order.length - 1) return;
  state.order.length = state.pos + 1;
  const keep = new Set(state.order);
  state.base = state.base.filter((id) => keep.has(id));
  refreshQueue();
}

/* --------------------------- Listening statistics --------------------------- */

let listening = { songId: null, seconds: 0, last: null, touched: false, counted: false };
let owed = { id: null, seconds: 0 }; // listening time not yet written to the statistics

// Writes the time listened so far to the stats (in small batches, so the database isn't hit every second).
function flushListening() {
  if (owed.id !== null && owed.seconds >= 1) stats.addListening(owed.id, owed.seconds).catch(() => {});
  owed.seconds = 0;
}
function resetListening(songId) {
  flushListening();
  listening = { songId, seconds: 0, last: null, touched: false, counted: false };
}

// Adds up real listening time (seeking doesn't count). After a couple of seconds the song counts as
// "recently played"; after 30 s (or half of a short song) it counts as one play.
function trackListening({ current, duration }) {
  const id = state.song?.id;
  if (id === undefined || listening.songId !== id || !state.playing) return;
  if (listening.last !== null) {
    const delta = current - listening.last;
    if (delta > 0 && delta < 1.5) {
      listening.seconds += delta;
      if (owed.id !== id) (flushListening(), (owed.id = id));
      owed.seconds += delta;
      if (owed.seconds >= 15) flushListening();
    }
  }
  listening.last = current;
  if (!listening.touched && listening.seconds > 2) {
    listening.touched = true;
    stats.touch(id).catch(() => {});
  }
  if (!listening.counted && listening.seconds >= Math.min(30, (duration || 60) * 0.5)) {
    listening.counted = true;
    stats.countPlay(id).catch(() => {});
  }
}

/* ------------------------------ Sleep timer ------------------------------ */

let sleepTimer = null;

// option: minutes (number), "song" (stop after this song) or null to cancel.
export function setSleep(option) {
  clearInterval(sleepTimer);
  sleepTimer = null;
  state.sleep = option === "song" ? { mode: "song" } : option ? { mode: "time", minutes: option, endsAt: Date.now() + option * 60000 } : null;
  if (state.sleep?.mode === "time") sleepTimer = setInterval(sleepTick, 1000);
  emit();
}

function sleepTick() {
  if (!state.sleep || state.sleep.mode !== "time") return;
  const left = state.sleep.endsAt - Date.now();
  if (left <= 0) fadeOutAndPause();
  else emit(); // keeps the countdown in the UI fresh
}

function fadeOutAndPause() {
  clearInterval(sleepTimer);
  sleepTimer = null;
  state.sleep = null;
  emit();
  const steps = 40;
  let step = 0;
  const fade = setInterval(() => {
    volumeScale = Math.max(0, 1 - ++step / steps);
    applyVolume();
    if (step >= steps) {
      clearInterval(fade);
      decks.forEach((deck) => deck.audio.pause());
      volumeScale = 1;
      applyVolume();
    }
  }, 120);
}

/* --------------------------- Library changes --------------------------- */

// Call after songs were deleted from the database.
export function purge(ids) {
  const gone = new Set(ids);
  if (![...state.order, ...state.base].some((id) => gone.has(id))) return;
  const currentId = state.order[state.pos];
  state.base = state.base.filter((id) => !gone.has(id));
  state.order = state.order.filter((id) => !gone.has(id));
  ids.forEach((id) => cache.delete(id));
  decks.forEach((deck) => gone.has(deck.songId) && (deck.songId = null));

  if (!state.order.length) {
    clear();
    return;
  }
  if (gone.has(currentId)) {
    state.pos = Math.min(state.pos, state.order.length - 1);
    loadCurrent({ autoplay: !A().paused });
  } else {
    state.pos = state.order.indexOf(currentId);
    persist(true);
    emit();
  }
}

export function refreshSong(song) {
  cache.set(song.id, song);
  if (state.song?.id === song.id) {
    state.song = song;
    updateMediaSession();
  }
  emit();
}

export function clear() {
  loadToken++;
  crossfadeToken++;
  for (const deck of decks) {
    deck.audio.pause();
    deck.audio.removeAttribute("src");
    deck.audio.load();
    if (deck.url) URL.revokeObjectURL(deck.url);
    deck.url = null;
    deck.songId = null;
  }
  Object.assign(state, { base: [], order: [], pos: -1, song: null, playing: false, source: null, sleep: null });
  clearInterval(sleepTimer);
  cache.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  emit();
}

/* ------------------------------ Media session ------------------------------ */

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !state.song) return;
  const { title, artist, album, cover } = state.song;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: album || state.source?.name || "",
    artwork: [{ src: cover, sizes: "480x480", type: "image/jpeg" }],
  });
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => startPlayback(cur()),
    pause: () => A().pause(),
    previoustrack: prev,
    nexttrack: next,
    seekbackward: () => seekBy(-10),
    seekforward: () => seekBy(10),
    seekto: (d) => seek(d.seekTime),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action unsupported */
    }
  }
}

/* ------------------------------ Self-repair ------------------------------ */

const repairAttempted = new Set();

// If a stored song won't decode, check whether it is a mislabelled file (e.g. M4A data behind an ".mp3" name
// and ID3 tag). If so, store the corrected audio and carry on playing. Resolves true when a fix was applied.
async function repairCurrentSong() {
  const song = state.song;
  if (!song?.blob || repairAttempted.has(song.id)) return false;
  repairAttempted.add(song.id);
  try {
    const fixed = await normalizeAudio(song.blob);
    if (fixed === song.blob || (fixed.type === song.blob.type && fixed.size === song.blob.size)) return false;
    const duration = (await getDuration(fixed)) || song.duration;
    if (!duration) return false; // the fixed file still can't be read
    const updated = await db.updateSong(song.id, { blob: fixed, duration });
    for (const playlist of await db.getPlaylists()) {
      if (playlist.songIds.includes(song.id)) await db.setPlaylistSongs(playlist.id, playlist.songIds);
    }
    cache.set(song.id, updated);
    state.song = updated;
    toast(t("Fixed the audio format of \"{title}\".", { title: song.title }), { type: "success" });
    await loadCurrent({ autoplay: true });
    return true;
  } catch (error) {
    console.warn("Repair failed:", error);
    return false;
  }
}

/* --------------------------------- Setup --------------------------------- */

// Only the active deck drives the UI; the idle deck is just preloading or fading out.
const fromActive = (handler) => (event) => event.target === A() && handler(event);

function onEnded() {
  if (state.sleep?.mode === "song") {
    state.sleep = null;
    A().currentTime = 0;
    A().pause();
    emit();
    return;
  }
  if (state.repeat === "one") {
    A().currentTime = 0;
    startPlayback(cur());
  } else if (state.pos < state.order.length - 1) {
    playAt(state.pos + 1);
  } else if (state.repeat === "all") {
    if (state.shuffle) state.order = shuffled(state.order);
    idle().songId = null;
    playAt(0);
  } else {
    A().currentTime = 0;
    A().pause();
  }
}

for (const deck of decks) {
  const audio = deck.audio;
  audio.addEventListener("play", fromActive(() => ((state.playing = true), emit())));
  audio.addEventListener("pause", fromActive(() => {
    state.playing = false;
    flushListening();
    persist(true);
    emit();
  }));
  audio.addEventListener("loadedmetadata", fromActive(() => timeListeners.forEach((fn) => fn(getTime()))));
  audio.addEventListener("timeupdate", fromActive(() => {
    const time = getTime();
    timeListeners.forEach((fn) => fn(time));
    persist();
    trackListening(time);
    maybeCrossfade(time);
    if ("mediaSession" in navigator && time.duration) {
      try {
        navigator.mediaSession.setPositionState({ duration: time.duration, position: Math.min(time.current, time.duration), playbackRate: state.rate });
      } catch {
        /* ignore */
      }
    }
  }));
  audio.addEventListener("ended", fromActive(onEnded));
  audio.addEventListener("error", fromActive(async () => {
    if (!audio.currentSrc) return;
    if (await repairCurrentSong()) return;
    toast(t("Couldn't play \"{title}\". The file may be damaged or in an unsupported format.", { title: state.song?.title ?? t("this song") }), { type: "error" });
  }));
}

export async function init() {
  setupMediaSession();
  try {
    navigator.audioSession.type = "playback"; // Safari: treat this as media playback (keeps going when locked, ignores the silent switch)
  } catch {
    /* not supported */
  }
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* ignore corrupt data */
  }
  if (!saved) {
    applyVolume();
    return;
  }
  Object.assign(state, {
    shuffle: !!saved.shuffle,
    repeat: ["off", "all", "one"].includes(saved.repeat) ? saved.repeat : "off",
    volume: typeof saved.volume === "number" ? saved.volume : 0.8,
    muted: !!saved.muted,
    rate: typeof saved.rate === "number" ? saved.rate : 1,
    source: saved.source || null,
    base: Array.isArray(saved.base) ? saved.base : [],
    order: Array.isArray(saved.order) ? saved.order : [],
    pos: Number.isInteger(saved.pos) ? saved.pos : -1,
  });
  applyVolume();

  if (state.pos >= 0 && state.order[state.pos] !== undefined) {
    await cacheSongs(state.order);
    // Drop songs that no longer exist, then restore the position without autoplaying.
    const currentId = state.order[state.pos];
    state.base = state.base.filter((id) => cache.has(id));
    state.order = state.order.filter((id) => cache.has(id));
    state.pos = state.order.indexOf(currentId);
    if (state.pos === -1 && state.order.length) state.pos = 0;
    if (state.pos >= 0) await loadCurrent({ autoplay: false, startTime: saved.time || 0 });
  }
}

window.addEventListener("pagehide", () => (persist(true), flushListening()));
