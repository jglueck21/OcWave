import { exportLibrary, importBackup } from "../backup.js";
import * as db from "../db.js";
import * as loudness from "../loudness.js";
import { LANGUAGES, getPreference, setPreference, t } from "../i18n.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import {
  ACCENTS, EQ_BANDS, EQ_PRESETS, RECORDS, getAccent, getCrossfade, getDesign, getEq, getLyricsOnline, getLyricsWords, getMode, getNormalize, getRecord, getSleeve, getVisualizer, getWaveSeek,
  setAccent, setCrossfade, setDesign, setLyricsOnline, setLyricsWords, setMode, setNormalize, setRecord, setSleeve, setVisualizer, setWaveSeek,
} from "../prefs.js";
import { REPO_URL, VERSION } from "../version.js";
import { confirmDialog, esc, fmtBytes, icon, plural, toast } from "../ui.js";

const SHORTCUTS = [
  ["Space", "Play / pause"],
  ["← →", "Seek 5 seconds"],
  ["N / P", "Next / previous song"],
  ["S / R", "Shuffle / repeat"],
  ["M", "Mute"],
  ["Q / L", "Queue / lyrics (player)"],
  ["/", "Search"],
]; // (descriptions are translated where they are shown)

const switchHtml = (id, label, hint) => `
  <div class="setting-row">
    <div><strong>${t(label)}</strong><small>${t(hint)}</small></div>
    <label class="switch"><input type="checkbox" id="${id}" role="switch" aria-label="${esc(t(label))}"><span></span></label>
  </div>`;

