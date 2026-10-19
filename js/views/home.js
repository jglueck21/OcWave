import * as db from "../db.js";
import { formatDate, t } from "../i18n.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { displayArtist, esc, fmtTime, icon, plural } from "../ui.js";
import { collectionSongs, collectionTile, coverOf, createPlaylistFlow, playPlaylist, statsTile, tintCards } from "./library.js";

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? t("Good night") : hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
};

export async function render(view) {
  const [allPlaylists, songs] = await Promise.all([db.getPlaylists(), db.getAllSongs()]);
  const playlists = allPlaylists.sort((a, b) => b.updatedAt - a.updatedAt);
  const likedCount = collectionSongs("liked", songs).length;
  const recentSongs = stats.recent(songs, 12);
  const collectionTiles = [collectionTile("liked", likedCount, 0), ...(recentSongs.length ? [collectionTile("recent", recentSongs.length, 1), statsTile(2)] : [])];
  const songCount = playlists.reduce((sum, p) => sum + p.songIds.length, 0);
  const today = formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" });

  view.innerHTML = `
    <section class="home-top">
      <div class="home-greeting">
        <span class="eyebrow">${today}</span>
        <h1>${greeting()}</h1>
        <p class="muted">${playlists.length ? t("{playlists} · {songs} on this device", { playlists: plural(playlists.length, "playlist"), songs: plural(songCount, "song") }) : t("Your personal space for seamless music enjoyment.")}</p>
      </div>
      <div class="home-actions">
        <button class="btn btn-primary" data-act="new">${icon("add")} ${t("New playlist")}</button>
        <a class="btn" href="#/search">${icon("search")} ${t("Search")}</a>
      </div>
    </section>

    <div class="home-grid" ${playlists.length ? "" : "hidden"}>
      <section class="quick" aria-label="${t("Quick picks")}">
        <div class="quick-grid">
          ${collectionTiles.join("")}
          ${playlists
            .slice(0, 6 - collectionTiles.length)
            .map(
              (p, i) => `<article class="tile" style="--i:${i + collectionTiles.length}" tabindex="0" role="link" data-id="${p.id}" aria-label="${esc(p.name)}">
                <img src="${coverOf(p)}" alt="" draggable="false">
                <div class="tile-text"><strong>${esc(p.name)}</strong><small>${plural(p.songIds.length, "song")}</small></div>
                <button class="tile-play" data-act="tile-play" aria-label="${esc(t("Play {title}", { title: p.name }))}">${icon("play_arrow")}</button>
              </article>`
            )
            .join("")}
        </div>
      </section>
      <section class="now-card" hidden></section>
    </div>

    <section class="home-section recent-section" ${recentSongs.length ? "" : "hidden"}>
      <div class="section-head"><h2>${t("Recently played")}</h2><a href="#/collection/recent" class="link">${t("See all")}</a></div>
      <div class="song-row">
        ${recentSongs
          .map(
            (song, i) => `<button class="song-card" style="--i:${i}" data-recent="${i}" aria-label="${esc(t("Play {title}", { title: song.title }))}">
              <span class="song-card-cover"><img src="${song.cover}" alt="" loading="lazy"><i class="song-card-play">${icon("play_arrow")}</i></span>
              <strong>${esc(song.title)}</strong><small>${esc(displayArtist(song.artist))}</small>
            </button>`
          )
          .join("")}
      </div>
    </section>

    <section class="home-section" ${playlists.length ? "" : "hidden"}>
      <div class="section-head"><h2>${t("Your playlists")}</h2><a href="#/library" class="link">${t("See all")}</a></div>
      <div class="stack-wrap">
        <div class="stack" tabindex="0" role="listbox" aria-label="${t("Playlists")}">
          ${playlists
            .slice(0, 12)
            .map(
              (p, i) => `<div class="stack-item" role="option" data-id="${p.id}" data-i="${i}" aria-label="${esc(p.name)}">
                <img src="${coverOf(p)}" alt="" loading="lazy" draggable="false">
              </div>`
            )
            .join("")}
        </div>
        <div class="stack-info">
          <h3 class="stack-title"></h3>
          <p class="muted stack-meta"></p>
          <div class="stack-actions">
            <button class="btn btn-primary" data-act="stack-play">${icon("play_arrow")} ${t("Play")}</button>
            <button class="btn" data-act="stack-open">${t("Open")}</button>
          </div>
        </div>
      </div>
    </section>

    ${
      playlists.length
        ? ""
        : `<section class="empty-state">
             <div class="empty-art">${icon("library_music")}</div>
             <h2>${t("Start your collection")}</h2>
             <p>${t("Create a playlist and drop in your music files. Everything stays on your device, so it works offline.")}</p>
           </section>`
    }`;

  tintCards(view.querySelector(".quick-grid"));

  /* ------------------------------ Now playing card ------------------------------ */

  const nowCard = view.querySelector(".now-card");
  let renderedSong = null;
  const drawNow = (state) => {
    nowCard.hidden = !state.song;
    if (!state.song) return (renderedSong = null);
    nowCard.style.setProperty("--np-rgb", state.color.join(", "));
    const label = state.playing ? t("Now playing") : t("Continue listening");
    if (renderedSong === state.song.id && nowCard.firstElementChild) {
      // Only the dynamic bits changed: avoid re-creating the card (and replaying its animation).
      nowCard.querySelector(".eyebrow").textContent = label;
      nowCard.querySelector("[data-act=toggle]").innerHTML = `${icon(state.playing ? "pause" : "play_arrow")} ${state.playing ? t("Pause") : t("Resume")}`;
      return;
    }
    renderedSong = state.song.id;
    nowCard.innerHTML = `
      <div class="now-top">
        <img src="${state.song.cover}" alt="">
        <div class="now-text">
          <span class="eyebrow">${label}</span>
          <strong>${esc(state.song.title)}</strong>
          <small>${esc(displayArtist(state.song.artist))}</small>
        </div>
      </div>
      <div class="now-progress"><i></i></div>
      <div class="now-times"><span class="cur">0:00</span><span class="dur">0:00</span></div>
      <div class="now-actions">
        <button class="btn btn-primary" data-act="toggle">${icon(state.playing ? "pause" : "play_arrow")} ${state.playing ? t("Pause") : t("Resume")}</button>
        <a class="btn" href="#/player">${t("Open player")}</a>
      </div>`;
    drawTime(player.getTime());
  };
  const drawTime = ({ current, duration }) => {
    const bar = nowCard.querySelector(".now-progress i");
    if (!bar) return;
    bar.style.width = `${duration ? (current / duration) * 100 : 0}%`;
    nowCard.querySelector(".cur").textContent = fmtTime(current);
    nowCard.querySelector(".dur").textContent = fmtTime(duration);
  };
  drawNow(player.state);
  const stopListening = [player.subscribe(drawNow), player.subscribeTime(drawTime)];

  /* ------------------------------ Cover carousel ------------------------------ */

  const stack = view.querySelector(".stack");
  const items = [...view.querySelectorAll(".stack-item")];
  let focused = 0;

  const layout = () => {
    if (!stack || !items.length || !stack.isConnected) return;
    const center = stack.scrollLeft + stack.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;
    items.forEach((item, i) => {
      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const offset = (itemCenter - center) / (item.offsetWidth * 0.62); // 0 = centered, ±1 = next to it
      const clamped = Math.max(-3, Math.min(3, offset));
      const near = Math.abs(clamped);
      item.style.transform = `translateX(${clamped * -14}px) rotateY(${clamped * -38}deg) scale(${1 - Math.min(near, 2.2) * 0.1})`;
      item.style.opacity = String(Math.max(0.25, 1 - near * 0.22));
      item.style.zIndex = String(10 - Math.round(near * 3));
      item.classList.toggle("is-center", near < 0.5);
      if (near < bestDistance) (bestDistance = near), (best = i);
    });
    if (best !== focused || !view.querySelector(".stack-title").textContent) {
      focused = best;
      const p = playlists[best];
      view.querySelector(".stack-title").textContent = p.name;
      view.querySelector(".stack-meta").textContent = `${plural(p.songIds.length, "song")}`;
    }
  };

  const goTo = (index, behavior = "smooth") => {
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    const item = items[clamped];
    stack.scrollTo({ left: item.offsetLeft + item.offsetWidth / 2 - stack.clientWidth / 2, behavior });
  };

  let frame = 0;
  if (stack && items.length) {
    stack.addEventListener("scroll", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    }, { passive: true });
    stack.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") (event.preventDefault(), goTo(focused + 1));
      if (event.key === "ArrowLeft") (event.preventDefault(), goTo(focused - 1));
      if (event.key === "Enter") location.hash = `#/playlist/${playlists[focused].id}`;
    });
    requestAnimationFrame(() => {
      goTo(0, "auto");
      layout();
    });
    window.addEventListener("resize", layout);
  }

  view.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "new") return createPlaylistFlow();
    if (act === "toggle") return player.togglePlay();
    if (act === "stack-play") return playPlaylist(playlists[focused]);
    if (act === "stack-open") return (location.hash = `#/playlist/${playlists[focused].id}`);
    const recent = event.target.closest("[data-recent]");
    if (recent) {
      return player.playQueue(recentSongs.map((s) => s.id), { start: Number(recent.dataset.recent), shuffle: false, source: { type: "collection", name: "Recently played" } });
    }
    const tile = event.target.closest(".tile");
    if (tile && tile.classList.contains("coll")) return; // collection tiles are plain links
    if (tile) {
      const playlist = playlists.find((p) => p.id === Number(tile.dataset.id));
      return act === "tile-play" ? playPlaylist(playlist) : (location.hash = `#/playlist/${playlist.id}`);
    }
    const item = event.target.closest(".stack-item");
    if (item) {
      if (item.classList.contains("is-center")) location.hash = `#/playlist/${item.dataset.id}`;
      else goTo(Number(item.dataset.i));
    }
  });
  view.addEventListener("keydown", (event) => {
    const tile = event.target.closest?.(".tile");
    if (tile && event.target === tile && event.key === "Enter") location.hash = `#/playlist/${tile.dataset.id}`;
  });

  return () => {
    stopListening.forEach((stop) => stop());
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", layout);
  };
}
