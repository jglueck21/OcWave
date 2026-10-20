// Copies the web app (the folder above) into desktop/app, which is what gets packaged.
// desktop/app is generated: edit the web app in the project root, never in here.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const target = path.resolve(__dirname, "..", "app");
const include = ["index.html", "manifest.webmanifest", "css", "js", "assets"];
// Files that belong to the repository but not to the app.
const skip = new Set(["build-icons.py", "README.md"]);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const name of include) {
  fs.cpSync(path.join(root, name), path.join(target, name), {
    recursive: true,
    filter: (source) => !skip.has(path.basename(source)) && path.basename(source) !== ".DS_Store",
  });
}
// The service worker is not used in the desktop app (everything is already local), so it is not copied.
console.log("Copied the web app to", path.relative(process.cwd(), target) || target);
