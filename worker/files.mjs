// Which files under site/ deploy.mjs uploads, and with which Content-Type. Kept here (worker/ is never uploaded)
// so worker/test-deploy.mjs can check the list without running the deploy. A file whose extension has no TYPES
// entry is skipped, so it 404s live while serve.mjs still shows it locally: add the type here too.
import fs from "node:fs";
import path from "node:path";

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
// Only the page's own files go up: never the deploy script, the preview server, the content build or the README.
export const SKIP = new Set(["deploy.mjs", "serve.mjs", "build.mjs", "README.md", ".gitignore"]);
// Folders that never go up: the repo's own .git and .github, the Worker's own code, and the sources build.mjs turns into pages (content/).
export const SKIP_DIRS = new Set(["worker", "content", ".git", ".github"]);
export const skipDir = (rel, name) => SKIP_DIRS.has(rel) || name === "node_modules";
// Videos are git-ignored and too big for static assets (25 MiB per file), so they're never uploaded: the Worker
// serves them from the R2 bucket bound as MEDIA, under the same path (assets/video.mp4). serve.mjs reads the file
// on disk for the local preview. The redesign gives each clip a .webm next to its .mp4: both come from R2.
export const IN_R2 = new Set([".mp4", ".webm"]);
/** The Content-Type for a video in R2 when its object has none set at upload. */
export const VIDEO_TYPES = { ".mp4": "video/mp4", ".webm": "video/webm" };
export const MEDIA_BUCKET = "orchy-site-media";

// Every file to upload, as { rel, data, type }.
export function siteFiles(site, dir = site) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(site, full).split(path.sep).join("/");
    if (entry.isDirectory()) return skipDir(rel, entry.name) ? [] : siteFiles(site, full);
    if (SKIP.has(rel) || IN_R2.has(path.extname(rel)) || !TYPES[path.extname(rel)]) return [];
    return [{ rel, data: fs.readFileSync(full), type: TYPES[path.extname(rel)] }];
  });
}

// Cloudflare Web Analytics. The pages carry the tag without its site token, which stays out of git (Jan,
// 2026-11-18): deploy.mjs adds it from CF_BEACON_TOKEN. With no token the tag is dropped (the preview), since the
// beacon does nothing without one.
export const BEACON = '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script>';
export function withBeacon(html, token) {
  if (token && !/^[0-9a-f]{32}$/.test(token)) throw new Error("CF_BEACON_TOKEN is not a 32-hex Web Analytics token.");
  const tag = token ? BEACON.replace("></script>", ` data-cf-beacon='{"token":"${token}"}'></script>`) : "";
  return html.replaceAll(BEACON, tag);
}
