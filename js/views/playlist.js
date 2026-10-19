import * as db from "../db.js";
import { t } from "../i18n.js";
import { filesFromDrop, importFiles, scheduleGc, sortByPath } from "../importer.js";
import { downscaleImage } from "../meta.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { collator } from "../i18n.js";
import { confirmDialog, displayArtist, esc, eqBars, fmtLong, fmtTime, formDialog, icon, listDialog, openMenu, plural, storeArtist, toast } from "../ui.js";
import { coverOf, playPlaylist } from "./library.js";
import { makeReorderable } from "./reorder.js";
import { createSelection } from "./selection.js";
import { addToPlaylistFlow, commonBulkActions, coverMenuItems, likeButton, syncLikes } from "./songlist.js";

export async function render(view, { id }) {
  let playlist = await db.getPlaylist(Number(id));
  if (!playlist) {
    view.innerHTML = `
      <div class="empty-state">
        <div class="empty-art">${icon("search_off")}</div>
        <h2>${t("Playlist not found")}</h2>
        <p>${t("It may have been deleted.")}</p>
        <a class="btn btn-primary" href="#/library">${icon("arrow_back")} ${t("Back to library")}</a>
      </div>`;
    return;
  }
  let songs = await db.getSongsByIds(playlist.songIds);
  const source = () => ({ type: "playlist", id: playlist.id, name: playlist.name });

  view.innerHTML = `
    <a class="back-link" href="#/library">${icon("arrow_back")} ${t("Library")}</a>
    <header class="pl-head">
      <div class="pl-backdrop"></div>
      <button class="pl-cover" data-act="cover" aria-label="${t("Change cover image")}">
        <img alt="">
        <span class="pl-cover-edit">${icon("photo_camera")}<small>${t("Change cover")}</small></span>
      </button>
      <div class="pl-info">
        <span class="eyebrow">${t("Playlist")}</span>
        <h1 class="pl-title" data-act="rename" tabindex="0" role="button" title="${t("Rename playlist")}"></h1>
        <p class="muted pl-meta"></p>
      </div>
    </header>
    <div class="pl-actions">
      <button class="btn btn-primary" data-act="play">${icon("play_arrow")} ${t("Play")}</button>
      <button class="btn" data-act="shuffle">${icon("shuffle")} ${t("Shuffle")}</button>
      <button class="btn" data-act="add">${icon("add")} ${t("Add songs")}</button>
      <button class="icon-btn" data-act="select" aria-label="${t("Select songs")}" title="${t("Select songs")}">${icon("checklist")}</button>
      <button class="icon-btn" data-act="more" aria-label="${t("Playlist options")}">${icon("more_horiz")}</button>
      <input type="file" id="file-input" accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus" multiple hidden>
      <input type="file" id="cover-input" accept="image/*" hidden>
      <input type="file" id="folder-input" webkitdirectory multiple hidden>
    </div>
    <div class="tracks" role="list"></div>
    <div class="drop-overlay"><div>${icon("upload_file")}<strong>${t("Drop to add songs")}</strong><span>${t("to this playlist")}</span></div></div>`;

  const $ = (sel) => view.querySelector(sel);

  /* ------------------------------- Rendering ------------------------------- */

  function drawHeader() {
    const cover = coverOf(playlist);
    $(".pl-cover img").src = cover;
    $(".pl-backdrop").style.backgroundImage = `url("${cover}")`;
    $(".pl-title").textContent = playlist.name;
    $(".pl-meta").textContent = `${plural(songs.length, "song")}${playlist.duration ? ` · ${fmtLong(playlist.duration)}` : ""}`;
    document.title = `${playlist.name} · OcWave`;
  }

  function trackRow(song, index) {
    return `
      <div class="track reorderable" role="listitem" data-id="${song.id}" data-index="${index}">
        <span class="t-grip" title="${esc(t("Drag to reorder"))}" aria-hidden="true">${icon("drag_indicator")}</span>
        <span class="t-num"><b>${index + 1}</b>${eqBars()}<button class="t-play" aria-label="${esc(t("Play {title}", { title: song.title }))}" tabindex="-1">${icon("play_arrow")}</button></span>
        <div class="t-main">
          <img class="t-cover" src="${song.cover}" alt="" loading="lazy">
          <div><div class="t-title">${esc(song.title)}</div><div class="t-artist">${esc(displayArtist(song.artist))}</div></div>
        </div>
        ${likeButton(song)}
        <span class="t-dur">${fmtTime(song.duration)}</span>
        <button class="icon-btn t-more" data-act="song-more" aria-label="${esc(t("Options for {title}", { title: song.title }))}">${icon("more_horiz")}</button>
      </div>`;
  }

  function drawTracks() {
    $(".tracks").innerHTML = songs.length
      ? songs.map(trackRow).join("")
      : `<div class="empty-state compact">
           <div class="empty-art">${icon("upload_file")}</div>
           <h2>${t("No songs yet")}</h2>
           <p>${t("Drag audio files here or choose them from your computer.")}</p>
           <button class="btn btn-primary" data-act="add">${icon("add")} ${t("Add songs")}</button>
         </div>`;
    markCurrent(player.state);
    selection.sync();
  }

  function markCurrent(state) {
    const inThisList = state.source?.type === "playlist" && state.source.id === playlist.id;
    view.querySelectorAll(".track").forEach((row) => {
      const current = inThisList && state.song && Number(row.dataset.id) === state.song.id;
      row.classList.toggle("current", !!current);
      row.classList.toggle("is-playing", !!current && state.playing);
    });
  }

  const selection = createSelection({
    host: $(".tracks"),
    getSongs: () => songs,
    bulkActions: (picked) =>
      commonBulkActions(picked, [{ label: t("Remove"), icon: "remove_circle", danger: true, run: (list) => removeSongs(list) }]),
  });
  const redraw = () => (drawHeader(), drawTracks());
  redraw();
  const stopListening = player.subscribe(markCurrent);
  const stopStats = stats.subscribe(() => syncLikes(view));

  /* -------------------------------- Actions -------------------------------- */

  async function save(songIds) {
    playlist = await db.setPlaylistSongs(playlist.id, songIds);
    songs = await db.getSongsByIds(playlist.songIds);
    redraw();
  }

  async function rename() {
    const result = await formDialog({
      title: t("Rename playlist"),
      fields: [{ name: "name", label: t("Name"), value: playlist.name, required: true }],
    });
    if (!result?.name) return;
    playlist = await db.updatePlaylist(playlist.id, { name: result.name });
    drawHeader();
  }

  async function removeSongs(list) {
    const before = [...playlist.songIds];
    const gone = new Set(list.map((song) => song.id));
    await save(before.filter((songId) => !gone.has(songId)));
    scheduleGc((removed) => player.purge(removed));
    toast(list.length === 1 ? t("Removed \"{title}\"", { title: list[0].title }) : t("Removed {songs}", { songs: plural(list.length, "song") }), {
      duration: 6000,
      action: { label: t("Undo"), onClick: () => save(before) },
    });
  }
  const removeSong = (song) => removeSongs([song]);

  // Moves one song to a new position and saves the order.
  async function moveSong(from, to) {
    if (from === to || to < 0 || to >= songs.length) return;
    const ids = songs.map((song) => song.id); // the order as shown
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    await save(ids);
  }

  const SORTS = {
    title: { label: "Title", icon: "sort_by_alpha", compare: (a, b) => collator().compare(a.title, b.title) },
    artist: { label: "Artist", icon: "person", compare: (a, b) => collator().compare(displayArtist(a.artist), displayArtist(b.artist)) || collator().compare(a.title, b.title) },
    album: { label: "Album", icon: "album", compare: (a, b) => collator().compare(a.album || "", b.album || "") || (a.track || 0) - (b.track || 0) },
    duration: { label: "Duration", icon: "timer", compare: (a, b) => a.duration - b.duration },
    added: { label: "Recently added", icon: "schedule", compare: (a, b) => b.addedAt - a.addedAt },
  };

  // Re-orders the whole playlist; "Undo" brings the old order back.
  async function sortFlow() {
    const choice = await listDialog({
      title: t("Sort playlist by…"),
      items: [...Object.entries(SORTS).map(([id, s]) => ({ id, label: t(s.label), icon: s.icon })), { id: "reverse", label: t("Reverse order"), icon: "swap_vert" }],
    });
    if (choice === null) return;
    const before = [...playlist.songIds];
    const ordered = choice === "reverse" ? [...songs].reverse() : [...songs].sort(SORTS[choice].compare);
    const ids = ordered.map((song) => song.id);
    if (ids.every((id, i) => id === before[i])) return toast(t("Already in that order."), { duration: 1800 });
    await save(ids);
    toast(t("Playlist sorted."), { duration: 6000, action: { label: t("Undo"), onClick: () => save(before) } });
  }

  async function editSong(song) {
    const result = await formDialog({
      title: t("Edit song"),
      fields: [
        { name: "title", label: t("Title"), value: song.title, required: true },
        { name: "artist", label: t("Artist"), value: displayArtist(song.artist) },
      ],
    });
    if (!result) return;
    const updated = await db.updateSong(song.id, {
      title: result.title,
      artist: storeArtist(result.artist),
      lyrics: song.lyrics?.none ? null : song.lyrics, // corrected details deserve a fresh lyrics search
    });
    player.refreshSong(updated);
    songs = songs.map((s) => (s.id === updated.id ? updated : s));
    drawTracks();
  }

  async function deletePlaylist() {
    const ok = await confirmDialog({
      title: t("Delete \"{name}\"?", { name: playlist.name }),
      message: t("The playlist and its songs will be removed from this device. This can't be undone."),
      submitText: t("Delete"),
      danger: true,
    });
    if (!ok) return;
    await db.deletePlaylist(playlist.id);
    scheduleGc((removed) => player.purge(removed));
    toast(t("Playlist deleted."));
    location.hash = "#/library";
  }

  async function addFiles(files) {
    if (!files.length) return;
    const updated = await importFiles(playlist, files);
    if (!updated) return;
    playlist = updated;
    songs = await db.getSongsByIds(playlist.songIds);
    redraw();
  }

  async function changeCover(file) {
    if (!file?.type.startsWith("image/")) return toast(t("Please choose an image file."), { type: "error" });
    const cover = await downscaleImage(file, 600);
    if (!cover) return toast(t("That image couldn't be read."), { type: "error" });
    playlist = await db.updatePlaylist(playlist.id, { cover });
    drawHeader();
    toast(t("Cover updated."), { type: "success" });
  }

  /* -------------------------------- Events -------------------------------- */

  view.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    const row = event.target.closest(".track");
    const song = row && songs.find((s) => s.id === Number(row.dataset.id));

    if (selection.handleClick(event)) return;
    if (act === "select") return selection.enter();
    if (act === "play") return playPlaylist(playlist);
    if (act === "shuffle") return playPlaylist(playlist, { shuffle: true });
    if (act === "add") return $("#file-input").click();
    if (act === "cover") return $("#cover-input").click();
    if (act === "rename") return rename();
    if (act === "more") {
      return openMenu(event.target.closest("[data-act]"), [
        { label: t("Add folder…"), icon: "folder_open", onClick: () => $("#folder-input").click() },
        { label: t("Sort by…"), icon: "sort", onClick: sortFlow },
        { label: t("Select songs"), icon: "checklist", onClick: () => selection.enter() },
        { label: t("Rename"), icon: "edit", onClick: rename },
        { label: t("Change cover"), icon: "photo_camera", onClick: () => $("#cover-input").click() },
        "sep",
        { label: t("Delete playlist"), icon: "delete", danger: true, onClick: deletePlaylist },
      ]);
    }
    if (act === "like" && song) return stats.toggleFavorite(song.id);
    if (act === "song-more" && song) {
      return openMenu(event.target.closest("[data-act]"), [
        { label: t("Play"), icon: "play_arrow", onClick: () => player.playQueue(playlist.songIds, { start: songs.indexOf(song), source: source() }) },
        { label: t("Play next"), icon: "playlist_play", onClick: () => (player.enqueue([song.id], { next: true }), toast(t("Playing next."), { duration: 1800 })) },
        { label: t("Add to queue"), icon: "queue_music", onClick: () => (player.enqueue([song.id]), toast(t("Added to queue."), { duration: 1800 })) },
        { label: t("Add to another playlist…"), icon: "playlist_add", onClick: () => addToPlaylistFlow([song.id]) },
        { label: t("Select"), icon: "checklist", onClick: () => selection.enter(song.id) },
        ...(songs.indexOf(song) > 0 ? [{ label: t("Move up"), icon: "arrow_upward", onClick: () => moveSong(songs.indexOf(song), songs.indexOf(song) - 1) }] : []),
        ...(songs.indexOf(song) < songs.length - 1 ? [{ label: t("Move down"), icon: "arrow_downward", onClick: () => moveSong(songs.indexOf(song), songs.indexOf(song) + 1) }] : []),
        { label: t("Edit details"), icon: "edit", onClick: () => editSong(song) },
        ...coverMenuItems(song, (updated) => {
          songs = songs.map((s) => (s.id === updated.id ? updated : s));
          drawTracks();
        }),
        "sep",
        { label: t("Remove from playlist"), icon: "remove_circle", danger: true, onClick: () => removeSong(song) },
      ]);
    }
    if (song) {
      const isCurrent = row.classList.contains("current");
      if (isCurrent) player.togglePlay();
      else player.playQueue(playlist.songIds, { start: songs.indexOf(song), source: source() });
    }
  });
  view.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches(".pl-title")) rename();
  });
  $("#file-input").addEventListener("change", (event) => {
    addFiles(event.target.files);
    event.target.value = "";
  });
  $("#folder-input").addEventListener("change", (event) => {
    addFiles(sortByPath(event.target.files));
    event.target.value = "";
  });
  $("#cover-input").addEventListener("change", (event) => {
    changeCover(event.target.files[0]);
    event.target.value = "";
  });

  /* ------------------------- Drag & drop (files + reorder) ------------------------- */

  const overlay = $(".drop-overlay");
  const hasFiles = (event) => event.dataTransfer?.types.includes("Files");
  let depth = 0;
  const onDragEnter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    overlay.classList.add("show");
  };
  const onDragLeave = (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove("show");
  };
  const onDragOver = (event) => hasFiles(event) && event.preventDefault();
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.classList.remove("show");
    filesFromDrop(event.dataTransfer).then((files) => addFiles(sortByPath(files))); // folders are expanded
  };
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);

  makeReorderable($(".tracks"), {
    itemSelector: ".track",
    handleSelector: ".t-grip",
    onMove: (from, to) => moveSong(from, to),
  });

  return () => {
    stopListening();
    stopStats();
    selection.destroy();
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  };
}
