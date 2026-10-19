// Small UI toolkit: escaping, toasts, dialogs, popup menus, sliders.
import { plural as pluralForm, t } from "./i18n.js";

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const icon = (name, cls = "") => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;

export function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtLong(seconds) {
  if (seconds > 0 && seconds < 60) return t("{n} sec", { n: Math.round(seconds) });
  const minutes = Math.round((seconds || 0) / 60);
  if (minutes < 60) return t("{n} min", { n: minutes });
  return t("{h} hr {m} min", { h: Math.floor(minutes / 60), m: minutes % 60 });
}

// "3 songs" in the current language (see i18n.js).
export const plural = pluralForm;

// Songs without an artist tag store the English placeholder; show it in the user's language.
export const displayArtist = (artist) => (artist === "Unknown artist" ? t("Unknown artist") : artist);
// ...and the reverse, when the user edits the artist field.
export const storeArtist = (text) => (!text || text === t("Unknown artist") ? "Unknown artist" : text);

export function fmtBytes(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function html(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

/* -------------------------------- Toasts -------------------------------- */

export function toast(message, { type = "info", action, duration = 4200 } = {}) {
  let stack = document.querySelector(".toasts");
  if (!stack) {
    stack = html('<div class="toasts" role="status" aria-live="polite"></div>');
    document.body.appendChild(stack);
  }
  const symbol = { info: "info", success: "check_circle", error: "error" }[type] || "info";
  const node = html(`<div class="toast ${type}">${icon(symbol)}<span class="toast-msg"></span></div>`);
  node.querySelector(".toast-msg").textContent = message;
  stack.appendChild(node);

  let timer;
  const close = () => {
    clearTimeout(timer);
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 250);
  };
  if (action) {
    const button = html(`<button class="toast-action">${esc(action.label)}</button>`);
    button.addEventListener("click", () => {
      action.onClick?.();
      close();
    });
    node.appendChild(button);
  }
  if (duration) timer = setTimeout(close, duration);
  return {
    update(text) {
      node.querySelector(".toast-msg").textContent = text;
    },
    close,
  };
}

/* -------------------------------- Dialogs -------------------------------- */

// fields: [{ name, label, value, placeholder, required }]. Resolves with { name: value } or null when cancelled.
export function formDialog({ title, message = "", fields = [], submitText = t("Save"), cancelText = t("Cancel"), danger = false }) {
  if (document.querySelector(".overlay:not(.leaving)")) return Promise.resolve(null); // never stack dialogs
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = html(`
      <div class="overlay">
        <form class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <h2>${esc(title)}</h2>
          ${message ? `<p class="dialog-msg">${esc(message)}</p>` : ""}
          ${fields
            .map(
              (f) => `<label class="field"><span>${esc(f.label)}</span>
                <input name="${esc(f.name)}" value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder ?? "")}" ${f.required ? "required" : ""} autocomplete="off" maxlength="120"></label>`
            )
            .join("")}
          <div class="dialog-actions">
            <button type="button" class="btn" data-cancel>${esc(cancelText)}</button>
            <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(submitText)}</button>
          </div>
        </form>
      </div>`);
    const form = overlay.querySelector("form");

    const finish = (result) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.add("leaving");
      setTimeout(() => overlay.remove(), 150);
      previousFocus?.focus?.();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(null);
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      for (const key in values) values[key] = String(values[key]).trim();
      finish(values);
    });
    form.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    const first = form.querySelector("input");
    (first || form.querySelector("[type=submit]")).focus();
    first?.select();
  });
}

// Lets the user pick one entry from a list. items: [{ id, label, sub, icon }]. Resolves with the id or null.
export function listDialog({ title, message = "", items, cancelText = t("Cancel") }) {
  if (document.querySelector(".overlay:not(.leaving)")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = html(`
      <div class="overlay">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <h2>${esc(title)}</h2>
          ${message ? `<p class="dialog-msg">${esc(message)}</p>` : ""}
          <div class="pick-list">
            ${items
              .map(
                (item, i) => `<button class="pick-item" data-i="${i}">
                  ${item.icon ? `<span class="pick-icon">${icon(item.icon)}</span>` : ""}
                  <span><strong>${esc(item.label)}</strong>${item.sub ? `<small>${esc(item.sub)}</small>` : ""}</span>
                </button>`
              )
              .join("")}
          </div>
          <div class="dialog-actions"><button type="button" class="btn" data-cancel>${esc(cancelText)}</button></div>
        </div>
      </div>`);
    const finish = (result) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.add("leaving");
      setTimeout(() => overlay.remove(), 150);
      previousFocus?.focus?.();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === "Escape") (event.stopPropagation(), finish(null));
    };
    overlay.addEventListener("click", (event) => {
      const pick = event.target.closest(".pick-item");
      if (pick) finish(items[Number(pick.dataset.i)].id);
      else if (event.target === overlay || event.target.closest("[data-cancel]")) finish(null);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector(".pick-item, [data-cancel]").focus();
  });
}

export const confirmDialog = (options) => formDialog({ submitText: t("Confirm"), ...options, fields: [] }).then(Boolean);

/* ---------------------------------- Menu ---------------------------------- */

// items: [{ label, icon, onClick, danger }] or the string "sep".
export function openMenu(anchor, items) {
  document.querySelector(".menu")?.remove();
  const menu = html(`<div class="menu" role="menu"></div>`);
  items.forEach((item) => {
    if (item === "sep") return menu.appendChild(html('<div class="menu-sep"></div>'));
    const button = html(
      `<button class="menu-item ${item.danger ? "danger" : ""}" role="menuitem">${item.icon ? icon(item.icon) : ""}<span>${esc(item.label)}</span></button>`
    );
    button.addEventListener("click", () => {
      close();
      item.onClick();
    });
    menu.appendChild(button);
  });
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: w, offsetHeight: h } = menu;
  const left = Math.min(Math.max(8, rect.right - w), window.innerWidth - w - 8);
  const top = rect.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : rect.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector("button")?.focus({ preventScroll: true });

  function close() {
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    menu.remove();
    anchor.focus?.({ preventScroll: true });
  }
  function onOutside(event) {
    if (!menu.contains(event.target)) close();
  }
  function onKey(event) {
    if (event.key === "Escape") return event.stopPropagation(), close();
    const buttons = [...menu.querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") (event.preventDefault(), buttons[(i + 1) % buttons.length].focus());
    if (event.key === "ArrowUp") (event.preventDefault(), buttons[(i - 1 + buttons.length) % buttons.length].focus());
  }
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
  });
  return close;
}

/* --------------------------------- Slider --------------------------------- */

// Pointer + keyboard slider on a `.slider` element. Values are fractions between 0 and 1.
export function bindSlider(element, { onInput, onCommit, step = 0.05 }) {
  let dragging = false;
  const fractionAt = (event) => {
    const rect = element.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  element.addEventListener("pointerdown", (event) => {
    dragging = true;
    element.classList.add("dragging");
    element.setPointerCapture(event.pointerId);
    onInput?.(fractionAt(event));
  });
  element.addEventListener("pointermove", (event) => {
    if (dragging) onInput?.(fractionAt(event));
  });
  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove("dragging");
    onCommit?.(fractionAt(event));
  };
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", () => {
    dragging = false;
    element.classList.remove("dragging");
  });
  element.addEventListener("keydown", (event) => {
    const current = Number(element.getAttribute("aria-valuenow") || 0) / 100;
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onCommit?.(Math.min(1, Math.max(0, current + delta)));
  });
  return {
    get dragging() {
      return dragging;
    },
    set(fraction) {
      const percent = Math.round(fraction * 1000) / 10;
      element.style.setProperty("--p", `${percent}%`);
      element.setAttribute("aria-valuenow", Math.round(percent));
    },
  };
}

export const eqBars = () => '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
