// Smart collections built from the song statistics: Liked Songs, Recently played, Most played.
import * as db from "../db.js";
import { t } from "../i18n.js";
import * as stats from "../stats.js";
import { icon, fmtLong, plural } from "../ui.js";
import { detailHeader, mountDetail, notFound } from "./browse.js";
import { COLLECTIONS, collectionSongs } from "./library.js";

export async function render(view, { kind }) {
  const info = COLLECTIONS[kind];
  if (!info) return notFound(view, t("Library"), "#/library");
  let all = await db.getAllSongs();
  const songs = () => collectionSongs(kind, all);

  const drawHeader = () => {
    const list = songs();
    const total = list.reduce((sum, song) => sum + (song.duration || 0), 0);
    view.innerHTML =
      detailHeader({
        back: { href: "#/library", label: t("Library") },
        eyebrow: t("Collection"),
        title: t(info.title),
        meta: list.length ? `${plural(list.length, "song")} · ${fmtLong(total)}` : t("No songs yet"),
        cover: list[0]?.cover,
        coverHtml: `<div class="coll-art big ${kind}">${icon(info.icon)}</div>`,
      }) +
      `<div class="tracks" role="list"></div>
       <div class="empty-host">${list.length ? "" : `<div class="empty-state compact"><div class="empty-art">${icon(info.icon)}</div><h2>${t("Nothing here yet")}</h2><p>${t(info.empty)}</p></div>`}</div>`;
  };
  drawHeader();

  let destroy = mountDetail(view, { getSongs: songs, source: () => ({ type: "collection", name: t(info.title) }) });

  // Un-liking a song (or listening to something new) changes what belongs here: rebuild after the change.
  let timer;
  const stop = stats.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      destroy();
      all = await db.getAllSongs();
      drawHeader();
      destroy = mountDetail(view, { getSongs: songs, source: () => ({ type: "collection", name: t(info.title) }) });
    }, 250);
  });

  return () => {
    clearTimeout(timer);
    stop();
    destroy();
  };
}
