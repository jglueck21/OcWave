import { t } from "../i18n.js";
import { importLyricsFile, loadLyrics } from "../lyrics.js";
import * as db from "../db.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { getDesign, getVisualizer, getWaveSeek, setDesign, setLyricsOnline, setVisualizer } from "../prefs.js";
import { createVisualizer } from "../visualizer.js";
import { BARS, getWaveform } from "../waveform.js";
import { bindSlider, displayArtist, eqBars, esc, fmtTime, formDialog, icon, openMenu, plural, toast } from "../ui.js";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [5, 10, 15, 30, 45, 60];

export function render(view) {
  view.classList.add("full");

  if (!player.state.song) {
    view.innerHTML = `
      <div class="empty-state">
        <div class="empty-art">${icon("album")}</div>
        <h2>${t("Nothing playing yet")}</h2>
        <p>${t("Open a playlist and press play. Your music will show up here.")}</p>
        <a class="btn btn-primary" href="#/library">${icon("library_music")} ${t("Browse library")}</a>
      </div>`;
    // Re-render as soon as something starts playing.
    return player.subscribe((s) => s.song && window.dispatchEvent(new HashChangeEvent("hashchange")));
  }

  view.innerHTML = `
    <section class="np">
      <div class="np-bg"><img alt=""><i class="np-blob b1"></i><i class="np-blob b2"></i><i class="np-blob b3"></i></div>
      <canvas class="np-viz" aria-hidden="true"></canvas>
      <header class="np-top">
        <div class="np-from"><span class="eyebrow">${t("Playing from")}</span><strong class="np-source"></strong></div>
        <div class="np-actions">
          <div class="seg" role="radiogroup" aria-label="${t("Player design")}">
            <button data-design="cover" role="radio">${icon("image")}${t("Cover")}</button>
            <button data-design="vinyl" role="radio">${icon("album")}${t("Vinyl")}</button>
          </div>
          <button class="icon-btn" id="viz-btn" aria-label="${t("Visualiser")}" title="${t("Visualiser")}" aria-pressed="false">${icon("graphic_eq")}</button>
          <button class="icon-btn" id="lyrics-btn" aria-label="${t("Show lyrics")}" title="${t("Lyrics (L)")}">${icon("lyrics")}</button>
          <button class="icon-btn" id="queue-btn" aria-label="${t("Show queue")}" title="${t("Queue (Q)")}">${icon("queue_music")}</button>
        </div>
      </header>

      <div class="np-stage">
        <div class="np-art cover-art"><img class="np-cover" alt=""></div>
        <div class="vinyl-wrap">
          <div class="sleeve"><img class="np-cover" alt=""></div>
          <div class="record"><div class="label"><img class="np-cover" alt=""></div></div>
          <div class="sheen"></div>
          <div class="arm" title="${t("Drag the needle to jump to a spot in the song")}"><i class="arm-pivot"></i><i class="arm-rod"></i><i class="arm-head"></i></div>
        </div>

        <div class="np-meta"><h1 class="np-title"></h1><p class="np-artist"></p></div>

        <div class="np-seek">
          <span class="cur">0:00</span>
          <div class="slider seek" role="slider" tabindex="0" aria-label="${t("Seek")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <canvas class="wave-canvas" aria-hidden="true"></canvas><div class="fill"></div><div class="thumb"></div>
          </div>
          <span class="dur">0:00</span>
        </div>

        <div class="np-controls">
          <button class="icon-btn toggle" data-act="shuffle" aria-label="${t("Shuffle")}" title="${t("Shuffle (S)")}">${icon("shuffle")}</button>
          <button class="icon-btn big" data-act="prev" aria-label="${t("Previous")}" title="${t("Previous (P)")}">${icon("skip_previous")}</button>
          <button class="play-btn" data-act="play" aria-label="${t("Play")}" title="${t("Play / Pause (Space)")}">${icon("play_arrow")}</button>
          <button class="icon-btn big" data-act="next" aria-label="${t("Next")}" title="${t("Next (N)")}">${icon("skip_next")}</button>
          <button class="icon-btn toggle" data-act="repeat" aria-label="${t("Repeat")}" title="${t("Repeat (R)")}">${icon("repeat")}</button>
        </div>

        <div class="np-bottom">
          <div class="np-volume">
            <button class="icon-btn" data-act="mute" aria-label="${t("Mute")}" title="${t("Mute (M)")}">${icon("volume_up")}</button>
            <div class="slider volume" role="slider" tabindex="0" aria-label="${t("Volume")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80">
              <div class="fill"></div><div class="thumb"></div>
            </div>
          </div>
          <div class="np-tools">
            <button class="tool-btn heart" data-act="like" aria-label="${t("Like")}" aria-pressed="false" title="${t("Like")}">${icon("favorite")}</button>
            <button class="tool-btn" data-act="rate" aria-label="${t("Playback speed")}" title="${t("Playback speed")}">1×</button>
            <button class="tool-btn" data-act="sleep" aria-label="${t("Sleep timer")}" title="${t("Sleep timer")}">${icon("bedtime")}<span class="badge"></span></button>
          </div>
        </div>
      </div>

      <aside class="queue drawer-queue" aria-label="${t("Queue")}" aria-hidden="true">
        <div class="queue-head">
          <div><h2>${t("Up next")}</h2><small class="queue-count muted"></small></div>
          <button class="icon-btn" data-close aria-label="${t("Close queue")}">${icon("close")}</button>
        </div>
        <div class="queue-tools">
          <button class="chip-btn" data-queue="clear">${icon("playlist_remove")} ${t("Clear upcoming")}</button>
          <button class="chip-btn" data-queue="save">${icon("playlist_add")} ${t("Save as playlist")}</button>
        </div>
        <div class="queue-list"></div>
      </aside>

      <aside class="queue drawer-lyrics" aria-label="${t("Lyrics")}" aria-hidden="true">
        <div class="queue-head">
          <div><h2>${t("Lyrics")}</h2><small class="lyrics-source muted"></small></div>
          <button class="icon-btn" data-close aria-label="${t("Close lyrics")}">${icon("close")}</button>
        </div>
        <div class="lyrics-body"></div>
        <input type="file" id="lyrics-file" accept=".lrc,.txt,text/plain" hidden>
      </aside>
    </section>`;

  const $ = (sel) => view.querySelector(sel);
  const np = $(".np");
  const queue = $(".drawer-queue");
  const lyricsDrawer = $(".drawer-lyrics");

  /* ------------------------------- Design ------------------------------- */

  const applyDesign = (design) => {
    np.dataset.design = design;
    view.querySelectorAll("[data-design]").forEach((b) => b.setAttribute("aria-checked", b.dataset.design === design));
  };
  applyDesign(getDesign());
  $(".seg").addEventListener("click", (event) => {
    const design = event.target.closest("button[data-design]")?.dataset.design;
    if (!design) return;
    setDesign(design);
    applyDesign(design);
  });

  /* ------------------------------ Visualiser ------------------------------ */

  const viz = createVisualizer($(".np-viz"), { getAnalyser: player.getAnalyser, isPlaying: () => player.state.playing });
  const setViz = (on) => {
    $("#viz-btn").classList.toggle("on", on);
    $("#viz-btn").setAttribute("aria-pressed", on);
    np.classList.toggle("viz-on", on);
    viz.setEnabled(on);
  };
  setViz(getVisualizer());
  $("#viz-btn").addEventListener("click", () => {
    const on = !np.classList.contains("viz-on");
    setVisualizer(on);
    setViz(on);
  });

  /* ------------------------------- Sliders ------------------------------- */

  /* Waveform: drawn over the seek bar once a song's peaks are known (analysed once, then stored). */
  const seekEl = $(".seek");
  const waveCanvas = $(".wave-canvas");
  let wave = null;
  let progress = 0;
  function drawWave() {
    if (!wave) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth: w, clientHeight: h } = waveCanvas;
    if (!w) return;
    if (waveCanvas.width !== Math.round(w * ratio) || waveCanvas.height !== Math.round(h * ratio)) {
      waveCanvas.width = Math.round(w * ratio);
      waveCanvas.height = Math.round(h * ratio);
    }
    const c = waveCanvas.getContext("2d");
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, w, h);
    const text = (getComputedStyle(waveCanvas).color.match(/\d+/g) || [255, 255, 255]).slice(0, 3).join(",");
    const accent = getComputedStyle(waveCanvas).getPropertyValue("--accent").trim() || "#4c8dff";
    const slot = w / BARS;
    const bar = Math.max(1.5, slot * 0.62);
    wave.forEach((value, i) => {
      const height = Math.max(3, (value / 100) * (h - 4));
      const x = i * slot + (slot - bar) / 2;
      c.fillStyle = (i + 0.5) / BARS <= progress ? accent : `rgba(${text},0.3)`;
      c.beginPath();
      c.roundRect(x, (h - height) / 2, bar, height, bar / 2);
      c.fill();
    });
  }
  const setProgress = (f) => ((progress = f), seek.set(f), drawWave());
  const showWave = (data) => {
    wave = data;
    seekEl.classList.toggle("has-wave", !!data);
    drawWave();
  };
  let waveFor = null;
  function loadWave(song) {
    if (waveFor === song.id) return;
    waveFor = song.id;
    showWave(null);
    if (!getWaveSeek()) return;
    getWaveform(song.id).then((data) => waveFor === song.id && data && showWave(data));
  }
  window.addEventListener("resize", drawWave);

  const seek = bindSlider(seekEl, {
    step: 0.03,
    onInput: (f) => {
      setProgress(f);
      $(".cur").textContent = fmtTime(f * player.getTime().duration);
    },
    onCommit: (f) => player.seek(f * player.getTime().duration),
  });
  const volume = bindSlider($(".volume"), {
    onInput: (f) => player.setVolume(f),
    onCommit: (f) => player.setVolume(f),
  });

  /* Tonearm: follows playback progress from the outer groove to the label, and can be dragged to seek. */
  const ARM_START = 13;
  const ARM_END = 32;
  const arm = $(".arm");
  const setArm = (fraction) => np.style.setProperty("--arm-angle", `${ARM_START + (ARM_END - ARM_START) * fraction}deg`);
  let armDrag = null;
  arm.addEventListener("pointerdown", (event) => {
    const pivot = $(".arm-pivot").getBoundingClientRect();
    armDrag = { cx: pivot.left + pivot.width / 2, cy: pivot.top + pivot.height / 2, fraction: 0 };
    arm.classList.add("dragging");
    arm.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  arm.addEventListener("pointermove", (event) => {
    if (!armDrag) return;
    const angle = (Math.atan2(-(event.clientX - armDrag.cx), event.clientY - armDrag.cy) * 180) / Math.PI;
    armDrag.fraction = Math.min(1, Math.max(0, (angle - ARM_START) / (ARM_END - ARM_START)));
    setArm(armDrag.fraction);
    $(".cur").textContent = fmtTime(armDrag.fraction * player.getTime().duration);
  });
  const endArmDrag = (commit) => {
    if (!armDrag) return;
    if (commit) player.seek(armDrag.fraction * player.getTime().duration);
    armDrag = null;
    arm.classList.remove("dragging");
  };
  arm.addEventListener("pointerup", () => endArmDrag(true));
  arm.addEventListener("pointercancel", () => endArmDrag(false));

  /* The cover tilts slightly towards the pointer. */
  const art = $(".np-art");
  art.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const rect = art.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    art.classList.add("tilting");
    art.style.setProperty("--ry", `${x * 10}deg`);
    art.style.setProperty("--rx", `${-y * 10}deg`);
  });
  art.addEventListener("pointerleave", () => {
    art.classList.remove("tilting");
    art.style.setProperty("--ry", "0deg");
    art.style.setProperty("--rx", "0deg");
  });

  /* Swipe the artwork left/right to change song. */
  let swipeStart = null;
  view.querySelectorAll(".np-art, .record, .np-meta").forEach((target) => {
    target.addEventListener("pointerdown", (event) => (swipeStart = { x: event.clientX, y: event.clientY }));
    target.addEventListener("pointerup", (event) => {
      if (!swipeStart) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) dx < 0 ? player.next() : player.prev();
    });
  });

  /* ------------------------------ Speed & sleep ------------------------------ */

  const rateMenu = (anchor) =>
    openMenu(
      anchor,
      RATES.map((rate) => ({
        label: rate === 1 ? t("Normal (1×)") : `${rate}×`,
        icon: rate === player.state.rate ? "radio_button_checked" : "radio_button_unchecked",
        onClick: () => player.setRate(rate),
      }))
    );

  const sleepMenu = (anchor) => {
    const sleep = player.state.sleep;
    openMenu(anchor, [
      ...SLEEP_OPTIONS.map((minutes) => ({
        label: t("{n} minutes", { n: minutes }),
        icon: sleep?.mode === "time" && sleep.minutes === minutes ? "radio_button_checked" : "radio_button_unchecked",
        onClick: () => {
          player.setSleep(minutes);
          toast(t("Music will fade out in {n} minutes.", { n: minutes }), { duration: 2400 });
        },
      })),
      {
        label: t("End of this song"),
        icon: sleep?.mode === "song" ? "radio_button_checked" : "radio_button_unchecked",
        onClick: () => (player.setSleep("song"), toast(t("Music will stop after this song."), { duration: 2400 })),
      },
      ...(sleep ? ["sep", { label: t("Turn off timer"), icon: "timer_off", onClick: () => player.setSleep(null) }] : []),
    ]);
  };

  /* ------------------------------ Drawers ------------------------------ */

  const isOpen = (drawer) => drawer.classList.contains("open");
  const setDrawer = (drawer, open) => {
    for (const other of [queue, lyricsDrawer]) {
      const shouldOpen = other === drawer ? open : false;
      other.classList.toggle("open", shouldOpen);
      other.setAttribute("aria-hidden", !shouldOpen);
    }
    $("#queue-btn").classList.toggle("on", isOpen(queue));
    $("#lyrics-btn").classList.toggle("on", isOpen(lyricsDrawer));
    if (open && drawer === queue) queue.querySelector(".current")?.scrollIntoView({ block: "center" });
    if (open && drawer === lyricsDrawer) ensureLyrics();
  };
  $("#queue-btn").addEventListener("click", () => setDrawer(queue, !isOpen(queue)));
  $("#lyrics-btn").addEventListener("click", () => setDrawer(lyricsDrawer, !isOpen(lyricsDrawer)));
  view.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => setDrawer(null, false)));

  const onKey = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (document.querySelector(".overlay")) return;
    if (event.key === "q") setDrawer(queue, !isOpen(queue));
    if (event.key === "l") setDrawer(lyricsDrawer, !isOpen(lyricsDrawer));
  };
  document.addEventListener("keydown", onKey);

  queue.addEventListener("click", async (event) => {
    const tool = event.target.closest("[data-queue]")?.dataset.queue;
    if (tool === "clear") {
      player.clearUpcoming();
      return toast(t("Cleared the upcoming songs."), { duration: 2000 });
    }
    if (tool === "save") return saveQueueAsPlaylist();
    const row = event.target.closest("[data-pos]");
    if (!row) return;
    if (event.target.closest("[data-act=q-remove]")) return player.removeFromQueue(Number(row.dataset.pos));
    if (event.target.closest(".q-handle")) return;
    player.playAt(Number(row.dataset.pos));
  });

  async function saveQueueAsPlaylist() {
    const ids = [...new Set(player.state.order)];
    const result = await formDialog({
      title: t("Save queue as playlist"),
      fields: [{ name: "name", label: t("Name"), value: t("{name} (queue)", { name: player.state.source?.name || t("Queue") }), required: true }],
      submitText: t("Save"),
    });
    if (!result?.name) return;
    const playlist = await db.createPlaylist(result.name);
    await db.setPlaylistSongs(playlist.id, ids);
    toast(t("Saved {songs} as \"{name}\".", { songs: plural(ids.length, "song"), name: playlist.name }), { type: "success", action: { label: t("Open"), onClick: () => (location.hash = `#/playlist/${playlist.id}`) } });
  }

  /* Drag the handle to reorder the queue (works with mouse and touch). */
  const queueList = $(".queue-list");
  let queueDrag = null;
  queueList.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".q-handle");
    if (!handle) return;
    const rows = [...queueList.querySelectorAll(".queue-row")];
    const row = handle.closest(".queue-row");
    queueDrag = { row, rows, rects: rows.map((r) => r.getBoundingClientRect()), from: rows.indexOf(row), to: rows.indexOf(row), startY: event.clientY };
    row.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  queueList.addEventListener("pointermove", (event) => {
    if (!queueDrag) return;
    const { rows, rects, from, row } = queueDrag;
    row.style.transform = `translateY(${event.clientY - queueDrag.startY}px)`;
    let to = from;
    for (let i = 0; i < rects.length; i++) if (event.clientY >= rects[i].top && event.clientY <= rects[i].bottom) to = i;
    if (event.clientY < rects[0].top) to = 0;
    if (event.clientY > rects.at(-1).bottom) to = rects.length - 1;
    queueDrag.to = to;
    const shift = rects[from].height;
    rows.forEach((other, i) => {
      if (other === row) return;
      other.style.transform = from < to && i > from && i <= to ? `translateY(${-shift}px)` : from > to && i >= to && i < from ? `translateY(${shift}px)` : "";
    });
  });
  const endQueueDrag = (commit) => {
    if (!queueDrag) return;
    const { rows, row, from, to } = queueDrag;
    rows.forEach((r) => (r.style.transform = ""));
    row.classList.remove("dragging");
    queueDrag = null;
    if (commit && from !== to) player.moveInQueue(Number(rows[from].dataset.pos), Number(rows[to].dataset.pos));
  };
  queueList.addEventListener("pointerup", () => endQueueDrag(true));
  queueList.addEventListener("pointercancel", () => endQueueDrag(false));

  /* -------------------------------- Lyrics -------------------------------- */

  const lyricsBody = $(".lyrics-body");
  let lyrics = { songId: null, status: "idle" };
  let activeLine = -1;
  let userScrolledAt = 0;
  for (const type of ["wheel", "touchmove", "pointerdown"]) lyricsBody.addEventListener(type, () => (userScrolledAt = Date.now()), { passive: true });

  async function ensureLyrics({ force = false } = {}) {
    const song = player.state.song;
    if (!song || (!force && lyrics.songId === song.id && lyrics.status !== "idle")) return;
    lyrics = { songId: song.id, status: "loading" };
    drawLyrics();
    const result = await loadLyrics(song, { force });
    if (lyrics.songId !== song.id) return; // the song changed meanwhile
    lyrics = { songId: song.id, status: result.status, data: result.lyrics };
    if (result.song && result.song !== song) player.refreshSong(result.song);
    drawLyrics();
  }

  function drawLyrics() {
    activeLine = -1;
    const source = { lrclib: t("via LRCLIB"), file: t("from file") }[lyrics.data?.source] || "";
    $(".lyrics-source").textContent = lyrics.status === "ok" ? [lyrics.data.synced ? t("Synced") : t("Plain text"), source].filter(Boolean).join(" · ") : "";
    const actions = (extra = "") => `<div class="lyrics-actions">${extra}<button class="btn" data-lyrics="import">${icon("upload_file")} ${t("Import .lrc / .txt")}</button></div>`;

    const html = {
      idle: "",
      loading: `<div class="lyrics-msg"><div class="spinner"></div><p>${t("Looking for lyrics…")}</p></div>`,
      none: `<div class="lyrics-msg">${icon("lyrics")}<h3>${t("No lyrics found")}</h3><p>${t("Nothing matched this song. You can add them yourself.")}</p>${actions(`<button class="btn" data-lyrics="retry">${icon("refresh")} ${t("Search again")}</button>`)}</div>`,
      error: `<div class="lyrics-msg">${icon("cloud_off")}<h3>${t("Couldn't reach the lyrics service")}</h3><p>${t("Check your internet connection and try again.")}</p>${actions(`<button class="btn btn-primary" data-lyrics="retry">${icon("refresh")} ${t("Retry")}</button>`)}</div>`,
      disabled: `<div class="lyrics-msg">${icon("lyrics")}<h3>${t("Online lookup is off")}</h3><p>${t("Turning it on sends the song title and artist to lrclib.net to find lyrics.")}</p>${actions(`<button class="btn btn-primary" data-lyrics="enable">${icon("cloud_download")} ${t("Turn on")}</button>`)}</div>`,
    }[lyrics.status];

    if (lyrics.status === "ok") {
      const data = lyrics.data;
      if (data.instrumental) lyricsBody.innerHTML = `<div class="lyrics-msg">${icon("piano")}<h3>${t("Instrumental")}</h3><p>${t("This song has no lyrics.")}</p></div>`;
      else if (data.synced) {
        lyricsBody.innerHTML = `<div class="lyric-lines">${data.synced
          .map((line, i) => `<p class="lyric-line ${line.text ? "" : "gap"}" data-i="${i}" data-t="${line.t}">${esc(line.text) || "♪"}</p>`)
          .join("")}</div>`;
      } else lyricsBody.innerHTML = `<pre class="lyric-plain">${esc(data.plain)}</pre>`;
    } else lyricsBody.innerHTML = html ?? "";
    updateLyricLine(player.getTime().current, true);
  }

  function updateLyricLine(time, jump = false) {
    const lines = lyrics.status === "ok" ? lyrics.data?.synced : null;
    if (!lines || !isOpen(lyricsDrawer)) return;
    let lo = 0;
    let hi = lines.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= time + 0.2) (found = mid), (lo = mid + 1);
      else hi = mid - 1;
    }
    if (found === activeLine) return;
    activeLine = found;
    lyricsBody.querySelectorAll(".lyric-line").forEach((el, i) => {
      el.classList.toggle("active", i === found);
      el.classList.toggle("past", i < found);
    });
    const el = lyricsBody.querySelector(`.lyric-line[data-i="${found}"]`);
    if (el && Date.now() - userScrolledAt > 3500) {
      lyricsBody.scrollTo({ top: el.offsetTop - lyricsBody.clientHeight / 2 + el.clientHeight / 2, behavior: jump ? "auto" : "smooth" });
    }
  }

  lyricsBody.addEventListener("click", async (event) => {
    const line = event.target.closest(".lyric-line");
    if (line) return player.seek(Number(line.dataset.t));
    const action = event.target.closest("[data-lyrics]")?.dataset.lyrics;
    if (action === "retry") ensureLyrics({ force: true });
    if (action === "enable") (setLyricsOnline(true), ensureLyrics({ force: true }));
    if (action === "import") $("#lyrics-file").click();
  });
  $("#lyrics-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    const song = player.state.song;
    if (!file || !song) return;
    try {
      const result = await importLyricsFile(song, file);
      player.refreshSong(result.song);
      lyrics = { songId: song.id, status: "ok", data: result.lyrics };
      drawLyrics();
      toast(t("Lyrics added."), { type: "success" });
    } catch (error) {
      toast(error.message || t("Couldn't read that file."), { type: "error" });
    }
  });

  /* --------------------------------- Render --------------------------------- */

  view.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    const action = button?.dataset.act;
    if (action === "play") player.togglePlay();
    if (action === "prev") player.prev();
    if (action === "next") player.next();
    if (action === "shuffle") player.toggleShuffle();
    if (action === "repeat") player.cycleRepeat();
    if (action === "mute") player.toggleMute();
    if (action === "like" && player.state.song) stats.toggleFavorite(player.state.song.id);
    if (action === "rate") rateMenu(button);
    if (action === "sleep") sleepMenu(button);
  });

  const syncHeart = () => {
    const liked = !!player.state.song && stats.isFavorite(player.state.song.id);
    const heart = $('[data-act="like"]');
    heart.classList.toggle("on", liked);
    heart.setAttribute("aria-pressed", liked);
    heart.setAttribute("aria-label", liked ? t("Unlike") : t("Like"));
    heart.title = liked ? t("Remove from Liked Songs") : t("Add to Liked Songs");
  };

  let renderedSongId = null;
  let renderedQueue = "";
  const renderState = (s) => {
    if (!s.song) return;
    if (s.playing) viz.wake();
    if (renderedSongId !== s.song.id) {
      if (renderedSongId !== null) {
        // Restart the "drop in" animation for the new song.
        view.querySelectorAll(".np-art, .vinyl-wrap").forEach((el) => {
          el.classList.remove("swap");
          void el.offsetWidth;
          el.classList.add("swap");
        });
      }
      renderedSongId = s.song.id;
      loadWave(s.song);
      view.querySelectorAll(".np-cover").forEach((img) => (img.src = s.song.cover));
      $(".np-bg img").src = s.song.cover;
      $(".np-title").textContent = s.song.title;
      $(".np-artist").textContent = displayArtist(s.song.artist);
      $(".dur").textContent = fmtTime(s.song.duration);
      lyrics = { songId: null, status: "idle" };
      lyricsBody.innerHTML = "";
      if (isOpen(lyricsDrawer)) ensureLyrics();
    }
    $(".np-source").textContent = s.source?.name || t("Your library");
    np.style.setProperty("--np-rgb", s.color.join(", "));
    np.classList.toggle("playing", s.playing);
    const playBtn = $(".play-btn");
    playBtn.innerHTML = icon(s.playing ? "pause" : "play_arrow");
    playBtn.setAttribute("aria-label", s.playing ? t("Pause") : t("Play"));

    $('[data-act="shuffle"]').classList.toggle("on", s.shuffle);
    const repeat = $('[data-act="repeat"]');
    repeat.classList.toggle("on", s.repeat !== "off");
    repeat.innerHTML = icon(s.repeat === "one" ? "repeat_one" : "repeat");
    repeat.title = t({ off: "Repeat: off (R)", all: "Repeat: all (R)", one: "Repeat: one (R)" }[s.repeat]);

    $('[data-act="mute"]').innerHTML = icon(s.muted || s.volume === 0 ? "volume_off" : s.volume < 0.5 ? "volume_down" : "volume_up");
    if (!volume.dragging) volume.set(s.muted ? 0 : s.volume);

    const rate = $('[data-act="rate"]');
    rate.textContent = `${s.rate}×`;
    rate.classList.toggle("on", s.rate !== 1);

    const sleep = $('[data-act="sleep"]');
    sleep.classList.toggle("on", !!s.sleep);
    if (s.sleep?.mode === "time") {
      sleep.querySelector(".badge").textContent = fmtTime(Math.max(0, (s.sleep.endsAt - Date.now()) / 1000));
    } else sleep.querySelector(".badge").textContent = s.sleep ? t("1 song") : "";

    syncHeart();

    const signature = s.order.join(",") + "|" + s.pos;
    if (signature !== renderedQueue) {
      renderedQueue = signature;
      $(".queue-list").innerHTML = s.order
        .map((id, pos) => {
          const song = player.getCached(id);
          if (!song) return "";
          const current = pos === s.pos;
          return `<div class="queue-row ${current ? "current" : ""}" data-pos="${pos}" role="button" tabindex="0">
            <span class="q-handle" title="${t("Drag to reorder")}" aria-hidden="true">${icon("drag_indicator")}</span>
            <img src="${song.cover}" alt="">
            <span class="q-text"><strong>${esc(song.title)}</strong><small>${esc(displayArtist(song.artist))}</small></span>
            ${current ? eqBars() : `<em>${fmtTime(song.duration)}</em>`}
            <button class="icon-btn q-remove" data-act="q-remove" aria-label="${esc(t("Remove {title} from the queue", { title: song.title }))}">${icon("close")}</button>
          </div>`;
        })
        .join("");
      $(".queue-count").textContent = `${plural(s.order.length, "song")}${s.pos >= 0 ? ` · ${t("{n} to go", { n: s.order.length - s.pos - 1 })}` : ""}`;
    }
  };
  const renderTime = ({ current, duration }) => {
    if (!armDrag) setArm(duration ? current / duration : 0);
    updateLyricLine(current);
    if (seek.dragging || armDrag) return;
    setProgress(duration ? current / duration : 0);
    $(".cur").textContent = fmtTime(current);
    if (duration) $(".dur").textContent = fmtTime(duration);
  };

  const unsubscribe = [player.subscribe(renderState), player.subscribeTime(renderTime), stats.subscribe(syncHeart)];
  renderState(player.state);
  renderTime(player.getTime());

  return () => {
    unsubscribe.forEach((fn) => fn());
    viz.destroy();
    window.removeEventListener("resize", drawWave);
    document.removeEventListener("keydown", onKey);
  };
}
