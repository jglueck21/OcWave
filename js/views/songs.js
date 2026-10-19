// "All songs": every song in the library, sortable and filterable.
import * as db from "../db.js";
import { collator, t } from "../i18n.js";
import * as player from "../player.js";
import { fmtLong, icon, plural } from "../ui.js";
import { libraryTabs } from "./library.js";
import { mountSongList } from "./songlist.js";

const SORTS = {
  added: { label: "Recently added", compare: (a, b) => b.addedAt - a.addedAt },
  title: { label: "Title", compare: (a, b) => collator().compare(a.title, b.title) },
  artist: { label: "Artist", compare: (a, b) => collator().compare(a.artist, b.artist) || collator().compare(a.title, b.title) },
  duration: { label: "Duration", compare: (a, b) => b.duration - a.duration },
};

export async function render(view) {
  let all = await db.getAllSongs();
  let sort = "added";
  let query = "";

  const visible = () => {
    const q = query.trim().toLowerCase();
    return all
      .filter((s) => !q || `${s.title} ${s.artist} ${s.album || ""}`.toLowerCase().includes(q))
      .sort(SORTS[sort].compare);
  };

  view.innerHTML = `
    <header class="page-head">
      <div>
        <h1>${t("Your Library")}</h1>
        <p class="muted count"></p>
      </div>
      <div class="head-actions">
        ${libraryTabs("songs")}
      </div>
    </header>

    <div class="pl-actions songs-toolbar">
      <button class="btn btn-primary" data-act="play">${icon("play_arrow")} ${t("Play all")}</button>
      <button class="btn" data-act="shuffle">${icon("shuffle")} ${t("Shuffle")}</button>
      <label class="search grow">${icon("filter_list")}<input type="search" placeholder="${t("Filter songs")}" aria-label="${t("Filter songs")}"></label>
      <label class="select">${icon("sort")}
        <select aria-label="${t("Sort songs")}">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${t(s.label)}</option>`).join("")}</select>
      </label>
    </div>
    <div class="tracks" role="list"></div>
    <div class="empty-host"></div>`;

  const $ = (sel) => view.querySelector(sel);
  const source = () => ({ type: "songs", name: t("All songs") });
  const listApi = mountSongList($(".tracks"), {
    songs: visible,
    source,
    onChanged: async () => {
      all = await db.getAllSongs();
      refresh();
    },
  });

  function refresh() {
    const songs = visible();
    const total = all.reduce((sum, s) => sum + (s.duration || 0), 0);
    $(".count").textContent = `${plural(all.length, "song")}${total ? ` · ${fmtLong(total)}` : ""}`;
    $(".songs-toolbar").hidden = !all.length;
    $(".empty-host").innerHTML = songs.length
      ? ""
      : `<div class="empty-state"><div class="empty-art">${icon(all.length ? "search_off" : "music_off")}</div>
           <h2>${all.length ? t("No songs match") : t("No songs yet")}</h2>
           <p>${all.length ? t("Try a different filter.") : t("Open a playlist and add some audio files. They'll all show up here.")}</p>
           ${all.length ? "" : `<a class="btn btn-primary" href="#/library">${icon("library_music")} ${t("Go to playlists")}</a>`}</div>`;
    listApi.draw();
  }
  refresh();

  $("input[type=search]").addEventListener("input", (event) => {
    query = event.target.value;
    refresh();
  });
  $("select").addEventListener("change", (event) => {
    sort = event.target.value;
    refresh();
  });
  view.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    const songs = visible();
    if (act === "play" && songs.length) player.playQueue(songs.map((s) => s.id), { shuffle: false, source: source() });
    if (act === "shuffle" && songs.length) player.playQueue(songs.map((s) => s.id), { shuffle: true, source: source() });
  });

  return listApi.destroy;
}
