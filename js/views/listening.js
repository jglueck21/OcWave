// "Listening stats": totals, a daily/weekly chart, when you listen, and your top songs, artists and albums.
import * as db from "../db.js";
import { t } from "../i18n.js";
import * as player from "../player.js";
import * as stats from "../stats.js";
import { displayArtist, esc, fmtLong, icon, plural } from "../ui.js";

const RANGES = { week: { days: 7, label: "7 days" }, month: { days: 30, label: "30 days" }, all: { days: Infinity, label: "All time" } };
const RANGE_KEY = "ocwave.statsRange";

const dayAgo = (n) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0); // noon avoids daylight-saving edge cases
  date.setDate(date.getDate() - n);
  return date;
};

// Plays and seconds of one song within the last `days` days (or ever).
function songTotals(record, days) {
  if (days === Infinity) return { plays: record.playCount || 0, seconds: record.listenSec || 0 };
  let plays = 0;
  let seconds = 0;
  for (let i = 0; i < days; i++) {
    const day = record.days?.[stats.dayKey(dayAgo(i))];
    if (day) (plays += day.p, (seconds += day.s));
  }
  return { plays, seconds };
}

// The bars of the chart: one per day (7 / 30 days) or per week (all time, last 26 weeks).
function chartBuckets(records, range) {
  const locale = document.documentElement.lang || undefined;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const secondsOn = (date) => records.reduce((sum, r) => sum + (r.days?.[stats.dayKey(date)]?.s || 0), 0);
  const count = RANGES[range].days === Infinity ? 26 : RANGES[range].days;
  const buckets = [];
  for (let i = count - 1; i >= 0; i--) {
    if (range === "all") {
      let seconds = 0;
      for (let d = 0; d < 7; d++) seconds += secondsOn(dayAgo(i * 7 + d));
      buckets.push({ seconds, title: dayMonth.format(dayAgo(i * 7 + 6)), label: i % 5 === 0 ? dayMonth.format(dayAgo(i * 7 + 6)) : "" });
    } else {
      const date = dayAgo(i);
      buckets.push({ seconds: secondsOn(date), title: dayMonth.format(date), label: range === "week" ? weekday.format(date) : i % 5 === 0 ? String(date.getDate()) : "" });
    }
  }
  return buckets;
}

// Consecutive days with listening, ending today (or yesterday, so the streak isn't lost before you listen today).
function currentStreak(records) {
  const listened = (date) => records.some((r) => (r.days?.[stats.dayKey(date)]?.s || 0) >= 30);
  let streak = 0;
  let i = listened(dayAgo(0)) ? 0 : 1;
  for (; listened(dayAgo(i)); i++) streak++;
  return streak;
}

function rankRows(rows, max, render) {
  return rows
    .map((row, i) => `<li>${render(row, i)}<span class="rank-bar" style="--w:${Math.max(4, (row.plays / max) * 100)}%"></span></li>`)
    .join("");
}

