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
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
// Only the page's own files go up: never the deploy script, the preview server, the content build or the README.
// (.git is a file, not a folder, in a git worktree.)
export const SKIP = new Set(["deploy.mjs", "serve.mjs", "build.mjs", "README.md", ".gitignore", ".git"]);
// Folders that never go up: the repo's own .git and .github, the Worker's own code, and the sources build.mjs turns into pages (content/).
export const SKIP_DIRS = new Set(["worker", "content", ".git", ".github"]);
export const skipDir = (rel, name) => SKIP_DIRS.has(rel) || name === "node_modules";
// The launch video (assets/*.mp4) is git-ignored and too big for static assets (25 MiB per file), so it's never
// uploaded: the Worker serves it from the R2 bucket bound as MEDIA, under the same path. serve.mjs reads the file on
// disk for the local preview. The homepage's short loops (media/*.mp4, *.webm, a few MB each) are in git and go up
// as static assets; the Worker adds the byte ranges Safari needs (main.mjs).
export const inR2 = (rel) => /^assets\/[^/]+\.mp4$/.test(rel);
export const MEDIA_BUCKET = "orchy-site-media";

// Every file to upload, as { rel, data, type }.
export function siteFiles(site, dir = site) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(site, full).split(path.sep).join("/");
    if (entry.isDirectory()) return skipDir(rel, entry.name) ? [] : siteFiles(site, full);
    if (SKIP.has(rel) || inR2(rel) || !TYPES[path.extname(rel)]) return [];
    return [{ rel, data: fs.readFileSync(full), type: TYPES[path.extname(rel)] }];
  });
}
