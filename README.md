# OcWave

A minimalist music player that runs in the browser. Songs, covers, lyrics and playlists are stored in
IndexedDB, so everything keeps working after a reload and offline. It can also be installed as an app (PWA).

## Run

It uses ES modules and a service worker, so it has to be served over HTTP (opening `index.html` directly won't work):

```bash
python3 -m http.server 5510
```

Then open <http://localhost:5510>. VS Code Live Server works too. Note that every address and port is its own
browser storage: a library created on `localhost:5510` is not visible on `localhost:5501`. Use **Settings → Backup**
to move a library between them.

## Features

- **Library:** playlists, an All songs view, **Albums and Artists** pages, global search (press `/`), add to playlist, play next / add to queue, drag to reorder, drop files or whole folders.
- **Likes and history:** a heart on every song, **Liked Songs**, **Recently played** and **Most played** collections (a song counts as played after 30 seconds of real listening; seeking doesn't count).
- **Queue:** drag to reorder, remove songs, clear what's upcoming, or save the queue as a playlist.
- **Player:** Cover and Vinyl designs (four record styles, optional sleeve, draggable needle), queue, shuffle/repeat, playback speed, sleep timer, crossfade, near-gapless playback.
- **Lyrics:** read from the file's tags, looked up on [LRCLIB](https://lrclib.net) (free, no key; only title, artist and length are sent, and it can be switched off in Settings), or imported from a `.lrc`/`.txt` file. Synced lyrics highlight the current line and can be clicked to seek.
- **Languages:** English, German, Italian, Spanish, French, Portuguese (Brazil and Portugal), Simplified and Traditional Chinese, Japanese, Korean, Turkish, Russian and Dutch. The app follows your browser language, or pick one in Settings → Appearance. The translations were written with AI help, so corrections from native speakers are welcome.
- **Sound:** five-band equalizer with presets, optional volume normalisation (songs are measured once, EBU R128 style, and played at an even loudness).
- **Playlists:** drag rows by their grip (mouse or touch), sort by title/artist/album/duration/date with Undo, and select several songs for bulk actions (queue, add to playlist, like, remove, delete).
- **Stats:** a listening stats page (time per day/week, plays, streak, top songs/artists/albums, time of day), kept on the device.
- **Lyrics:** synced lyrics from LRCLIB or a `.lrc` file, with word-by-word highlighting (real word timing from enhanced LRC `<mm:ss.xx>` tags; otherwise estimated per line).
- **Visuals:** live frequency visualiser and a waveform seek bar in the full player; per-song cover editing (change or remove a cover from any song menu).
- **Backup:** export everything (audio included) to one `.ocwave` file and restore it later.
- **Offline & install:** a service worker caches the app; works as an installable app on supported browsers. On phones the Home page suggests installing it, because Safari can clear a site's data after about a week without use (installed Home Screen apps are exempt).
- **Privacy:** no accounts, analytics or tracking. Fonts and icons are bundled (nothing is loaded from Google); the only network request the app makes is the optional lyrics lookup on lrclib.net.

## Structure

| Path | What it does |
| --- | --- |
| `index.html` | App shell (sidebar, content area, mini player) |
| `css/style.css` | All styling, themed with CSS variables |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |
| `js/install.js` | "Add to Home Screen" hint logic (iOS and Android) |
| `js/version.js` | App version shown in Settings → About (bump it for each release, together with `VERSION` in `sw.js`) |
| `css/fonts.css`, `assets/fonts/` | Self-hosted Inter and a subset of the icon font (see `assets/fonts/README.md`) |
| `js/app.js` | Hash router, shortcuts, startup |
| `js/db.js` | IndexedDB layer (songs with audio blobs, playlists) |
| `js/player.js` | Playback engine: two decks, queue, EQ, crossfade, sleep timer, Media Session |
| `js/meta.js` | ID3 tag + cover art + embedded lyrics reader, audio format detection, filename parsing, generated covers |
| `js/stats.js` | Liked songs, play counts and last-played times (stored apart from the audio) |
| `js/loudness.js` | Volume normalisation: loudness measurement (K-weighting + gating) and per-song gain |
| `js/waveform.js` | Waveform peaks for the seek bar (computed once per song, stored with its stats) |
| `js/views/listening.js` | Listening stats page |
| `js/views/selection.js`, `js/views/reorder.js` | Multi-select bar and drag-to-reorder (mouse and touch) |
| `js/visualizer.js` | Canvas frequency visualiser fed by the player's analyser node |
| `js/lyrics.js` | LRC parsing and the LRCLIB lookup |
| `js/importer.js` | Adds audio files and folders to a playlist |
| `js/backup.js` | Backup and restore |
| `js/prefs.js` | Appearance, playback and EQ settings |
| `js/i18n.js`, `js/locales/` | Translation engine and the language files (one per language) |
| `js/views/` | Home, Library, Songs, Albums/Artists (`browse.js`), Collections, Search, Playlist, Player, Settings, mini player |

## Shortcuts

Space play/pause · ← → seek · N / P next / previous · S shuffle · R repeat · M mute · Q queue · L lyrics · / search

## Adding or fixing a translation

Every piece of text in the code is written in English, for example `t("Add songs")`. `js/i18n.js` looks the English
text up in `js/locales/<code>.js` and falls back to English when there is no entry, so a missing translation never
breaks anything.

- **Fix a wording:** edit the entry in the language file, e.g. `js/locales/de.js`.
- **Add a language:** copy `js/locales/de.js` to `js/locales/<code>.js`, translate the values (keep `{placeholders}` and
  `<kbd>` tags as they are), add the language to `LANGUAGES` in `js/i18n.js` and to the cache list in `sw.js`.
- **Plurals** ("3 songs") live in the `plurals` object of each language file, with the forms that language needs.
