// Browse the library by album and by artist: grids and detail pages.
import * as db from "../db.js";
import { collator as makeCollator, t } from "../i18n.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { displayArtist, esc, fmtLong, icon, plural } from "../ui.js";
import { libraryTabs, tintCards } from "./library.js";
import { mountSongList } from "./songlist.js";

const collator = { compare: (a, b) => makeCollator().compare(a, b) };
const norm = (text) => String(text ?? "").trim().toLowerCase();
const byTrack = (a, b) => (a.track || 9999) - (b.track || 9999) || collator.compare(a.title, b.title);
const sumDuration = (songs) => songs.reduce((total, song) => total + (song.duration || 0), 0);
const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

// Albums without a tag are called "Singles" internally; show that in the user's language.
const albumName = (album) => (album.single ? t("Singles") : album.name);

/* ------------------------------- Grouping ------------------------------- */

// Songs without an album tag are gathered per artist under "Singles".
export function groupAlbums(songs) {
  const albums = new Map();
  for (const song of songs) {
    const artist = (song.artist || "Unknown artist").trim();
    const name = (song.album || "").trim();
    const key = `${norm(name)}||${norm(artist)}`;
    if (!albums.has(key)) albums.set(key, { key, name: name || "Singles", single: !name, artist, songs: [] });
    albums.get(key).songs.push(song);
  }
  for (const album of albums.values()) {
    album.songs.sort(byTrack);
    album.cover = album.songs[0].cover;
    album.duration = sumDuration(album.songs);
  }
  return albums;
}

export function groupArtists(songs) {
  const artists = new Map();
  for (const song of songs) {
    const name = (song.artist || "Unknown artist").trim();
    const key = norm(name);
    if (!artists.has(key)) artists.set(key, { key, name, songs: [] });
    artists.get(key).songs.push(song);
  }
  for (const artist of artists.values()) {
    artist.cover = artist.songs[0].cover;
    artist.albumCount = [...groupAlbums(artist.songs).values()].filter((album) => !album.single).length; // "Singles" isn't a real album
  }
  return artists;
}

/* ------------------------------ Shared pieces ------------------------------ */

const albumCard = (album, index = 0) => `
  <article class="card" style="--i:${Math.min(index, 14)}" tabindex="0" role="link" data-key="${esc(album.key)}" aria-label="${esc(albumName(album))}">
    <div class="card-cover">
      <img src="${album.cover}" alt="" loading="lazy">
      <button class="fab" data-act="play" aria-label="${esc(t("Play {title}", { title: albumName(album) }))}">${icon("play_arrow")}</button>
    </div>
    <h3>${esc(albumName(album))}</h3>
    <p>${esc(displayArtist(album.artist))} · ${plural(album.songs.length, "song")}</p>
  </article>`;

const artistCard = (artist, index = 0) => `
  <article class="card artist" style="--i:${Math.min(index, 14)}" tabindex="0" role="link" data-key="${esc(artist.key)}" aria-label="${esc(displayArtist(artist.name))}">
    <div class="card-cover">
      <img src="${artist.cover}" alt="" loading="lazy">
      <button class="fab" data-act="play" aria-label="${esc(t("Play {title}", { title: displayArtist(artist.name) }))}">${icon("play_arrow")}</button>
    </div>
    <h3>${esc(displayArtist(artist.name))}</h3>
    <p>${plural(artist.songs.length, "song")}${artist.albumCount ? ` · ${plural(artist.albumCount, "album")}` : ""}</p>
  </article>`;

