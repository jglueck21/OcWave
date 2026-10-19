// A song list with the shared actions (play, queue, add to playlist, edit, delete) used by the
// "All songs" and "Search" views.
import * as db from "../db.js";
import { t } from "../i18n.js";
import { downscaleImage, generateCover } from "../meta.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { createSelection } from "./selection.js";
import { confirmDialog, displayArtist, esc, eqBars, fmtTime, formDialog, icon, listDialog, openMenu, plural, storeArtist, toast } from "../ui.js";

// Heart button shared by every song row.
export const likeButton = (song) =>
  `<button class="icon-btn t-like ${stats.isFavorite(song.id) ? "on" : ""}" data-act="like" aria-pressed="${stats.isFavorite(song.id)}" aria-label="${esc(t("Like {title}", { title: song.title }))}">${icon("favorite")}</button>`;

// Updates all hearts below `root` after the liked state of some song changed.
export function syncLikes(root) {
  root.querySelectorAll(".track").forEach((row) => {
    const liked = stats.isFavorite(Number(row.dataset.id));
    const button = row.querySelector(".t-like");
    button?.classList.toggle("on", liked);
    button?.setAttribute("aria-pressed", liked);
  });
}

function rowHtml(song, index) {
  return `
    <div class="track" role="listitem" data-id="${song.id}" data-index="${index}">
      <span class="t-num"><b>${index + 1}</b>${eqBars()}<button class="t-play" aria-label="${esc(t("Play {title}", { title: song.title }))}" tabindex="-1">${icon("play_arrow")}</button></span>
      <div class="t-main">
        <img class="t-cover" src="${song.cover}" alt="" loading="lazy">
        <div><div class="t-title">${esc(song.title)}</div><div class="t-artist">${esc(displayArtist(song.artist))}${song.album ? ` · ${esc(song.album)}` : ""}</div></div>
      </div>
      ${likeButton(song)}
      <span class="t-dur">${fmtTime(song.duration)}</span>
      <button class="icon-btn t-more" data-act="song-more" aria-label="${esc(t("Options for {title}", { title: song.title }))}">${icon("more_horiz")}</button>
    </div>`;
}

// Lets the user pick an image file. Resolves null when the dialog is dismissed.
function pickImage() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

// Replaces a song's cover with a picked image, or with the generated artwork when `reset` is set.
// Resolves the updated song, or null if nothing changed.
export async function changeCover(song, { reset = false } = {}) {
  let cover;
  if (reset) {
    cover = generateCover(`${song.artist}|${song.title}`);
  } else {
    const file = await pickImage();
    if (!file) return null;
    cover = await downscaleImage(file, 600);
    if (!cover) return toast(t("That image couldn't be read."), { type: "error" }), null;
  }
  const updated = await db.updateSong(song.id, { cover });
  player.refreshSong(updated);
  toast(reset ? t("Cover removed.") : t("Cover updated."), { type: "success", duration: 2000 });
  return updated;
}

// Bulk actions shared by every song list's selection bar. `extra` adds list-specific ones (delete, remove…).
export const commonBulkActions = (songs, extra = []) => {
  const ids = songs.map((song) => song.id);
  const allLiked = songs.length > 0 && songs.every((song) => stats.isFavorite(song.id));
  return [
    { label: t("Play next"), icon: "playlist_play", run: () => (player.enqueue(ids, { next: true }), toast(t("Playing next."), { duration: 1800 })) },
    { label: t("Add to queue"), icon: "queue_music", run: () => (player.enqueue(ids), toast(t("Added to queue."), { duration: 1800 })) },
    { label: t("Add to playlist…"), icon: "playlist_add", run: () => addToPlaylistFlow(ids) },
    { label: allLiked ? t("Unlike") : t("Like"), icon: "favorite", run: () => Promise.all(ids.map((id) => stats.setFavorite(id, !allLiked))) },
    ...extra,
  ];
};

// Menu entries shared by every song menu.
export const coverMenuItems = (song, done) => [
  { label: t("Change cover…"), icon: "photo_camera", onClick: async () => { const updated = await changeCover(song); if (updated) done(updated); } },
  { label: t("Remove cover"), icon: "hide_image", onClick: async () => { const updated = await changeCover(song, { reset: true }); if (updated) done(updated); } },
];

export async function addToPlaylistFlow(songIds) {
  const playlists = (await db.getPlaylists()).sort((a, b) => b.updatedAt - a.updatedAt);
  const choice = await listDialog({
    title: songIds.length > 1 ? t("Add {songs} to…", { songs: plural(songIds.length, "song") }) : t("Add to playlist"),
    items: [
      { id: "new", label: t("New playlist…"), icon: "add" },
      ...playlists.map((p) => ({ id: p.id, label: p.name, sub: plural(p.songIds.length, "song") })),
    ],
  });
  if (choice === null) return;

  let target = playlists.find((p) => p.id === choice);
  if (choice === "new") {
    const result = await formDialog({
      title: t("New playlist"),
      fields: [{ name: "name", label: t("Name"), value: t("My playlist"), required: true }],
      submitText: t("Create"),
    });
    if (!result?.name) return;
    target = await db.createPlaylist(result.name);
  }
  let added = 0;
  for (const id of songIds) if (await db.addSongToPlaylist(target.id, id)) added++;
  toast(added ? t("Added {songs} to \"{name}\"", { songs: plural(added, "song"), name: target.name }) : t("Already in \"{name}\"", { name: target.name }), { type: added ? "success" : "info" });
}

