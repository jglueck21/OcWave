// Tiny translation layer. The English text itself is the key: t("Add songs") returns the English text, or the
// translation if the current language has one. Translations live in js/locales/<code>.js.
const STORAGE_KEY = "ocwave.lang";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "ja", label: "日本語" },
  { code: "fr", label: "Français" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "pt", label: "Português (Portugal)" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ko", label: "한국어" },
  { code: "tr", label: "Türkçe" },
  { code: "ru", label: "Русский" },
  { code: "nl", label: "Nederlands" },
];

let current = "en";
let strings = {};
let plurals = {};

export const getLang = () => current;

// "auto" follows the browser language; otherwise one of LANGUAGES.
export function getPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "auto";
  } catch {
    return "auto";
  }
}

export function setPreference(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable */
  }
}

function detect() {
  const find = (wanted) => LANGUAGES.find((language) => language.code.toLowerCase() === wanted)?.code;
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const full = String(tag).toLowerCase();
    const base = full.split("-")[0];
    // Two Portuguese files: a plain "pt" or "pt-BR" gets Brazilian, any other region (pt-PT, pt-AO…) European.
    if (base === "pt") return full === "pt" || full === "pt-br" ? "pt-BR" : "pt";
    // Chinese: Traditional for Taiwan, Hong Kong, Macau and zh-Hant, Simplified for everything else.
    if (base === "zh") return /-(tw|hk|mo|hant)\b/.test(full) ? "zh-TW" : "zh-CN";
    if (find(full)) return find(full);
    if (find(base)) return find(base);
  }
  return "en";
}

// Japanese and Chinese need their own web font (Inter has no CJK glyphs and system fonts vary).
const CJK_FONTS = { ja: "Noto+Sans+JP", "zh-CN": "Noto+Sans+SC", "zh-TW": "Noto+Sans+TC", ko: "Noto+Sans+KR" };
function loadCjkFont(family) {
  const link = Object.assign(document.createElement("link"), {
    rel: "stylesheet",
    href: `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;700;800&display=swap`,
  });
  document.head.appendChild(link);
}

// Loads the language files and translates the static text in index.html. Call once before rendering.
export async function init() {
  const preference = getPreference();
  current = preference === "auto" ? detect() : preference;
  if (!LANGUAGES.some((language) => language.code === current)) current = "en";
  if (current !== "en") {
    try {
      const locale = await import(`./locales/${current}.js`);
      strings = locale.strings;
      plurals = locale.plurals;
    } catch (error) {
      console.warn(`Language "${current}" could not be loaded, using English.`, error);
      current = "en";
    }
  }
  document.documentElement.lang = current;
  if (CJK_FONTS[current]) loadCjkFont(CJK_FONTS[current]);
  translateStatic();
}

// Text and attributes in index.html marked with data-i18n / data-i18n-attr.
function translateStatic() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.textContent.trim());
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    for (const attribute of element.dataset.i18nAttr.split(",")) {
      element.setAttribute(attribute, t(element.getAttribute(attribute)));
    }
  });
}

// Looks the text up and fills {placeholders}. Unknown text is shown as it is (English).
export function t(text, params) {
  let result = strings[text] ?? text;
  if (params) result = result.replace(/\{(\w+)\}/g, (match, key) => (key in params ? params[key] : match));
  return result;
}

// "3 songs": picks the right plural form for the language. `word` is the English singular.
export function plural(count, word) {
  const forms = plurals[word];
  if (!forms) return `${count} ${word}${count === 1 ? "" : "s"}`;
  const form = forms[new Intl.PluralRules(current).select(count)] ?? forms.other;
  return form.replace("{n}", count);
}

// Locale-aware helpers for dates and sorting.
export const formatDate = (date, options) => date.toLocaleDateString(current, options);
export const collator = () => new Intl.Collator(current, { sensitivity: "base", numeric: true });
