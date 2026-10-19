// Backup and restore of the whole library as a single .ocwave file.
//
// Layout: "OCWAVE01" (8 bytes) | manifest length (uint32, big endian) | manifest JSON | audio blobs back to back.
// The blobs are only referenced (never read into memory at once), so large libraries are fine.
import * as db from "./db.js";
import { t } from "./i18n.js";
import * as stats from "./stats.js";

const MAGIC = "OCWAVE01";
const HEADER_LENGTH = MAGIC.length + 4;

export async function exportLibrary() {
  const [songs, playlists, songStats] = await Promise.all([db.getAllSongs(), db.getPlaylists(), db.getAllStats()]);
  if (!songs.length && !playlists.length) throw new Error(t("There's nothing to back up yet."));

  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: songs.map(({ id, title, artist, album, cover, duration, lyrics, fileName, size, addedAt, blob }) => ({
      id, title, artist, album, cover, duration, lyrics, fileName, size, addedAt, bytes: blob.size, type: blob.type,
    })),
    playlists: playlists.map(({ id, name, cover, songIds, createdAt }) => ({ id, name, cover, songIds, createdAt })),
    stats: songStats, // liked songs, play counts, last played
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(MAGIC.length, json.length);
  const parts = [header, json, ...songs.map((song) => song.blob)];
  const name = `ocwave-backup-${new Date().toISOString().slice(0, 10)}.ocwave`;

  if (window.showSaveFilePicker) {
    // Streams straight to disk.
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: "OcWave backup", accept: { "application/octet-stream": [".ocwave"] } }],
    });
    const writable = await handle.createWritable();
    for (const part of parts) await writable.write(part);
    await writable.close();
  } else {
    const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return { songs: songs.length, playlists: playlists.length };
}

// Restores a backup. Songs already in the library (same file name and size) are reused, playlists are added.
export async function importBackup(file, onProgress = () => {}) {
  const head = new Uint8Array(await file.slice(0, HEADER_LENGTH).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, MAGIC.length)) !== MAGIC) throw new Error(t("That isn't an OcWave backup file."));
  const manifestLength = new DataView(head.buffer).getUint32(MAGIC.length);
  const manifest = JSON.parse(await file.slice(HEADER_LENGTH, HEADER_LENGTH + manifestLength).text());

  const known = await db.getAllSongs();
  const idMap = new Map(); // id in the backup -> id in this library
  let offset = HEADER_LENGTH + manifestLength;
  let added = 0;
  let reused = 0;

  for (const [index, entry] of manifest.songs.entries()) {
    onProgress(index + 1, manifest.songs.length);
    const blob = file.slice(offset, offset + entry.bytes, entry.type || "audio/mpeg");
    offset += entry.bytes;
    const existing = known.find((song) => song.fileName === entry.fileName && song.size === entry.size);
    if (existing) {
      idMap.set(entry.id, existing.id);
      reused++;
      continue;
    }
    const { id, bytes, type, ...song } = entry;
    idMap.set(id, await db.addSong({ ...song, blob }));
    added++;
  }

  // Likes and play counts: merge with what this library already knows (keep the higher numbers).
  for (const saved of manifest.stats ?? []) {
    const id = idMap.get(saved.id);
    if (id === undefined) continue;
    await db.updateStats(id, (current) => ({
      ...current,
      favorite: current.favorite || !!saved.favorite,
      likedAt: Math.max(current.likedAt || 0, saved.likedAt || 0),
      playCount: Math.max(current.playCount || 0, saved.playCount || 0),
      lastPlayed: Math.max(current.lastPlayed || 0, saved.lastPlayed || 0),
    }));
  }
  await stats.init();

  const existingNames = new Set((await db.getPlaylists()).map((p) => p.name));
  for (const entry of manifest.playlists) {
    const name = existingNames.has(entry.name) ? t("{name} (restored)", { name: entry.name }) : entry.name;
    const playlist = await db.createPlaylist(name, { cover: entry.cover ?? null, createdAt: entry.createdAt });
    await db.setPlaylistSongs(playlist.id, entry.songIds.map((id) => idMap.get(id)).filter((id) => id !== undefined));
  }
  return { songs: added, reused, playlists: manifest.playlists.length };
}
