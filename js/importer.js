// Turns audio files into stored songs and adds them to a playlist.
import * as db from "./db.js";
import { t } from "./i18n.js";
import * as stats from "./stats.js";
import * as loudness from "./loudness.js";
import { toLyrics } from "./lyrics.js";
import { downscaleImage, generateCover, getDuration, isAudioFile, normalizeAudio, parseFilename, readTags, sniffAudio } from "./meta.js";
import { plural, toast } from "./ui.js";

async function buildSong(file) {
  const audio = await normalizeAudio(file, file.type || "audio/mpeg");
  const [tags, duration] = await Promise.all([readTags(file), getDuration(audio)]);
  // A file the browser can't decode and that holds no recognisable audio is not a song at all, for example a
  // streaming playlist (.m3u8) saved as ".mp3": it would sit in the library and never play.
  if (!duration && !(await sniffAudio(file)).type) throw Object.assign(new Error("No audio data in " + file.name), { name: "NotAudioError" });
  const guess = parseFilename(file.name);
  const title = tags.title || guess.title || file.name;
  const artist = tags.artist || guess.artist || "Unknown artist";
  const cover = (tags.picture && (await downscaleImage(tags.picture))) || generateCover(`${artist}|${title}`);
  return {
    title,
    artist,
    album: tags.album || "",
    track: tags.track || 0,
    cover,
    duration,
    lyrics: tags.lyrics ? toLyrics(tags.lyrics, "file") : null,
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
    blob: audio,
  };
}

// Returns the updated playlist, or null if nothing was added.
export async function importFiles(playlist, files) {
  const audioFiles = [...files].filter(isAudioFile);
  const skippedType = files.length - audioFiles.length;
  if (!audioFiles.length) {
    toast(t("Those files aren't audio files."), { type: "error" });
    return null;
  }

  const progress = toast(t("Adding {i} of {n}…", { i: 1, n: audioFiles.length }), { duration: 0 });
  const known = await db.getAllSongs();
  let songIds = [...playlist.songIds];
  let added = 0;
  let duplicates = 0;
  let failed = 0;
  let empty = 0; // files that contain no playable audio
  let current = playlist;

  for (const [index, file] of audioFiles.entries()) {
    progress.update(t("Adding {i} of {n}…", { i: index + 1, n: audioFiles.length }));
    try {
      let song = known.find((s) => s.fileName === file.name && s.size === file.size);
      if (song && songIds.includes(song.id)) {
        duplicates++;
        continue;
      }
      const id = song ? song.id : await db.addSong(await buildSong(file));
      songIds = [...songIds, id];
      current = await db.setPlaylistSongs(playlist.id, songIds);
      added++;
    } catch (error) {
      if (error?.name === "NotAudioError") {
        empty++;
        continue;
      }
      failed++;
      if (error?.name === "QuotaExceededError") {
        toast(t("Not enough storage left to save this song."), { type: "error" });
        break;
      }
      console.error("Import failed for", file.name, error);
    }
  }

  progress.close();
  const notes = [
    duplicates && t("{n} skipped", { n: plural(duplicates, "duplicate") }),
    skippedType && t("{n} ignored", { n: plural(skippedType, "non-audio file") }),
    failed && t("{n} failed", { n: failed }),
    empty && t("{n} without playable audio", { n: empty }),
  ].filter(Boolean);
  if (added) {
    const songs = plural(added, "song");
    toast(notes.length ? t("Added {songs} ({notes})", { songs, notes: notes.join(t(", ")) }) : t("Added {songs}", { songs }), { type: "success" });
    navigator.storage?.persist?.(); // ask the browser not to evict the library
    loudness.kick(); // measure the new songs for volume normalisation (if it is on)
  } else if (notes.length) {
    toast(t("{text}.", { text: notes.join(t(", ")).replace(/^./, (c) => c.toLocaleUpperCase(document.documentElement.lang)) }), { type: failed || empty ? "error" : "info" });
  }
  return added ? current : null;
}

/* ----------------------------- Folder support ----------------------------- */

const readAllEntries = (reader) =>
  new Promise((resolve, reject) => {
    const entries = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(entries);
        entries.push(...batch);
        next();
      }, reject);
    next();
  });

async function walk(entry, path = "") {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    Object.defineProperty(file, "relativePath", { value: path + file.name });
    return [file];
  }
  const children = await readAllEntries(entry.createReader());
  return (await Promise.all(children.map((child) => walk(child, `${path}${entry.name}/`)))).flat();
}

// Files from a drop event, including everything inside dropped folders.
export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const nested = await Promise.all(entries.map((entry) => walk(entry)));
  return nested.flat();
}

// Natural file-name order ("2 song" before "10 song") for a folder import.
export const sortByPath = (files) =>
  [...files].sort((a, b) =>
    (a.webkitRelativePath || a.relativePath || a.name).localeCompare(b.webkitRelativePath || b.relativePath || b.name, undefined, { numeric: true })
  );

// Songs are only deleted once undo is no longer possible.
let gcTimer;
export function scheduleGc(onRemoved) {
  clearTimeout(gcTimer);
  gcTimer = setTimeout(async () => {
    const removed = await db.gcSongs();
    if (removed.length) {
      stats.forget(removed);
      onRemoved?.(removed);
    }
  }, 8000);
}
