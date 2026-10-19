// Multi-select for song lists: a mode where rows get checkmarks and a bar with bulk actions appears.
import { t } from "../i18n.js";
import { esc, icon } from "../ui.js";

/**
 * host: the .tracks element. getSongs(): the songs currently shown, in order.
 * bulkActions(songs): [{ label, icon, danger?, run(songs) }] — run may return false to stay in selection mode.
 */
export function createSelection({ host, getSongs, bulkActions }) {
  const selected = new Set();
  let active = false;
  let bar = null;

  const chosen = () => getSongs().filter((song) => selected.has(song.id));

  function sync() {
    host.classList.toggle("selecting", active);
    host.querySelectorAll(".track").forEach((row) => {
      const on = selected.has(Number(row.dataset.id));
      row.classList.toggle("selected", on);
      row.setAttribute("aria-selected", active ? on : "");
    });
    if (!bar) return;
    const count = selected.size;
    bar.querySelector(".sel-count").textContent = t("{n} selected", { n: count });
    // Rebuilt on every change because some labels depend on the selection (e.g. Like / Unlike).
    bar.querySelector(".sel-actions").innerHTML = bulkActions(chosen())
      .map((a, i) => `<button class="sel-btn ${a.danger ? "danger" : ""}" data-sel-action="${i}" ${count ? "" : "disabled"}>${icon(a.icon)}<span>${esc(a.label)}</span></button>`)
      .join("");
    const all = getSongs();
    bar.querySelector("[data-sel-all]").textContent = count && count === all.length ? t("Select none") : t("Select all");
  }

  function enter(id) {
    if (active) return id != null && toggle(id);
    active = true;
    if (id != null) selected.add(id);
    bar = document.createElement("div");
    bar.className = "sel-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("Selection"));
    bar.innerHTML = `
      <div class="sel-info"><strong class="sel-count"></strong><button class="chip-btn" data-sel-all></button></div>
      <div class="sel-actions"></div>
      <button class="icon-btn" data-sel-done aria-label="${esc(t("Done"))}" title="${esc(t("Done"))}">${icon("close")}</button>`;
    bar.addEventListener("click", async (event) => {
      if (event.target.closest("[data-sel-done]")) return exit();
      if (event.target.closest("[data-sel-all]")) {
        const all = getSongs();
        if (selected.size === all.length) selected.clear();
        else all.forEach((song) => selected.add(song.id));
        return sync();
      }
      const button = event.target.closest("[data-sel-action]");
      if (!button) return;
      const songs = chosen();
      const keep = await bulkActions(songs)[Number(button.dataset.selAction)].run(songs);
      if (keep !== false) exit();
    });
    document.body.appendChild(bar);
    document.addEventListener("keydown", onKey);
    sync();
  }

  function exit() {
    active = false;
    selected.clear();
    bar?.remove();
    bar = null;
    document.removeEventListener("keydown", onKey);
    sync();
  }

  function toggle(id) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    sync();
  }

  const onKey = (event) => event.key === "Escape" && !document.querySelector(".menu, dialog[open], .dialog") && exit();

  return {
    get active() {
      return active;
    },
    enter,
    exit,
    sync,
    // Call at the top of a row click handler: returns true when the click was used to (un)select a row.
    handleClick(event) {
      if (!active) return false;
      const row = event.target.closest(".track");
      if (!row) return false;
      toggle(Number(row.dataset.id));
      return true;
    },
    destroy: exit,
  };
}
