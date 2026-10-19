import * as db from "./db.js";
import { init as initI18n, plural, t } from "./i18n.js";
import { scheduleGc } from "./importer.js";
import * as player from "./player.js";
import * as stats from "./stats.js";
import * as loudness from "./loudness.js";
import { applyAppearance } from "./prefs.js";
import { icon, toast } from "./ui.js";
import { mountMini } from "./views/mini.js";

await initI18n(); // load the chosen language before anything is rendered
applyAppearance();

const routes = [
  { name: "home", pattern: /^\/?$/, title: "Home", load: () => import("./views/home.js") },
  { name: "search", pattern: /^\/search$/, title: "Search", load: () => import("./views/search.js") },
  { name: "library", pattern: /^\/library$/, title: "Library", load: () => import("./views/library.js") },
  { name: "library", pattern: /^\/songs$/, title: "Songs", load: () => import("./views/songs.js") },
  { name: "library", pattern: /^\/albums$/, title: "Albums", load: () => import("./views/browse.js"), render: "renderAlbums" },
  { name: "library", pattern: /^\/album\/(.+)$/, title: "Album", load: () => import("./views/browse.js"), render: "renderAlbum", keys: ["key"] },
  { name: "library", pattern: /^\/artists$/, title: "Artists", load: () => import("./views/browse.js"), render: "renderArtists" },
  { name: "library", pattern: /^\/artist\/(.+)$/, title: "Artist", load: () => import("./views/browse.js"), render: "renderArtist", keys: ["key"] },
  { name: "library", pattern: /^\/stats$/, title: "Listening stats", load: () => import("./views/listening.js") },
  { name: "library", pattern: /^\/collection\/(liked|recent|top)$/, title: "Collection", load: () => import("./views/collection.js"), keys: ["kind"] },
  { name: "library", pattern: /^\/playlist\/(\d+)$/, title: "Playlist", load: () => import("./views/playlist.js"), keys: ["id"] },
  { name: "player", pattern: /^\/player$/, title: "Player", load: () => import("./views/player.js") },
  { name: "settings", pattern: /^\/settings$/, title: "Settings", load: () => import("./views/settings.js") },
];

const main = document.querySelector("#main");
const mini = document.querySelector("#mini");
const topbar = document.querySelector(".topbar");
const topbarTitle = document.querySelector(".topbar-title");
const splash = document.querySelector(".splash");
let cleanup = null;
let navToken = 0;

// Large titles collapse into a blurred bar once the page is scrolled, like a native app.
main.addEventListener("scroll", () => topbar.classList.toggle("show", main.scrollTop > 72), { passive: true });

// Classic (non-overlay) scrollbars take width from the page; the mini player needs to know to stay centered under it.
const syncScrollbarWidth = () => document.documentElement.style.setProperty("--sbw", `${main.offsetWidth - main.clientWidth}px`);
window.addEventListener("resize", syncScrollbarWidth);
new ResizeObserver(syncScrollbarWidth).observe(main);

function hideSplash() {
  if (!splash) return;
  splash.classList.add("hide");
  setTimeout(() => splash.remove(), 800);
}

async function navigate() {
  const token = ++navToken;
  const path = location.hash.replace(/^#/, "") || "/";
  const route = routes.find((r) => r.pattern.test(path)) || routes[0];
  const match = path.match(route.pattern);
  const params = Object.fromEntries((route.keys || []).map((key, i) => [key, match[i + 1]]));

  cleanup?.();
  cleanup = null;
  document.title = `${t(route.title)} · OcWave`;
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.route === route.name));
  document.body.dataset.route = route.name;

  const view = document.createElement("div");
  view.className = "view";
  main.replaceChildren(view);
  main.scrollTop = 0;
  topbar.classList.remove("show");
  try {
    const module = await route.load();
    const result = await module[route.render || "render"](view, params);
    if (token !== navToken) return result?.();
    cleanup = result || null;
    topbarTitle.textContent = view.querySelector("h1")?.textContent.trim() || t(route.title);
    syncScrollbarWidth();
  } catch (error) {
    console.error(error);
    view.innerHTML = `<div class="empty-state"><div class="empty-art">${icon("error")}</div><h2>${t("Something went wrong")}</h2><p>${String(error.message || error).replace(/</g, "&lt;")}</p></div>`;
  }
}

function setupShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (target.closest("input, textarea, select, [contenteditable], [role=slider], .overlay, .menu")) return;
    if (event.key === "/") {
      event.preventDefault();
      location.hash = "#/search";
      return;
    }
    const handled = {
      " ": () => (target.closest("button, a, [role=button]") ? null : player.togglePlay()),
      ArrowRight: () => player.seekBy(5),
      ArrowLeft: () => player.seekBy(-5),
      n: player.next,
      p: player.prev,
      m: player.toggleMute,
      s: player.toggleShuffle,
      r: player.cycleRepeat,
    }[event.key];
    if (!handled || !player.state.song) return;
    if (event.key === " " && target.closest("button, a, [role=button]")) return;
    event.preventDefault();
    handled();
  });
}

// Playlists from the previous version only lived in localStorage and had no stored audio.
// Recreate them as empty playlists so names and covers aren't lost.
async function migrateLegacyPlaylists() {
  if (localStorage.getItem("ocwave.migrated")) return;
  try {
    const legacy = JSON.parse(localStorage.getItem("playlists") || "[]");
    const existing = await db.getPlaylists();
    if (Array.isArray(legacy) && !existing.length) {
      for (const item of legacy) {
        const cover = typeof item.cover === "string" && item.cover.startsWith("data:") ? item.cover : null;
        await db.createPlaylist(item.name || t("Playlist"), { cover });
      }
      if (legacy.length) toast(t("Imported {playlists} from the old version. Add your songs again to play them.", { playlists: plural(legacy.length, "playlist") }), { duration: 8000 });
    }
  } catch (error) {
    console.warn("Legacy migration skipped:", error);
  }
  localStorage.setItem("ocwave.migrated", "1");
}

async function start() {
  try {
    await db.openDB();
  } catch (error) {
    main.innerHTML = `<div class="view"><div class="empty-state"><div class="empty-art">${icon("storage")}</div><h2>${t("Storage unavailable")}</h2><p>${String(error.message || error)}</p></div></div>`;
    hideSplash();
    return;
  }
  await migrateLegacyPlaylists();
  await stats.init();
  await player.init();
  loudness.kick();
  mountMini(mini);
  setupShortcuts();
  scheduleGc((removed) => player.purge(removed)); // clean up songs orphaned by an earlier session

  const sync = (state) => (document.documentElement.dataset.playing = state.playing ? "1" : "0");
  player.subscribe(sync);
  sync(player.state);

  window.addEventListener("hashchange", navigate);
  navigate().finally(() => setTimeout(hideSplash, 350));
  registerServiceWorker();
}

// Makes the app installable and usable offline. Skipped on plain http (except localhost), where browsers don't allow it.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (secure) navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker not registered:", error));
}

start();
