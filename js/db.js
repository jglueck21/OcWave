import { t } from "./i18n.js";

// IndexedDB wrapper. Songs keep their audio Blob, so playback works after a reload
// without asking the user to pick the files again.
const DB_NAME = "OcWave";
const DB_VERSION = 3;

let dbPromise;

export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      // v1 only stored song references (no audio), so they can't be played back anyway.
      if (event.oldVersion < 2 && db.objectStoreNames.contains("songs")) {
        db.deleteObjectStore("songs");
      }
      if (!db.objectStoreNames.contains("songs")) {
        db.createObjectStore("songs", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
      }
      // v3: per-song statistics (liked, play count, last played), kept apart from the songs so that
      // updating them never rewrites the audio data.
      if (!db.objectStoreNames.contains("stats")) {
        db.createObjectStore("stats", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error(t("Database is blocked by another OcWave tab. Close it and reload.")));
  });
  return dbPromise;
}

// Runs fn(store) in one transaction and resolves with the request result once the transaction committed.
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    let result;
    const request = fn(transaction.objectStore(storeName));
    if (request) request.onsuccess = () => (result = request.result);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

/* ------------------------------- Songs ------------------------------- */

export const getAllSongs = () => tx("songs", "readonly", (s) => s.getAll());
export const getSong = (id) => tx("songs", "readonly", (s) => s.get(id));
export const addSong = (song) => tx("songs", "readwrite", (s) => s.add(song));

export async function getSongsByIds(ids) {
  const songs = await Promise.all(ids.map(getSong));
  return songs.filter(Boolean);
}

export async function updateSong(id, patch) {
  const song = await getSong(id);
  if (!song) return null;
  const updated = { ...song, ...patch, id };
  await tx("songs", "readwrite", (s) => s.put(updated));
  return updated;
}

/* ------------------------------- Stats ------------------------------- */

export const getAllStats = () => tx("stats", "readonly", (s) => s.getAll());

// Read-modify-write of one song's stats in a single transaction. `change` receives the current record
// (or a fresh one) and returns the new one.
export async function updateStats(songId, change) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("stats", "readwrite");
    const store = transaction.objectStore("stats");
    let result;
    store.get(songId).onsuccess = (event) => {
      const current = event.target.result || { id: songId, favorite: false, playCount: 0, lastPlayed: 0 };
      result = change({ ...current });
      store.put({ ...result, id: songId });
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

export const putStats = (record) => tx("stats", "readwrite", (s) => s.put(record));

/* ------------------------------ Playlists ------------------------------ */

export const getPlaylists = () => tx("playlists", "readonly", (s) => s.getAll());
export const getPlaylist = (id) => tx("playlists", "readonly", (s) => s.get(id));

export async function createPlaylist(name, extra = {}) {
  const now = Date.now();
  const playlist = {
    name: name || "New Playlist",
    cover: null, // custom cover (data URL)
    autoCover: null, // cover of the first song
    songIds: [],
    duration: 0,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  const id = await tx("playlists", "readwrite", (s) => s.add(playlist));
  return { ...playlist, id };
}

export async function updatePlaylist(id, patch) {
  const playlist = await getPlaylist(id);
  if (!playlist) return null;
  const updated = { ...playlist, ...patch, id, updatedAt: Date.now() };
  await tx("playlists", "readwrite", (s) => s.put(updated));
  return updated;
}

// Replaces the song list and refreshes the cached cover + total duration.
export async function setPlaylistSongs(id, songIds) {
  const songs = await getSongsByIds(songIds);
  return updatePlaylist(id, {
    songIds,
    autoCover: songs[0]?.cover ?? null,
    duration: songs.reduce((sum, song) => sum + (song.duration || 0), 0),
  });
}

export const deletePlaylist = (id) => tx("playlists", "readwrite", (s) => s.delete(id));

// Appends a song to a playlist. Resolves false if it was already in there.
export async function addSongToPlaylist(playlistId, songId) {
  const playlist = await getPlaylist(playlistId);
  if (!playlist || playlist.songIds.includes(songId)) return false;
  await setPlaylistSongs(playlistId, [...playlist.songIds, songId]);
  return true;
}

// Removes songs from every playlist and deletes them from the library.
export async function deleteSongsEverywhere(ids) {
  const doomed = new Set(ids);
  for (const playlist of await getPlaylists()) {
    if (playlist.songIds.some((id) => doomed.has(id))) {
      await setPlaylistSongs(playlist.id, playlist.songIds.filter((id) => !doomed.has(id)));
    }
  }
  await tx("songs", "readwrite", (s) => {
    ids.forEach((id) => s.delete(id));
  });
  await tx("stats", "readwrite", (s) => {
    ids.forEach((id) => s.delete(id));
  });
}

/* ---------------------------- Housekeeping ---------------------------- */

// Deletes songs that no playlist references any more. Returns the removed ids.
export async function gcSongs() {
  const [playlists, keys] = await Promise.all([
    getPlaylists(),
    tx("songs", "readonly", (s) => s.getAllKeys()),
  ]);
  const used = new Set(playlists.flatMap((p) => p.songIds));
  const orphans = keys.filter((key) => !used.has(key));
  if (orphans.length) {
    await tx("songs", "readwrite", (s) => {
      orphans.forEach((key) => s.delete(key));
    });
    await tx("stats", "readwrite", (s) => {
      orphans.forEach((key) => s.delete(key));
    });
  }
  return orphans;
}

export async function wipeAll() {
  await tx("songs", "readwrite", (s) => s.clear());
  await tx("playlists", "readwrite", (s) => s.clear());
  await tx("stats", "readwrite", (s) => s.clear());
}

export async function storageEstimate() {
  try {
    return (await navigator.storage?.estimate?.()) ?? null;
  } catch {
    return null;
  }
}
