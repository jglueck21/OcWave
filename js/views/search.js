// Global search across playlists and songs.
import * as db from "../db.js";
import { t } from "../i18n.js";
import { esc, icon, plural } from "../ui.js";
import { coverOf } from "./library.js";
import { mountSongList } from "./songlist.js";

const normalize = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Every word of the query has to appear somewhere in the haystack.
const matches = (haystack, words) => words.every((word) => haystack.includes(word));

export async function render(view) {
  const [songs, playlists] = await Promise.all([db.getAllSongs(), db.getPlaylists()]);
  const index = songs.map((song) => ({ song, text: normalize(`${song.title} ${song.artist} ${song.album || ""}`) }));
  let results = [];
  let query = "";

  view.innerHTML = `
    <header class="page-head"><div><h1>${t("Search")}</h1><p class="muted">${t("{songs} and {playlists}", { songs: plural(songs.length, "song"), playlists: plural(playlists.length, "playlist") })}</p></div></header>
    <label class="search big">${icon("search")}<input type="search" placeholder="${t("Songs, artists, albums, playlists")}" aria-label="${t("Search")}" autocomplete="off"></label>
    <section class="result-section playlists-section" hidden>
      <h2 class="section-title">${t("Playlists")}</h2>
      <div class="chip-row"></div>
    </section>
    <section class="result-section songs-section" hidden>
      <h2 class="section-title">${t("Songs")}</h2>
      <div class="tracks" role="list"></div>
    </section>
    <div class="empty-host"></div>`;

  const $ = (sel) => view.querySelector(sel);
  const input = $("input");
  const listApi = mountSongList($(".tracks"), {
    songs: () => results,
    source: () => ({ type: "search", name: t("Search: {query}", { query: query.trim() }) }),
    onChanged: () => window.dispatchEvent(new HashChangeEvent("hashchange")), // re-render with fresh data
  });

  function run() {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const foundPlaylists = words.length ? playlists.filter((p) => matches(normalize(p.name), words)) : [];
    results = words.length ? index.filter((entry) => matches(entry.text, words)).slice(0, 200).map((entry) => entry.song) : [];

    $(".playlists-section").hidden = !foundPlaylists.length;
    $(".chip-row").innerHTML = foundPlaylists
      .map(
        (p) => `<a class="chip" href="#/playlist/${p.id}"><img src="${coverOf(p)}" alt=""><span><strong>${esc(p.name)}</strong><small>${plural(p.songIds.length, "song")}</small></span></a>`
      )
      .join("");
    $(".songs-section").hidden = !results.length;
    $(".songs-section .section-title").textContent = `${t("Songs")} · ${results.length}`;
    listApi.draw();

    $(".empty-host").innerHTML =
      words.length && !results.length && !foundPlaylists.length
        ? `<div class="empty-state compact"><div class="empty-art">${icon("search_off")}</div><h2>${t("No results")}</h2><p>${esc(t("Nothing matches \"{query}\".", { query: query.trim() }))}</p></div>`
        : !words.length
          ? `<div class="empty-state compact"><div class="empty-art">${icon("manage_search")}</div><h2>${t("Find anything")}</h2><p>${t("Type to search your whole library. Tip: press <kbd>/</kbd> from any page.")}</p></div>`
          : "";
  }

  let timer;
  input.addEventListener("input", () => {
    query = input.value;
    clearTimeout(timer);
    timer = setTimeout(run, 80);
  });
  run();
  input.focus();

  return () => {
    clearTimeout(timer);
    listApi.destroy();
  };
}
