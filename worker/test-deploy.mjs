// Offline checks for what deploy.mjs uploads and how Cloudflare routes it: every file of the site (and every file a
// page, the CSS or a script points at) has a Content-Type in files.mjs, so it goes up; and run_worker_first
// (routes.mjs) sends pages and videos to the Worker but every static file straight to the assets. serve.mjs knows its
// own types, so the local preview can't catch a gap here. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKIP, TYPES, siteFiles } from "./files.mjs";
import { RUN_WORKER_FIRST } from "./routes.mjs";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ok = (name) => console.log(`ok - ${name}`);

// Every file on disk under site/, the way a person sees the folder: not the Worker, packages or the tooling.
const onDisk = (dir = SITE) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(SITE, full).split(path.sep).join("/");
    if (entry.isDirectory()) return rel === "worker" || entry.name === "node_modules" ? [] : onDisk(full);
    return SKIP.has(rel) ? [] : [rel];
  });
const files = onDisk();
const deployed = new Set(siteFiles(SITE).map((f) => f.rel));

// ── (a) deploy.mjs uploads every file of the site ──
for (const rel of files) assert.ok(deployed.has(rel), `deploy.mjs would skip site/${rel}: add "${path.extname(rel)}" to TYPES in worker/files.mjs`);
for (const dir of ["assets", "js", "fonts"]) assert.ok(files.some((f) => f.startsWith(dir + "/")), `site/${dir} has files`);
ok(`deploy.mjs uploads all ${files.length} files of the site (assets, js, fonts, pages, sitemap, robots.txt)`);

// Every local file a page, the stylesheet or a script names is uploaded too (the video is local-only: git-ignored).
const LOCAL = /(?:https:\/\/imorchy\.dev)?\/?((?:assets|fonts|js)\/[\w./-]+\.\w+|styles\.css|favicon\.svg)/g;
const sources = files.filter((f) => /\.(html|css|mjs)$/.test(f));
let refs = 0;
for (const src of sources) {
  for (const [, ref] of fs.readFileSync(path.join(SITE, src), "utf8").matchAll(LOCAL)) {
    if (ref.endsWith(".mp4")) continue;
    refs++;
    assert.ok(deployed.has(ref), `site/${src} points at ${ref}, which deploy.mjs doesn't upload`);
  }
}
assert.ok(refs > 20, `found the pages' local references (${refs})`);
assert.equal(TYPES[".webp"], "image/webp");
ok(`all ${refs} local files named by the pages, CSS and scripts are uploaded, .webp as image/webp`);

// ── (b) run_worker_first, read the way Cloudflare does: `*` matches across "/", a "!" rule beats any positive one ──
const glob = (p) => new RegExp("^" + p.split(/\*+/).map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
const workerFirst = (p) =>
  RUN_WORKER_FIRST.some((r) => !r.startsWith("!") && glob(r).test(p)) &&
  !RUN_WORKER_FIRST.some((r) => r.startsWith("!") && glob(r.slice(1)).test(p));
const ANSWER_PAGES = ["/approvals", "/client-workspaces", "/claude-code-orchestrator", "/local"];
for (const p of ["/", ...ANSWER_PAGES, "/sitemap.xml", "/robots.txt", "/assets/video.mp4", "/googlec22430d134477d04.html"])
  assert.ok(workerFirst(p), `${p} should reach the Worker`);
for (const p of ["/styles.css", "/js/main.mjs", "/fonts/JetBrainsMono-Bold.woff2", "/assets/orchy-main.svg", "/assets/logos/tools/github.svg", "/assets/og-image.png", "/assets/orchy-main-500.webp", "/favicon.svg"])
  assert.ok(!workerFirst(p), `${p} should skip the Worker`);
// Every file on disk: root pages (.html, .xml, .txt) and videos reach the Worker, every other file skips it.
const page = (rel) => (!rel.includes("/") && /\.(html|xml|txt)$/.test(rel)) || rel.endsWith(".mp4");
for (const rel of files) assert.equal(workerFirst("/" + rel), page(rel), `/${rel} should ${page(rel) ? "reach" : "skip"} the Worker`);
const exts = [...new Set(files.filter((f) => f.startsWith("assets/")).map((f) => path.extname(f)))].sort();
ok(`run_worker_first: pages, videos and google*.html reach the Worker; CSS, JS, fonts and every asset type (${exts.join(" ")}) skip it`);
