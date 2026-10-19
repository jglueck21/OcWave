// Persistent mini player shown above the content on every view except the full player.
import * as player from "../player.js";
import { t } from "../i18n.js";
import * as stats from "../stats.js";
import { bindSlider, displayArtist, fmtTime, icon } from "../ui.js";

export function mountMini(container) {
  container.innerHTML = `
    <a class="mini-info" href="#/player" aria-label="${t("Open player")}">
      <img class="mini-cover" alt="">
      <span class="mini-text"><strong class="mini-title"></strong><small class="mini-artist"></small></span>
    </a>
    <div class="mini-controls">
      <button class="icon-btn heart" data-act="like" aria-label="${t("Like")}" aria-pressed="false">${icon("favorite")}</button>
      <button class="icon-btn" data-act="prev" aria-label="${t("Previous")}">${icon("skip_previous")}</button>
      <button class="icon-btn play-btn" data-act="play" aria-label="${t("Play")}">${icon("play_arrow")}</button>
      <button class="icon-btn" data-act="next" aria-label="${t("Next")}">${icon("skip_next")}</button>
    </div>
    <div class="mini-time"><span class="cur">0:00</span><span>/</span><span class="dur">0:00</span></div>
    <div class="slider mini-seek" role="slider" tabindex="0" aria-label="${t("Seek")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="fill"></div><div class="thumb"></div>
    </div>`;

  const $ = (sel) => container.querySelector(sel);
  const seek = bindSlider($(".mini-seek"), {
    step: 0.03,
    onInput: (f) => seek.set(f),
    onCommit: (f) => player.seek(f * player.getTime().duration),
  });

  container.addEventListener("click", (event) => {
    const action = event.target.closest("[data-act]")?.dataset.act;
    if (action === "play") player.togglePlay();
    if (action === "prev") player.prev();
    if (action === "next") player.next();
    if (action === "like" && player.state.song) stats.toggleFavorite(player.state.song.id);
  });

  const renderState = (state) => {
    container.classList.toggle("has-song", !!state.song);
    container.style.setProperty("--np-rgb", state.color.join(", "));
    if (!state.song) return;
    $(".mini-cover").src = state.song.cover;
    $(".mini-title").textContent = state.song.title;
    $(".mini-artist").textContent = displayArtist(state.song.artist);
    const playBtn = $(".play-btn");
    playBtn.innerHTML = icon(state.playing ? "pause" : "play_arrow");
    playBtn.setAttribute("aria-label", state.playing ? t("Pause") : t("Play"));
    renderHeart();
  };
  const renderHeart = () => {
    const liked = !!player.state.song && stats.isFavorite(player.state.song.id);
    $(".heart").classList.toggle("on", liked);
    $(".heart").setAttribute("aria-pressed", liked);
    $(".heart").setAttribute("aria-label", liked ? t("Unlike") : t("Like"));
  };
  const renderTime = ({ current, duration }) => {
    if (!seek.dragging) seek.set(duration ? current / duration : 0);
    $(".cur").textContent = fmtTime(current);
    $(".dur").textContent = fmtTime(duration);
  };

  player.subscribe(renderState);
  stats.subscribe(renderHeart);
  player.subscribeTime(renderTime);
  renderState(player.state);
  renderTime(player.getTime());
}
