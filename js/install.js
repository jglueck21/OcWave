// "Add to Home Screen" support. Safari can delete a website's stored data (including the whole song library)
// after about a week without a visit, but an installed Home Screen app is exempt, so the app asks people on
// phones to install it once they have a library.
const KEY = "ocwave.installHint";
let deferred = null; // Chrome/Android's install prompt, when the browser offers one

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event;
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  dismiss();
});

export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

// "ios" (iPhone, iPad, including iPadOS which reports itself as a Mac), "android", or null for everything else.
export function platform() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return null;
}

const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function dismiss() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export const shouldHint = () => !!platform() && !isStandalone() && !dismissed();
export const canPrompt = () => !!deferred;

// Shows the browser's own install dialog (Chrome/Android). Resolves true when the person accepted.
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome === "accepted";
}