export async function render(view) {
  const songs = await db.getAllSongs();
  const byId = new Map(songs.map((song) => [song.id, song]));
  let range = "week";
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (RANGES[saved]) range = saved;
  } catch {
    /* ignore */
  }

  view.innerHTML = `
    <a class="back-link" href="#/library">${icon("arrow_back")} ${t("Library")}</a>
    <header class="page-head">
      <div><h1>${t("Listening stats")}</h1><p class="muted">${t("What you've been listening to")}</p></div>
      <div class="head-actions">
        <div class="seg" role="radiogroup" aria-label="${t("Time range")}">
          ${Object.entries(RANGES).map(([key, r]) => `<button data-range="${key}" role="radio">${t(r.label)}</button>`).join("")}
        </div>
      </div>
    </header>
    <div class="stats-body"></div>`;

  function draw() {
    view.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-checked", b.dataset.range === range));
    const { days } = RANGES[range];
    const records = stats.all().filter((r) => byId.has(r.id));
    const totals = records.map((record) => ({ song: byId.get(record.id), record, ...songTotals(record, days) })).filter((row) => row.plays > 0 || row.seconds >= 1);
    const totalSeconds = totals.reduce((sum, row) => sum + row.seconds, 0);
    const totalPlays = totals.reduce((sum, row) => sum + row.plays, 0);
    const host = view.querySelector(".stats-body");

    if (!totalPlays && !totalSeconds) {
      host.innerHTML = `<div class="empty-state compact"><div class="empty-art">${icon("insights")}</div><h2>${t("Nothing to show yet")}</h2><p>${t("Listen to some music and your stats will appear here.")}</p></div>`;
      return;
    }

    // Top lists
    const topSongs = [...totals].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 5);
    const group = (keyOf, labelOf, coverOf) => {
      const map = new Map();
      for (const row of totals) {
        const key = keyOf(row.song);
        if (!key) continue;
        const entry = map.get(key) || { key, label: labelOf(row.song), cover: coverOf(row.song), plays: 0, seconds: 0 };
        entry.plays += row.plays;
        entry.seconds += row.seconds;
        map.set(key, entry);
      }
      return [...map.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 5);
    };
    const topArtists = group((s) => s.artist, (s) => displayArtist(s.artist), (s) => s.cover);
    const topAlbums = group((s) => s.album && `${s.artist}|${s.album}`, (s) => s.album, (s) => s.cover);

    const buckets = chartBuckets(records, range);
    const peak = Math.max(1, ...buckets.map((b) => b.seconds));
    const hours = Array.from({ length: 24 }, (_, h) => records.reduce((sum, r) => sum + (r.hours?.[h] || 0), 0));
    const hourPeak = Math.max(1, ...hours);
    const bestHour = hours.indexOf(Math.max(...hours));
    const distinct = totals.filter((row) => row.plays > 0).length;

    const card = (value, label, ic) => `<div class="stat-card">${icon(ic)}<strong>${value}</strong><span>${label}</span></div>`;
    const rankCover = (src) => `<img class="t-cover" src="${src}" alt="" loading="lazy">`;

    host.innerHTML = `
      <div class="stat-cards">
        ${card(totalSeconds ? fmtLong(totalSeconds) : "–", t("Listening time"), "schedule")}
        ${card(totalPlays, t("Plays"), "play_circle")}
        ${card(distinct, t("Different songs"), "library_music")}
        ${card(plural(currentStreak(records), "day"), t("Current streak"), "local_fire_department")}
      </div>

      ${
        totalSeconds
          ? `<section class="panel">
        <h2>${range === "all" ? t("Listening time per week") : t("Listening time per day")}</h2>
        <div class="bars-chart ${range === "month" ? "dense" : ""}" role="img" aria-label="${esc(t("Listening time per day"))}">
          ${buckets
            .map((b) => `<div class="bar-col" title="${esc(`${b.title}: ${fmtLong(b.seconds)}`)}"><i style="--h:${((b.seconds / peak) * 100).toFixed(1)}"></i><span>${esc(b.label)}</span></div>`)
            .join("")}
        </div>
        <p class="muted stats-note">${t("The daily history starts on the day this feature was added.")}</p>
      </section>`
          : ""
      }

      <div class="stats-grid">
        <section class="panel">
          <h2>${t("Top songs")}</h2>
          <ol class="rank-list" data-kind="songs">
            ${rankRows(topSongs, topSongs[0]?.plays || 1, (row, i) => `
              <button class="rank-row" data-song="${row.song.id}"><b>${i + 1}</b>${rankCover(row.song.cover)}
                <span class="rank-text"><strong>${esc(row.song.title)}</strong><small>${esc(displayArtist(row.song.artist))}</small></span>
                <span class="rank-count">${plural(row.plays, "play")}</span></button>`)}
          </ol>
        </section>
        <section class="panel">
          <h2>${t("Top artists")}</h2>
          <ol class="rank-list">
            ${rankRows(topArtists, topArtists[0]?.plays || 1, (row, i) => `
              <div class="rank-row"><b>${i + 1}</b>${rankCover(row.cover)}
                <span class="rank-text"><strong>${esc(row.label)}</strong></span>
                <span class="rank-count">${plural(row.plays, "play")}</span></div>`)}
          </ol>
        </section>
        ${
          topAlbums.length
            ? `<section class="panel">
          <h2>${t("Top albums")}</h2>
          <ol class="rank-list">
            ${rankRows(topAlbums, topAlbums[0].plays || 1, (row, i) => `
              <div class="rank-row"><b>${i + 1}</b>${rankCover(row.cover)}
                <span class="rank-text"><strong>${esc(row.label)}</strong></span>
                <span class="rank-count">${plural(row.plays, "play")}</span></div>`)}
          </ol>
        </section>`
            : ""
        }
        ${
          hours.some(Boolean)
            ? `<section class="panel">
          <h2>${t("When you listen")}</h2>
          <div class="bars-chart hours" role="img" aria-label="${esc(t("When you listen"))}">
            ${hours.map((s, h) => `<div class="bar-col" title="${esc(`${h}:00 · ${fmtLong(s)}`)}"><i style="--h:${((s / hourPeak) * 100).toFixed(1)}"></i><span>${h % 6 === 0 ? h : ""}</span></div>`).join("")}
          </div>
          <p class="muted stats-note">${t("Most listening around {hour}:00 (all time).", { hour: bestHour })}</p>
        </section>`
            : ""
        }
      </div>`;
  }

  view.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (button) {
      range = button.dataset.range;
      try {
        localStorage.setItem(RANGE_KEY, range);
      } catch {
        /* ignore */
      }
      return draw();
    }
    const row = event.target.closest("[data-song]");
    if (row) {
      const ids = [...view.querySelectorAll("[data-kind=songs] [data-song]")].map((r) => Number(r.dataset.song));
      player.playQueue(ids, { start: ids.indexOf(Number(row.dataset.song)), source: { type: "collection", name: t("Top songs") } });
    }
  });
  draw();
}