// Big header with cover, used by album, artist and collection pages.
export function detailHeader({ back, eyebrow, title, meta, cover, coverHtml, round = false }) {
  return `
    <a class="back-link" href="${back.href}">${icon("arrow_back")} ${back.label}</a>
    <header class="pl-head ${round ? "round" : ""}">
      <div class="pl-backdrop" ${cover ? `style="background-image:url('${cover}')"` : ""}></div>
      <div class="pl-cover static">${coverHtml || `<img src="${cover}" alt="">`}</div>
      <div class="pl-info">
        <span class="eyebrow">${esc(eyebrow)}</span>
        <h1 class="pl-title static">${esc(title)}</h1>
        <p class="muted pl-meta">${esc(meta)}</p>
      </div>
    </header>
    <div class="pl-actions">
      <button class="btn btn-primary" data-act="play">${icon("play_arrow")} ${t("Play")}</button>
      <button class="btn" data-act="shuffle">${icon("shuffle")} ${t("Shuffle")}</button>
    </div>`;
}

export function notFound(view, label, href) {
  view.innerHTML = `
    <div class="empty-state">
      <div class="empty-art">${icon("search_off")}</div>
      <h2>${t("Not found")}</h2>
      <p>${t("It may have been removed from your library.")}</p>
      <a class="btn btn-primary" href="${href}">${icon("arrow_back")} ${label}</a>
    </div>`;
}

// Wires Play / Shuffle buttons and the song list of a detail page. `getSongs` returns the songs in play order.
export function mountDetail(view, { getSongs, source, onChanged = rerender }) {
  const list = mountSongList(view.querySelector(".tracks"), { songs: getSongs, source, onChanged });
  const onClick = (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    const songs = getSongs();
    if (!songs.length || (act !== "play" && act !== "shuffle")) return;
    player.playQueue(songs.map((s) => s.id), { shuffle: act === "shuffle", source: source() });
  };
  view.addEventListener("click", onClick);
  return () => {
    list.destroy();
    view.removeEventListener("click", onClick);
  };
}

function gridPage(view, { tab, title, count, items, card, placeholder, emptyText, onOpen }) {
  let query = "";
  view.innerHTML = `
    <header class="page-head">
      <div><h1>${t("Your Library")}</h1><p class="muted">${count}</p></div>
      <div class="head-actions">${libraryTabs(tab)}</div>
    </header>
    <div class="pl-actions library-toolbar">
      <label class="search grow">${icon("search")}<input type="search" placeholder="${t(placeholder)}" aria-label="${t(placeholder)}"></label>
    </div>
    <div class="grid-host"></div>`;

  const host = view.querySelector(".grid-host");
  const draw = () => {
    const visible = items.filter((item) => `${item.name} ${item.artist || ""}`.toLowerCase().includes(query.toLowerCase()));
    host.innerHTML = visible.length
      ? `<div class="grid">${visible.map((item, i) => card(item, i)).join("")}</div>`
      : `<div class="empty-state"><div class="empty-art">${icon(query ? "search_off" : title.icon)}</div>
           <h2>${query ? t("Nothing found") : t(title.empty)}</h2><p>${query ? t("Try a different search.") : t(emptyText)}</p></div>`;
    tintCards(host);
  };
  draw();

  view.querySelector("input[type=search]").addEventListener("input", (event) => {
    query = event.target.value;
    draw();
  });
  host.addEventListener("click", (event) => {
    const cardEl = event.target.closest(".card");
    if (!cardEl) return;
    const item = items.find((i) => i.key === cardEl.dataset.key);
    if (event.target.closest("[data-act=play]")) {
      return player.playQueue(item.songs.map((s) => s.id), { shuffle: false, source: { type: tab, name: item.single ? albumName(item) : displayArtist(item.name) } });
    }
    onOpen(item);
  });
  host.addEventListener("keydown", (event) => {
    const cardEl = event.target.closest(".card");
    if (cardEl && event.target === cardEl && event.key === "Enter") onOpen(items.find((i) => i.key === cardEl.dataset.key));
  });
}

/* --------------------------------- Albums --------------------------------- */

