import * as db from "../db.js";
import { t } from "../i18n.js";
import { importFiles, scheduleGc, sortByPath } from "../importer.js";
import { dominantColor, generateCover, isAudioFile } from "../meta.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { confirmDialog, esc, fmtLong, formDialog, icon, openMenu, plural, toast } from "../ui.js";

export const coverOf = (playlist) => playlist.cover || playlist.autoCover || generateCover(playlist.name + playlist.id);


// Tab switcher shared by the library pages.
export const libraryTabs = (active) => `
  <div class="seg lib-tabs" role="tablist" aria-label="${t("Library sections")}">
    ${[
      ["playlists", "#/library", "library_music", "Playlists"],
      ["songs", "#/songs", "music_note", "Songs"],
      ["albums", "#/albums", "album", "Albums"],
      ["artists", "#/artists", "person", "Artists"],
    ]
      .map(([id, href, ic, label]) => `<a class="seg-link ${id === active ? "active" : ""}" href="${href}" ${id === active ? 'aria-current="page"' : ""}>${icon(ic)}<span>${t(label)}</span></a>`)
      .join("")}
  </div>`;

export const COLLECTIONS = {
  liked: { title: "Liked Songs", icon: "favorite", empty: "Tap the heart on a song to add it here." },
  recent: { title: "Recently played", icon: "history", empty: "Songs you listen to will show up here." },
  top: { title: "Most played", icon: "trending_up", empty: "Your favourite songs will show up here once you've listened a bit." },
};

// The songs belonging to a collection, from the full song list.
export function collectionSongs(kind, songs) {
  return { liked: stats.favorites, recent: stats.recent, top: stats.mostPlayed }[kind](songs);
}

export const collectionTile = (kind, count, index = 0) => `
  <a class="tile coll" style="--i:${index}" href="#/collection/${kind}">
    <span class="coll-art ${kind}">${icon(COLLECTIONS[kind].icon)}</span>
    <div class="tile-text"><strong>${t(COLLECTIONS[kind].title)}</strong><small>${plural(count, "song")}</small></div>
  </a>`;

export const statsTile = (index = 0) => `
  <a class="tile coll" style="--i:${index}" href="#/stats">
    <span class="coll-art stats">${icon("insights")}</span>
    <div class="tile-text"><strong>${t("Listening stats")}</strong><small>${t("Your music in numbers")}</small></div>
  </a>`;

export async function createPlaylistFlow() {
  const result = await formDialog({
    title: t("New playlist"),
    fields: [{ name: "name", label: t("Name"), value: t("My playlist"), required: true }],
    submitText: t("Create"),
  });
  if (!result?.name) return null;
  const playlist = await db.createPlaylist(result.name);
  location.hash = `#/playlist/${playlist.id}`;
  return playlist;
}

export async function playPlaylist(playlist, { shuffle = false } = {}) {
  if (!playlist.songIds.length) return toast(t("This playlist is empty. Add some songs first."));
  await player.playQueue(playlist.songIds, { shuffle, source: { type: "playlist", id: playlist.id, name: playlist.name } });
}

// Gives each card/tile a glow in the color of its cover (used for the hover effect).
export function tintCards(root) {
  root.querySelectorAll("[data-id] img, [data-key] img").forEach(async (img) => {
    const color = await dominantColor(img.getAttribute("src"));
    img.closest("[data-id], [data-key]")?.style.setProperty("--glow", color.join(", "));
  });
}

export function playlistCard(playlist, index = 0) {
  return `
    <article class="card" style="--i:${Math.min(index, 14)}" tabindex="0" role="link" data-id="${playlist.id}" aria-label="${esc(playlist.name)}">
      <div class="card-cover">
        <img src="${coverOf(playlist)}" alt="" loading="lazy">
        <button class="fab" data-act="play" aria-label="${esc(t("Play {title}", { title: playlist.name }))}">${icon("play_arrow")}</button>
        <button class="card-more icon-btn" data-act="more" aria-label="${t("More options")}">${icon("more_horiz")}</button>
      </div>
      <h3>${esc(playlist.name)}</h3>
      <p>${plural(playlist.songIds.length, "song")}${playlist.duration ? ` · ${fmtLong(playlist.duration)}` : ""}</p>
    </article>`;
}

