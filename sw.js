// Service worker: keeps the app shell available offline.
// App files use "network first" so updates show up right away, with the cache as the offline fallback.
// Fonts are self-hosted, so they are cached like any other app file. Songs live in IndexedDB, not here.
const VERSION = "v17";
const CACHE = `ocwave-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "css/fonts.css",
  "assets/fonts/inter-latin.woff2",
  "assets/fonts/inter-latin-ext.woff2",
  "assets/fonts/inter-cyrillic.woff2",
  "assets/fonts/inter-cyrillic-ext.woff2",
  "assets/fonts/material-symbols-rounded.woff2",
  "assets/logo.svg",
  "assets/logo.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon.png",
  "js/app.js",
  "js/backup.js",
  "js/db.js",
  "js/i18n.js",
  "js/importer.js",
  "js/locales/de.js",
  "js/locales/es.js",
  "js/locales/fr.js",
  "js/locales/it.js",
  "js/locales/ja.js",
  "js/locales/ko.js",
  "js/locales/nl.js",
  "js/locales/pt-BR.js",
  "js/locales/pt.js",
  "js/locales/ru.js",
  "js/locales/tr.js",
  "js/locales/zh-CN.js",
  "js/locales/zh-TW.js",
  "js/loudness.js",
  "js/lyrics.js",
  "js/meta.js",
  "js/player.js",
  "js/prefs.js",
  "js/stats.js",
  "js/version.js",
  "js/visualizer.js",
  "js/waveform.js",
  "js/ui.js",
  "js/views/browse.js",
  "js/views/collection.js",
  "js/views/home.js",
  "js/views/library.js",
  "js/views/mini.js",
  "js/views/player.js",
  "js/views/listening.js",
  "js/views/playlist.js",
  "js/views/reorder.js",
  "js/views/search.js",
  "js/views/selection.js",
  "js/views/settings.js",
  "js/views/songlist.js",
  "js/views/songs.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || (request.mode === "navigate" ? caches.match("index.html") : Response.error())))
    );
    return;
  }
});
