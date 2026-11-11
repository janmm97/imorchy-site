// Offline checks for what deploy.mjs uploads and how Cloudflare routes it: every file of the site (and every file a
// page, the CSS or a script points at) has a Content-Type in files.mjs, so it goes up; and run_worker_first
// (routes.mjs) sends pages and videos to the Worker but every static file straight to the assets. serve.mjs knows its
// own types, so the local preview can't catch a gap here. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IN_R2, SKIP, TYPES, siteFiles, skipDir } from "./files.mjs";
import { RUN_WORKER_FIRST } from "./routes.mjs";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ok = (name) => console.log(`ok - ${name}`);

// Every file on disk under site/, the way a person sees the folder: not the Worker, packages, the tooling or a local
// copy of the video (git-ignored; live it comes from R2).
const onDisk = (dir = SITE) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(SITE, full).split(path.sep).join("/");
    if (entry.isDirectory()) return skipDir(rel, entry.name) ? [] : onDisk(full);
    return SKIP.has(rel) || IN_R2.has(path.extname(rel)) ? [] : [rel];
  });
const files = onDisk();
const deployed = new Set(siteFiles(SITE).map((f) => f.rel));

// ── (a) deploy.mjs uploads every file of the site ──
for (const rel of files) assert.ok(deployed.has(rel), `deploy.mjs would skip site/${rel}: add "${path.extname(rel)}" to TYPES in worker/files.mjs`);
for (const dir of ["assets", "js", "fonts"]) assert.ok(files.some((f) => f.startsWith(dir + "/")), `site/${dir} has files`);
ok(`deploy.mjs uploads all ${files.length} files of the site (assets, js, fonts, pages, sitemap, robots.txt)`);

// A video on disk (the local preview's copy) is never uploaded: a deploy can't need it, so CI can deploy without it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchy-site-"));
try {
  fs.mkdirSync(path.join(tmp, "assets"));
  fs.writeFileSync(path.join(tmp, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(tmp, "assets", "video.mp4"), Buffer.alloc(64));
  // The content build and its sources are tooling, never site files (ADR point 1).
  fs.mkdirSync(path.join(tmp, "content", "blog"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "content", "pages.json"), "[]");
  fs.writeFileSync(path.join(tmp, "content", "blog", "x.html"), "<!doctype html>");
  fs.writeFileSync(path.join(tmp, "build.mjs"), "");
  assert.deepEqual(siteFiles(tmp).map((f) => f.rel), ["index.html"]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
assert.ok(IN_R2.has(".mp4") && !TYPES[".mp4"]);
ok("videos (.mp4) are never uploaded as static assets, even with a local copy on disk: the Worker serves them from R2");
ok("build.mjs and content/ (the sources of the generated pages) are never uploaded");

// Every local file a page, the stylesheet or a script names is uploaded too (the video comes from R2).
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
const LEGAL = ["/privacy", "/terms", "/security", "/data-privacy", "/dpa", "/.well-known/security.txt"];
for (const p of ["/", ...ANSWER_PAGES, ...LEGAL, "/blog", "/blog/virtual-assistant-cost", "/sitemap.xml", "/robots.txt", "/assets/video.mp4", "/googlec22430d134477d04.html", "/BingSiteAuth.xml"])
  assert.ok(workerFirst(p), `${p} should reach the Worker`);
assert.equal(TYPES[".txt"], "text/plain; charset=utf-8", "security.txt is served as text/plain (RFC 9116)");
for (const p of ["/styles.css", "/js/main.mjs", "/fonts/JetBrainsMono-Bold.woff2", "/assets/orchy-main.svg", "/assets/logos/tools/github.svg", "/assets/og-image.png", "/assets/orchy-main-500.webp", "/assets/orchy-icon-64.png"])
  assert.ok(!workerFirst(p), `${p} should skip the Worker`);
// Every file on disk: root pages (.html, .xml, .txt), blog posts (blog/*.html), .well-known files and videos reach the
// Worker, every other file skips it.
const page = (rel) => /^([^/]+\.(html|xml|txt)|blog\/[^/]+\.html)$/.test(rel) || rel.startsWith(".well-known/") || rel.endsWith(".mp4");
for (const rel of files) assert.equal(workerFirst("/" + rel), page(rel), `/${rel} should ${page(rel) ? "reach" : "skip"} the Worker`);
const exts = [...new Set(files.filter((f) => f.startsWith("assets/")).map((f) => path.extname(f)))].sort();
assert.ok(files.includes("BingSiteAuth.xml"), "Bing Webmaster verification file is in site/ at its exact case");
ok(`run_worker_first: pages, videos, google*.html and BingSiteAuth.xml reach the Worker; CSS, JS, fonts and every asset type (${exts.join(" ")}) skip it`);