export async function render(view) {
  view.innerHTML = `
    <header class="page-head"><div><h1>${t("Settings")}</h1><p class="muted">${t("Make OcWave yours.")}</p></div></header>

    <div class="settings">
      <section class="panel">
        <h2>${t("Appearance")}</h2>
        <div class="setting-row">
          <div>
            <strong>${t("Language")}</strong>
            <small>${t("Translations were written with AI help. If something sounds odd, please tell the developer.")}</small>
          </div>
          <label class="select">${icon("language")}
            <select id="language" aria-label="${t("Language")}">
              <option value="auto">${t("Automatic (system language)")}</option>
              ${[...LANGUAGES].sort((a, b) => a.label.localeCompare(b.label, "en")).map((language) => `<option value="${language.code}">${language.label}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="setting-row">
          <div><strong>${t("Theme")}</strong><small>${t("Light, dark, or follow your device")}</small></div>
          <div class="seg" role="radiogroup" aria-label="${t("Theme")}">
            <button data-mode="system" role="radio">${icon("contrast")}${t("System")}</button>
            <button data-mode="dark" role="radio">${icon("dark_mode")}${t("Dark")}</button>
            <button data-mode="light" role="radio">${icon("light_mode")}${t("Light")}</button>
          </div>
        </div>
        <div class="setting-col">
          <div><strong>${t("Accent color")}</strong><small>${t("Used for buttons, highlights and progress bars")}</small></div>
          <div class="swatches" role="radiogroup" aria-label="${t("Accent color")}">
            ${Object.entries(ACCENTS)
              .map(([key, { label, color }]) => `<button class="swatch" data-accent="${key}" style="--c:${color}" role="radio" aria-label="${t(label)}" title="${t(label)}">${icon("check")}</button>`)
              .join("")}
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>${t("Player design")}</h2>
        <div class="design-options" role="radiogroup" aria-label="${t("Player design")}">
          <button class="design" data-design="cover" role="radio">
            <div class="preview prev-cover"><i class="p-art"></i><i class="p-line"></i><i class="p-line short"></i><i class="p-bar"></i><span class="p-ctrl"><i></i><i class="big"></i><i></i></span></div>
            <strong>${t("Cover")}</strong><small>${t("Large artwork with a glowing backdrop")}</small>
          </button>
          <button class="design" data-design="vinyl" role="radio">
            <div class="preview prev-vinyl"><i class="p-record"><b></b></i><i class="p-arm"></i><i class="p-line"></i><i class="p-line short"></i><i class="p-bar"></i></div>
            <strong>${t("Vinyl")}</strong><small>${t("A spinning record with a tonearm")}</small>
          </button>
        </div>
        <p class="vinyl-hint muted" hidden>${icon("info")} ${t("These options only apply to the Vinyl player.")}</p>
        <div class="setting-col vinyl-options">
          <div><strong>${t("Record style")}</strong><small>${t("Used by the vinyl player and the mini player")}</small></div>
          <div class="record-options" role="radiogroup" aria-label="${t("Record style")}">
            ${Object.entries(RECORDS)
              .map(([key, label]) => `<button class="record-opt" data-record="${key}" role="radio"><span class="rec-preview" data-style="${key}"><b></b></span><small>${t(label)}</small></button>`)
              .join("")}
          </div>
        </div>
        ${switchHtml("sleeve", "Show record sleeve", "Place the cover behind the record like a real sleeve")}
        ${switchHtml("visualizer", "Live visualiser", "Animated frequency bars behind the player")}
        ${switchHtml("waveseek", "Waveform seek bar", "Show the song's waveform on the seek bar")}
      </section>

      <section class="panel">
        <h2>${t("Sound")}</h2>
        ${switchHtml("eq-on", "Equalizer", "Shape the sound with five frequency bands")}
        <div class="eq-presets" role="radiogroup" aria-label="${t("Equalizer preset")}">
          ${Object.entries(EQ_PRESETS).map(([key, p]) => `<button class="chip-btn" data-preset="${key}" role="radio">${t(p.label)}</button>`).join("")}
        </div>
        <div class="eq-bands">
          ${EQ_BANDS.map((band, i) => `
            <label class="eq-band">
              <output data-gain="${i}">0</output>
              <input type="range" class="eq-range" min="-12" max="12" step="1" value="0" data-band="${i}" aria-label="${band}">
              <span>${band}</span>
            </label>`).join("")}
        </div>
        <div class="setting-row">
          <div><strong>${t("Crossfade")}</strong><small>${t("Blend the end of a song into the next one")}</small></div>
          <div class="range-row"><input type="range" id="crossfade" min="0" max="12" step="1" aria-label="${t("Crossfade seconds")}"><output id="crossfade-value"></output></div>
        </div>
        <div class="setting-row">
          <div><strong>${t("Normalise volume")}</strong><small>${t("Evens out loud and quiet songs. Each song is analysed once, in the background.")}</small><small class="norm-status muted" id="norm-status" hidden></small></div>
          <label class="switch"><input type="checkbox" id="normalize" role="switch" aria-label="${esc(t("Normalise volume"))}"><span></span></label>
        </div>
      </section>

      <section class="panel">
        <h2>${t("Lyrics")}</h2>
        ${switchHtml("lyrics-words", "Word-by-word highlighting", "Highlights each word as it is sung. The timing is estimated unless the lyrics file has word timings.")}
        ${switchHtml("lyrics-online", "Find lyrics online", "Looks songs up on lrclib.net (free). Only the title, artist and length are sent, nothing else.")}
      </section>

      <section class="panel">
        <h2>${t("Library & storage")}</h2>
        <div class="storage"><div class="storage-bar"><i style="width:0"></i></div><p class="muted storage-text">${t("Calculating…")}</p></div>
        <div class="setting-row">
          <div><strong>${t("Backup")}</strong><small>${t("Save every song and playlist to one file, or restore from one")}</small></div>
          <div class="btn-row">
            <button class="btn" id="export">${icon("download")} ${t("Export")}</button>
            <button class="btn" id="import">${icon("upload")} ${t("Restore")}</button>
            <input type="file" id="import-file" accept=".ocwave" hidden>
          </div>
        </div>
        <div class="setting-row">
          <div><strong>${t("Delete all data")}</strong><small>${t("Removes every playlist and song from this device")}</small></div>
          <button class="btn btn-danger-outline" id="wipe">${icon("delete_forever")} ${t("Delete everything")}</button>
        </div>
      </section>

      <section class="panel about">
        <h2>${t("Privacy")}</h2>
        <p class="about-text">${t("Everything stays on this device. Your songs, playlists and listening stats are stored in your browser and are never uploaded. OcWave has no accounts, no analytics and no tracking.")}</p>
        <p class="about-text">${t("The only thing that leaves your device is the optional lyrics lookup, which sends a song's title, artist and length to lrclib.net. You can turn it off under Lyrics.")}</p>
      </section>

      <section class="panel about">
        <h2>${t("About")}</h2>
        <div class="setting-row">
          <div><strong>OcWave</strong><small>${t("Version {version}", { version: VERSION })}</small></div>
          <a class="btn" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${icon("code")} ${t("Source code")}</a>
        </div>
      </section>

      <section class="panel">
        <h2>${t("Keyboard shortcuts")}</h2>
        <dl class="shortcuts">${SHORTCUTS.map(([k, d]) => `<div><dt>${k.split(" ").map((x) => (x === "/" && k !== "/" ? "<span>/</span>" : `<kbd>${x}</kbd>`)).join("")}</dt><dd>${t(d)}</dd></div>`).join("")}</dl>
      </section>
    </div>`;

  const $ = (sel) => view.querySelector(sel);

  /* ----------------------------- Appearance ----------------------------- */

  const mark = () => {
    view.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === getMode()));
    view.querySelectorAll("[data-accent]").forEach((b) => b.setAttribute("aria-checked", b.dataset.accent === getAccent()));
    view.querySelectorAll(".design[data-design]").forEach((b) => b.setAttribute("aria-checked", b.dataset.design === getDesign()));
    view.querySelectorAll("[data-record]").forEach((b) => b.setAttribute("aria-checked", b.dataset.record === getRecord()));
    const vinyl = getDesign() === "vinyl";
    $(".vinyl-options").classList.toggle("dim", !vinyl);
    $("#sleeve").closest(".setting-row").classList.toggle("dim", !vinyl);
    $(".vinyl-hint").hidden = vinyl;
    $("#sleeve").checked = getSleeve();
  };

  /* ------------------------------ Equalizer ------------------------------ */

  const drawEq = () => {
    const eq = getEq();
    $("#eq-on").checked = eq.on;
    view.querySelector(".eq-bands").classList.toggle("off", !eq.on);
    view.querySelectorAll("[data-band]").forEach((input, i) => {
      input.value = eq.gains[i];
      $(`[data-gain="${i}"]`).textContent = `${eq.gains[i] > 0 ? "+" : ""}${eq.gains[i]}`;
    });
    view.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-checked", eq.preset === b.dataset.preset));
  };

  const drawCrossfade = () => {
    $("#crossfade").value = getCrossfade();
    $("#crossfade-value").textContent = getCrossfade() ? t("{n} s", { n: getCrossfade() }) : t("Off");
  };

  mark();
  drawEq();
  drawCrossfade();
  $("#lyrics-online").checked = getLyricsOnline();
  $("#lyrics-words").checked = getLyricsWords();
  $("#normalize").checked = getNormalize();
  $("#visualizer").checked = getVisualizer();
  $("#waveseek").checked = getWaveSeek();

  const drawNorm = ({ done, total } = {}) => {
    const status = $("#norm-status");
    if (!status) return;
    status.hidden = !getNormalize();
    if (done == null) return loudness.status().then(drawNorm);
    status.textContent = !total ? "" : done >= total ? t("All songs analysed.") : t("Analysed {done} of {total} songs…", { done, total });
  };
  drawNorm();
  const stopNorm = loudness.subscribe((progress) => (view.isConnected ? drawNorm(progress) : stopNorm()));
  $("#language").value = getPreference();

  view.addEventListener("click", (event) => {
    const clicked = event.target;
    const mode = clicked.closest("[data-mode]")?.dataset.mode;
    const color = clicked.closest("[data-accent]")?.dataset.accent;
    const design = clicked.closest(".design[data-design]")?.dataset.design;
    const record = clicked.closest(".record-opt[data-record]")?.dataset.record;
    const preset = clicked.closest("[data-preset]")?.dataset.preset;
    if (mode) setMode(mode);
    if (color) setAccent(color);
    if (design) {
      setDesign(design);
      toast(design === "vinyl" ? t("Vinyl player selected.") : t("Cover player selected."), { type: "success", duration: 2000 });
    }
    if (record) setRecord(record);
    if (mode || color || design || record) mark();
    if (preset) (player.setEq({ preset }), drawEq());
  });

  view.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-band]")) {
      const gains = [...view.querySelectorAll("[data-band]")].map((input) => Number(input.value));
      player.setEq({ gains, preset: Object.entries(EQ_PRESETS).find(([, p]) => p.gains.every((g, i) => g === gains[i]))?.[0] ?? "custom" });
      drawEq();
    }
    if (target.id === "crossfade") {
      setCrossfade(Number(target.value));
      drawCrossfade();
    }
  });
  view.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "eq-on") (player.setEq({ on: target.checked }), drawEq());
    if (target.id === "sleeve") {
      setSleeve(target.checked);
      if (target.checked && getDesign() !== "vinyl") {
        toast(t("The sleeve is only shown in the Vinyl player."), {
          action: { label: t("Switch"), onClick: () => (setDesign("vinyl"), mark()) },
          duration: 6000,
        });
      }
    }
    if (target.id === "lyrics-online") setLyricsOnline(target.checked);
    if (target.id === "lyrics-words") setLyricsWords(target.checked);
    if (target.id === "visualizer") setVisualizer(target.checked);
    if (target.id === "waveseek") setWaveSeek(target.checked);
    if (target.id === "normalize") {
      setNormalize(target.checked);
      player.applyNormalization();
      drawNorm();
      if (target.checked) loudness.scan(player.state.song?.id);
    }
    if (target.id === "language") {
      setPreference(target.value);
      location.reload(); // simplest way to switch every screen (the player pauses and picks up where it left off)
    }
  });

  /* ------------------------------ Storage & backup ------------------------------ */

  async function drawStorage() {
    const [estimate, songs, playlists] = await Promise.all([db.storageEstimate(), db.getAllSongs(), db.getPlaylists()]);
    const audioBytes = songs.reduce((sum, s) => sum + (s.size || 0), 0);
    $(".storage-text").textContent =
      t("{songs} in {playlists} · {size} of audio", { songs: plural(songs.length, "song"), playlists: plural(playlists.length, "playlist"), size: fmtBytes(audioBytes) }) +
      (estimate?.quota ? ` · ${t("{used} used of {total} available", { used: fmtBytes(estimate.usage), total: fmtBytes(estimate.quota) })}` : "");
    if (estimate?.quota) $(".storage-bar i").style.width = `${Math.max(1, (estimate.usage / estimate.quota) * 100)}%`;
  }
  drawStorage();

  $("#export").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const progress = toast(t("Preparing backup…"), { duration: 0 });
    try {
      const result = await exportLibrary();
      toast(t("Backup saved: {songs}, {playlists}.", { songs: plural(result.songs, "song"), playlists: plural(result.playlists, "playlist") }), { type: "success" });
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message || t("The backup failed."), { type: "error" });
    } finally {
      progress.close();
      button.disabled = false;
    }
  });

  $("#import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    const progress = toast(t("Restoring…"), { duration: 0 });
    try {
      const result = await importBackup(file, (done, total) => progress.update(t("Restoring song {i} of {n}…", { i: done, n: total })));
      toast(t("Restored {playlists} and {songs}", { playlists: plural(result.playlists, "playlist"), songs: plural(result.songs, "new song") }) + (result.reused ? ` (${t("{n} already existed", { n: result.reused })})` : "") + t("."), { type: "success", duration: 6000 });
      drawStorage();
      loudness.kick();
    } catch (error) {
      toast(error.message || t("The backup couldn't be restored."), { type: "error" });
    } finally {
      progress.close();
    }
  });

  $("#wipe").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("Delete all data?"),
      message: t("Every playlist and song stored in this browser will be removed. This can't be undone. Consider exporting a backup first."),
      submitText: t("Delete everything"),
      danger: true,
    });
    if (!ok) return;
    player.clear();
    await db.wipeAll();
    stats.reset();
    toast(t("All data deleted."));
    drawStorage();
  });
}