export async function renderAlbums(view) {
  const albums = [...groupAlbums(await db.getAllSongs()).values()].sort((a, b) => collator.compare(albumName(a), albumName(b)));
  gridPage(view, {
    tab: "albums",
    title: { icon: "album", empty: "No albums yet" },
    count: plural(albums.length, "album"),
    items: albums,
    card: albumCard,
    placeholder: "Search albums",
    emptyText: "Add songs to a playlist and their albums will appear here.",
    onOpen: (album) => (location.hash = `#/album/${encodeURIComponent(album.key)}`),
  });
}

export async function renderAlbum(view, { key }) {
  const albums = groupAlbums(await db.getAllSongs());
  const album = albums.get(decodeURIComponent(key));
  if (!album) return notFound(view, t("Albums"), "#/albums");

  view.innerHTML =
    detailHeader({
      back: { href: "#/albums", label: t("Albums") },
      eyebrow: album.single ? t("Singles") : t("Album"),
      title: albumName(album),
      meta: `${displayArtist(album.artist)} · ${plural(album.songs.length, "song")} · ${fmtLong(album.duration)}`,
      cover: album.cover,
    }) + `<div class="tracks" role="list"></div>`;

  const songs = () => [...(groupAlbums(allSongsCache).get(album.key)?.songs ?? [])];
  let allSongsCache = await db.getAllSongs();
  return mountDetail(view, {
    getSongs: songs,
    source: () => ({ type: "album", name: albumName(album) }),
    onChanged: async () => {
      allSongsCache = await db.getAllSongs();
      rerender();
    },
  });
}

/* --------------------------------- Artists --------------------------------- */

export async function renderArtists(view) {
  const artists = [...groupArtists(await db.getAllSongs()).values()].sort((a, b) => collator.compare(a.name, b.name));
  gridPage(view, {
    tab: "artists",
    title: { icon: "person", empty: "No artists yet" },
    count: plural(artists.length, "artist"),
    items: artists,
    card: artistCard,
    placeholder: "Search artists",
    emptyText: "Add songs to a playlist and their artists will appear here.",
    onOpen: (artist) => (location.hash = `#/artist/${encodeURIComponent(artist.key)}`),
  });
}

export async function renderArtist(view, { key }) {
  let all = await db.getAllSongs();
  const artist = groupArtists(all).get(decodeURIComponent(key));
  if (!artist) return notFound(view, t("Artists"), "#/artists");
  const albums = [...groupAlbums(artist.songs).values()].sort((a, b) => collator.compare(a.name, b.name));

  view.innerHTML =
    detailHeader({
      back: { href: "#/artists", label: t("Artists") },
      eyebrow: t("Artist"),
      title: displayArtist(artist.name),
      meta: `${plural(artist.songs.length, "song")}${artist.albumCount ? ` · ${plural(artist.albumCount, "album")}` : ""} · ${fmtLong(sumDuration(artist.songs))}`,
      cover: artist.cover,
      round: true,
    }) +
    `<h2 class="section-title">${t("Songs")}</h2>
     <div class="tracks" role="list"></div>
     ${albums.length ? `<h2 class="section-title albums-title">${t("Albums")}</h2><div class="grid">${albums.map((a, i) => albumCard(a, i)).join("")}</div>` : ""}`;
  tintCards(view);

  // Most played first, then alphabetical.
  const songs = () =>
    [...(groupArtists(all).get(artist.key)?.songs ?? [])].sort((a, b) => stats.playCount(b.id) - stats.playCount(a.id) || collator.compare(a.title, b.title));
  const destroy = mountDetail(view, {
    getSongs: songs,
    source: () => ({ type: "artist", name: displayArtist(artist.name) }),
    onChanged: async () => {
      all = await db.getAllSongs();
      rerender();
    },
  });

  view.addEventListener("click", (event) => {
    const card = event.target.closest(".grid .card");
    if (!card) return;
    const album = albums.find((a) => a.key === card.dataset.key);
    if (event.target.closest("[data-act=play]")) player.playQueue(album.songs.map((s) => s.id), { shuffle: false, source: { type: "album", name: albumName(album) } });
    else location.hash = `#/album/${encodeURIComponent(album.key)}`;
  });
  return destroy;
}
