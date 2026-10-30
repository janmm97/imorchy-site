// Which files under site/ deploy.mjs uploads, and with which Content-Type. Kept here (worker/ is never uploaded)
// so worker/test-deploy.mjs can check the list without running the deploy. A file whose extension has no TYPES
// entry is skipped, so it 404s live while serve.mjs still shows it locally: add the type here too.
import fs from "node:fs";
import path from "node:path";

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
};
// Only the page's own files go up: never the deploy script, the preview server or the README.
export const SKIP = new Set(["deploy.mjs", "serve.mjs", "README.md"]);

// Every file to upload, as { rel, source, data, type }. `overrides` maps a rel path to another file to send instead.
export function siteFiles(site, overrides = {}, dir = site) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(site, full).split(path.sep).join("/");
    if (entry.isDirectory()) return rel === "worker" || entry.name === "node_modules" ? [] : siteFiles(site, overrides, full);
    if (SKIP.has(rel) || !TYPES[path.extname(rel)]) return [];
    const source = overrides[rel] ? path.resolve(overrides[rel]) : full;
    const data = fs.readFileSync(source);
    return [{ rel, source, data, type: TYPES[path.extname(rel)] }];
  });
}
