// OcWave desktop shell (Electron): opens the web app in its own window.
// The app is served from a custom "app://ocwave" address instead of file://, because ES modules, fetch and
// IndexedDB need a proper (secure) origin, and the origin must stay the same so the music library persists.
const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.join(__dirname, "app");
const ORIGIN = "app://ocwave";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Media keys (play/pause/next on the keyboard) go through the Media Session the web app already sets up.
app.commandLine.appendSwitch("enable-features", "HardwareMediaKeyHandling,MediaSessionService");

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "OcWave",
    backgroundColor: "#07080b",
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required", // songs may start from the media keys without a click
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(`${ORIGIN}/index.html`);

  // Links that leave the app (e.g. "Source code", downloads) open in the normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on("closed", () => (mainWindow = null));
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const file = path.normalize(path.join(ROOT, relative));
    if (!file.startsWith(ROOT + path.sep)) return new Response("Forbidden", { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  buildMenu();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