export async function render(view) {
  let playlists = await db.getPlaylists();
  let query = "";

  const draw = () => {
    const visible = playlists
      .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    view.querySelector(".grid-host").innerHTML = visible.length
      ? `<div class="grid">${visible.map((p, i) => playlistCard(p, i)).join("")}</div>`
      : `<div class="empty-state">
           <div class="empty-art">${icon(query ? "search_off" : "library_music")}</div>
           <h2>${query ? t("No playlists found") : t("Your library is empty")}</h2>
           <p>${query ? t("Try a different search.") : t("Create a playlist, then drop your music files into it.")}</p>
           ${query ? "" : `<button class="btn btn-primary" data-act="new">${icon("add")} ${t("Create playlist")}</button>`}
         </div>`;
    tintCards(view.querySelector(".grid-host"));
  };

  view.innerHTML = `
    <header class="page-head">
      <div><h1>${t("Your Library")}</h1><p class="muted">${plural(playlists.length, "playlist")}</p></div>
      <div class="head-actions">
        ${libraryTabs("playlists")}
      </div>
    </header>
    <div class="collections" aria-label="${t("Collections")}"></div>
    <div class="pl-actions library-toolbar">
      <label class="search grow">${icon("search")}<input type="search" placeholder="${t("Search playlists")}" aria-label="${t("Search playlists")}"></label>
      <button class="btn" data-act="folder" title="${t("Create a playlist from a folder of music")}">${icon("folder_open")}<span>${t("Import folder")}</span></button>
      <button class="btn btn-primary" data-act="new">${icon("add")}<span>${t("New playlist")}</span></button>
      <input type="file" id="folder-input" webkitdirectory multiple hidden>
    </div>
    <div class="grid-host"></div>`;
  draw();

  // Smart collections (liked, recent, most played) are built from the song statistics.
  db.getAllSongs().then((songs) => {
    view.querySelector(".collections").innerHTML = ["liked", "recent", "top"]
      .map((kind, i) => collectionTile(kind, collectionSongs(kind, songs).length, i))
      .concat(statsTile(3))
      .join("");
  });

  // A folder becomes a playlist named after it.
  view.querySelector("#folder-input").addEventListener("change", async (event) => {
    const files = sortByPath([...event.target.files].filter(isAudioFile));
    event.target.value = "";
    if (!files.length) return toast(t("No audio files found in that folder."), { type: "error" });
    const name = files[0].webkitRelativePath.split("/")[0] || t("Imported folder");
    const playlist = await db.createPlaylist(name);
    await importFiles(playlist, files);
    location.hash = `#/playlist/${playlist.id}`;
  });

  view.querySelector("input[type=search]").addEventListener("input", (event) => {
    query = event.target.value;
    draw();
  });

  const openCardMenu = (card, anchor) => {
    const playlist = playlists.find((p) => p.id === Number(card.dataset.id));
    openMenu(anchor, [
      { label: t("Play"), icon: "play_arrow", onClick: () => playPlaylist(playlist) },
      { label: t("Shuffle"), icon: "shuffle", onClick: () => playPlaylist(playlist, { shuffle: true }) },
      { label: t("Rename"), icon: "edit", onClick: () => rename(playlist) },
      "sep",
      { label: t("Delete"), icon: "delete", danger: true, onClick: () => remove(playlist) },
    ]);
  };

  async function rename(playlist) {
    const result = await formDialog({
      title: t("Rename playlist"),
      fields: [{ name: "name", label: t("Name"), value: playlist.name, required: true }],
    });
    if (!result?.name) return;
    await db.updatePlaylist(playlist.id, { name: result.name });
    playlists = await db.getPlaylists();
    draw();
  }

  async function remove(playlist) {
    const ok = await confirmDialog({
      title: t("Delete \"{name}\"?", { name: playlist.name }),
      message: t("The playlist and its songs will be removed from this device. This can't be undone."),
      submitText: t("Delete"),
      danger: true,
    });
    if (!ok) return;
    await db.deletePlaylist(playlist.id);
    scheduleGc((removed) => player.purge(removed));
    playlists = await db.getPlaylists();
    view.querySelector(".muted").textContent = plural(playlists.length, "playlist");
    draw();
    toast(t("Playlist deleted."));
  }

  view.addEventListener("click", async (event) => {
    const act = event.target.closest("[data-act]");
    const card = event.target.closest(".card");
    if (act?.dataset.act === "new") return createPlaylistFlow();
    if (act?.dataset.act === "folder") return view.querySelector("#folder-input").click();
    if (!card) return;
    const playlist = playlists.find((p) => p.id === Number(card.dataset.id));
    if (act?.dataset.act === "play") return playPlaylist(playlist);
    if (act?.dataset.act === "more") return openCardMenu(card, act);
    location.hash = `#/playlist/${playlist.id}`;
  });
  view.addEventListener("keydown", (event) => {
    const card = event.target.closest?.(".card");
    if (card && event.target === card && event.key === "Enter") location.hash = `#/playlist/${card.dataset.id}`;
  });
}