/**
 * Renders `songs()` into `host` and wires up clicks and menus.
 * options.source() describes where the queue comes from; options.onChanged() is called after edits/deletes.
 */
export function mountSongList(host, { songs, source, onChanged }) {
  const list = () => songs();

  function draw() {
    const items = list();
    host.innerHTML = items.length ? items.map(rowHtml).join("") : "";
    mark(player.state);
    selection.sync();
  }

  function mark(state) {
    host.querySelectorAll(".track").forEach((row) => {
      const current = state.song && Number(row.dataset.id) === state.song.id;
      row.classList.toggle("current", !!current);
      row.classList.toggle("is-playing", !!current && state.playing);
    });
  }

  const selection = createSelection({
    host,
    getSongs: list,
    bulkActions: (picked) => commonBulkActions(picked, [{ label: t("Delete"), icon: "delete", danger: true, run: (songs) => deleteSongs(songs) }]),
  });

  const ids = () => list().map((song) => song.id);
  const play = (index) => player.playQueue(ids(), { start: index, source: source() });

  async function editSong(song) {
    const result = await formDialog({
      title: t("Edit song"),
      fields: [
        { name: "title", label: t("Title"), value: song.title, required: true },
        { name: "artist", label: t("Artist"), value: displayArtist(song.artist) },
        { name: "album", label: t("Album"), value: song.album || "" },
      ],
    });
    if (!result) return;
    const updated = await db.updateSong(song.id, {
      title: result.title,
      artist: storeArtist(result.artist),
      album: result.album,
      lyrics: song.lyrics?.none ? null : song.lyrics, // corrected details deserve a fresh lyrics search
    });
    player.refreshSong(updated);
    onChanged?.(updated);
  }

  async function deleteSongs(songs) {
    if (songs.length === 1) return deleteSong(songs[0]);
    const ok = await confirmDialog({
      title: t("Delete {songs}?", { songs: plural(songs.length, "song") }),
      message: t("The songs are removed from every playlist and from this device. This can't be undone."),
      submitText: t("Delete"),
      danger: true,
    });
    if (!ok) return false;
    const ids = songs.map((song) => song.id);
    await db.deleteSongsEverywhere(ids);
    stats.forget(ids);
    player.purge(ids);
    toast(t("Songs deleted."));
    onChanged?.();
  }

  async function deleteSong(song) {
    const ok = await confirmDialog({
      title: t("Delete \"{title}\"?", { title: song.title }),
      message: t("The song is removed from every playlist and from this device. This can't be undone."),
      submitText: t("Delete"),
      danger: true,
    });
    if (!ok) return;
    await db.deleteSongsEverywhere([song.id]);
    stats.forget([song.id]);
    player.purge([song.id]);
    toast(t("Song deleted."));
    onChanged?.();
  }

  host.addEventListener("click", (event) => {
    const row = event.target.closest(".track");
    if (!row) return;
    const index = Number(row.dataset.index);
    const song = list()[index];
    if (selection.handleClick(event)) return;
    if (event.target.closest("[data-act=like]")) return stats.toggleFavorite(song.id);
    if (event.target.closest("[data-act=song-more]")) {
      return openMenu(event.target.closest("[data-act]"), [
        { label: t("Play"), icon: "play_arrow", onClick: () => play(index) },
        { label: t("Play next"), icon: "playlist_play", onClick: () => (player.enqueue([song.id], { next: true }), toast(t("Playing next."), { duration: 1800 })) },
        { label: t("Add to queue"), icon: "queue_music", onClick: () => (player.enqueue([song.id]), toast(t("Added to queue."), { duration: 1800 })) },
        { label: t("Add to playlist…"), icon: "playlist_add", onClick: () => addToPlaylistFlow([song.id]) },
        { label: t("Select"), icon: "checklist", onClick: () => selection.enter(song.id) },
        "sep",
        { label: t("Edit details"), icon: "edit", onClick: () => editSong(song) },
        ...coverMenuItems(song, (updated) => onChanged?.(updated)),
        "sep",
        { label: t("Delete from library"), icon: "delete", danger: true, onClick: () => deleteSong(song) },
      ]);
    }
    if (row.classList.contains("current")) player.togglePlay();
    else play(index);
  });

  const stopPlayer = player.subscribe(mark);
  const stopStats = stats.subscribe(() => syncLikes(host));
  draw();
  return { draw, destroy: () => (stopPlayer(), stopStats(), selection.destroy()) };
}
