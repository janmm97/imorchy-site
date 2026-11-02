// Offline checks of the URL regression list (urls.mjs) and the security headers (headers.mjs), driven through the
// Worker (main.mjs) with a fake ASSETS binding that serves the real files under site/ the way Cloudflare's static
// assets do (/name → name.html, ETag, 304), and a fake R2 video. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TYPES, siteFiles } from "./files.mjs";
import { CSP, IMPORTMAP_SHA256, SCRIPT_HOST, securityHeaders, withSecurityHeaders } from "./headers.mjs";
import worker from "./main.mjs";
import { RUN_WORKER_FIRST } from "./routes.mjs";
import { EXPECT_HEADERS, LINKS, LOAD_HOSTS, ORIGIN, PAGES, REDIRECTS, headerProblems } from "./urls.mjs";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ok = (name) => console.log(`ok - ${name}`);
const read = (rel) => fs.readFileSync(path.join(SITE, rel), "utf8").replace(/\r\n?/g, "\n");

// The file a path is served from, like Cloudflare's html_handling "auto-trailing-slash": / → index.html, /x → x.html.
const fileFor = (p) => (p === "/" ? "index.html" : path.extname(p) ? p.slice(1) : p.slice(1) + ".html");
const exists = (p) => fs.existsSync(path.join(SITE, fileFor(p)));
const assetsSeen = [];
const VIDEO = Uint8Array.from({ length: 3000 }, (_, i) => i % 199);
const r2 = { key: "assets/video.mp4", size: VIDEO.length, httpEtag: '"v9"', uploaded: new Date("2026-11-01T00:00:00Z"), httpMetadata: { contentType: "video/mp4" } };
const env = {
  ASSETS: {
    fetch: async (input) => {
      const req = typeof input === "string" ? new Request(input) : input;
      const p = new URL(req.url).pathname;
      assetsSeen.push(p);
      if (!exists(p)) return new Response("Not found", { status: 404 });
      const data = fs.readFileSync(path.join(SITE, fileFor(p)));
      const etag = `"${createHash("sha1").update(data).digest("hex")}"`;
      const headers = { "Content-Type": TYPES[path.extname(fileFor(p))], ETag: etag, "Cache-Control": "public, max-age=0, must-revalidate" };
      if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
      return new Response(data, { status: 200, headers });
    },
  },
  MEDIA: {
    head: async (key) => (key === r2.key ? r2 : null),
    get: async (key, opts) => {
      const { offset = 0, length = VIDEO.length - offset } = opts?.range || {};
      return key === r2.key ? { ...r2, body: new Blob([VIDEO.slice(offset, offset + length)]).stream() } : null;
    },
  },
};
const get = (url, headers = {}, method = "GET") => worker.fetch(new Request(url, { method, headers, redirect: "manual" }), env);

// ── the CSP: one hash for the importmap, one outside script host, no inline scripts ──
const importmaps = [...read("index.html").matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.equal(importmaps.length, 1, "index.html has one inline importmap");
const hash = "sha256-" + createHash("sha256").update(importmaps[0]).digest("base64");
assert.equal(IMPORTMAP_SHA256, hash, `the importmap in index.html changed: set IMPORTMAP_SHA256 in worker/headers.mjs to "${hash}"`);
const directive = (csp, name) => csp.split("; ").find((d) => d.startsWith(name + " "));
assert.equal(directive(CSP.hero, "script-src"), `script-src 'self' ${SCRIPT_HOST} '${hash}'`);
assert.equal(directive(CSP.page, "script-src"), "script-src 'none'");
for (const csp of Object.values(CSP)) {
  assert.doesNotMatch(csp, /unsafe-eval|report-uri|report-to/);
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "font-src 'self'", "img-src 'self' data:"])
    assert.ok(csp.includes(d), d);
}
assert.deepEqual(LOAD_HOSTS, { "/": [new URL(SCRIPT_HOST).host] }, "the CSP's outside host and the load allowlist agree");
for (const html of fs.readdirSync(SITE).filter((f) => f.endsWith(".html")))
  assert.equal([...read(html).matchAll(/<script\b(?![^>]*type="(?:importmap|application\/ld\+json)")[^>]*>\s*[^<\s]/g)].length, 0, `${html}: no inline script besides the importmap and JSON-LD`);
const preview = securityHeaders({ https: false, pathname: "/", contentType: "text/html; charset=utf-8" });
assert.equal(preview["Content-Security-Policy"], CSP.hero.replace("; upgrade-insecure-requests", ""), "the http preview's CSP doesn't upgrade its own files to https");
assert.equal(preview["Strict-Transport-Security"], undefined, "no HSTS over http");
assert.ok(CSP.hero.endsWith("; upgrade-insecure-requests") && CSP.page.endsWith("; upgrade-insecure-requests"));
ok("CSP: IMPORTMAP_SHA256 is the sha256 of index.html's importmap; / allows only self, cdn.jsdelivr.net and that hash; other pages run no script");

// ── every page in the list ──
const worksFirst = (p) => {
  const glob = (g) => new RegExp("^" + g.split(/\*+/).map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return RUN_WORKER_FIRST.some((r) => !r.startsWith("!") && glob(r).test(p)) && !RUN_WORKER_FIRST.some((r) => r.startsWith("!") && glob(r.slice(1)).test(p));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchy-urls-"));
let live = 0;
try {
  for (const page of PAGES) {
    assert.ok(worksFirst(page.path), `${page.path} runs the Worker first, so it gets the headers`);
    if (!exists(page.path)) {
      assert.equal(page.ships, "legal-pr", `site/${fileFor(page.path)} is missing, and ${page.path} isn't marked to ship later`);
      const res = await get(ORIGIN + page.path);
      assert.equal(res.headers.get("Location"), null, `${page.path}: main.mjs doesn't redirect it`);
      assert.equal(assetsSeen.at(-1), page.path, `${page.path}: main.mjs hands it to the static assets`);
      const file = path.join(tmp, fileFor(page.path));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "x");
      continue;
    }
    assert.equal(page.ships, undefined, `site/${fileFor(page.path)} exists: remove ships from ${page.path} in urls.mjs, so check-live.mjs checks it`);
    live++;
    const res = await get(ORIGIN + page.path);
    assert.equal(res.status, 200, page.path);
    assert.deepEqual(headerProblems(res.headers, page, CSP), [], page.path);
    const body = await res.text();
    for (const marker of page.markers) assert.ok(body.includes(marker), `${page.path} has ${JSON.stringify(marker)} in its raw HTML`);
  }
  const uploaded = siteFiles(tmp).map((f) => f.rel).sort();
  assert.deepEqual(uploaded, PAGES.filter((p) => !exists(p.path)).map((p) => fileFor(p.path)).sort(), "files.mjs uploads the later pages once they exist");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const sec = PAGES.find((p) => p.path === "/.well-known/security.txt");
if (exists(sec.path)) {
  const txt = read(fileFor(sec.path));
  const expires = Date.parse(/^Expires:\s*(\S+)/m.exec(txt)?.[1]);
  assert.ok(expires > Date.now() && expires <= Date.now() + 366 * 864e5, "security.txt Expires is in the future and at most a year out");
  assert.match(txt, /^Canonical: https:\/\/imorchy\.dev\/\.well-known\/security\.txt$/m);
}
ok(`${live} live URLs answer 200 with no redirect, the right type, their raw-HTML markers and the headers per profile; ${PAGES.length - live} legal URLs (ships: "legal-pr") route through the Worker untouched and would upload`);

// ── the sitemap: every <loc> is a listed page on https://imorchy.dev, no future lastmod ──
const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const today = new Date().toISOString().slice(0, 10);
assert.ok(locs.length >= 5);
for (const loc of locs) {
  assert.ok(loc.startsWith(ORIGIN + "/"), loc);
  const page = PAGES.find((p) => ORIGIN + p.path === loc);
  assert.ok(page && exists(page.path), `${loc} is in urls.mjs and its file exists`);
}
for (const [, d] of sitemap.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/g)) {
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(d <= today, `lastmod ${d} is not in the future`);
}
ok(`sitemap.xml: ${locs.length} locs, each a listed page on ${ORIGIN} whose file exists; no future lastmod`);

// ── one address: 301 straight to the https://imorchy.dev URL, which answers 200 (one hop, no loop) ──
for (const { from, to } of REDIRECTS) {
  const res = await get(from);
  assert.equal(res.status, 301, from);
  assert.equal(res.headers.get("Location"), to, from);
  assert.equal(res.headers.get("Strict-Transport-Security"), from.startsWith("https:") ? "max-age=31536000" : null, `${from}: HSTS on https only`);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  const next = await get(to);
  assert.equal(next.status, 200, `${to} answers 200, no second hop`);
}
ok("http:// and www. answer 301 with Location kept, then 200 on https://imorchy.dev; HSTS only on the https answers");

// ── the calls to action on /: outbound, new tab, noopener, on their host ──
const home = read("index.html");
for (const { text, host } of LINKS) {
  const anchors = [...home.matchAll(/<a\b([^>]*)>\s*([^<]*)/g)].filter((m) => m[2].trim().startsWith(text));
  assert.ok(anchors.length, `/ links "${text}"`);
  for (const [, attrs] of anchors) {
    assert.equal(new URL(/href="([^"]+)"/.exec(attrs)[1]).host, host, text);
    assert.match(attrs, /target="_blank"/, text);
    assert.match(attrs, /rel="[^"]*noopener/, text);
  }
}
ok("/ has the early-access and booking links, each opening its own host in a new tab with rel=noopener");

// ── nothing loads from a host outside the allowlist (scripts, styles, images, fonts, frames, media, imports) ──
const outside = (text, allowed) =>
  [...text.matchAll(/(?:\b(?:src|srcset|data|poster)="|<link\b[^>]*\bhref="|url\(\s*['"]?|@import\s+['"]|"imports"\s*:\s*\{[^}]*?")((?:https?:)?\/\/[^/"')\s]+)/g)]
    .map((m) => new URL(m[1], ORIGIN).host)
    .filter((h) => h !== new URL(ORIGIN).host && !allowed.includes(h));
for (const page of PAGES.filter((p) => p.profile && exists(p.path))) assert.deepEqual(outside(read(fileFor(page.path)), LOAD_HOSTS[page.path] || []), [], page.path);
assert.deepEqual(outside(read("styles.css"), []), [], "styles.css");
assert.deepEqual(outside('<img src="https://example.com/x.png">', []), ["example.com"], "the scan sees an outside load");
ok("no page or stylesheet loads from a host outside the allowlist (cdn.jsdelivr.net, on / only)");

// ── the wrapper keeps status, body and every header: 304, video 206/416, redirects ──
const etag = (await get(ORIGIN + "/")).headers.get("ETag");
let res = await get(ORIGIN + "/", { "If-None-Match": etag });
assert.equal(res.status, 304);
assert.equal(res.headers.get("ETag"), etag);
assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
res = await get(ORIGIN + "/assets/video.mp4", { Range: "bytes=100-199" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Range"), "bytes 100-199/3000");
assert.equal(res.headers.get("Content-Length"), "100");
assert.equal(res.headers.get("ETag"), '"v9"');
assert.equal(res.headers.get("Accept-Ranges"), "bytes");
assert.equal(res.headers.get("Content-Security-Policy"), null, "no CSP on the video");
assert.deepEqual(new Uint8Array(await res.arrayBuffer()), VIDEO.slice(100, 200));
res = await get(ORIGIN + "/assets/video.mp4", { Range: "bytes=3000-" });
assert.equal(res.status, 416);
assert.equal(res.headers.get("Content-Range"), "bytes */3000");
res = await get(ORIGIN + "/assets/video.mp4", { "If-None-Match": '"v9"' });
assert.equal(res.status, 304);
assert.equal(res.headers.get("ETag"), '"v9"');
for (const [name, value] of Object.entries(EXPECT_HEADERS.all)) assert.equal(res.headers.get(name), value, name);
const samples = [
  new Response(null, { status: 304, headers: { ETag: '"a"', "Cache-Control": "no-cache" } }),
  new Response("part", { status: 206, statusText: "Partial Content", headers: { "Content-Range": "bytes 0-3/9", "Content-Type": "video/mp4" } }),
  new Response(null, { status: 416, headers: { "Content-Range": "bytes */9" } }),
  Response.redirect("https://imorchy.dev/a?b=1", 301),
  new Response("<p>", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Other": "kept" } }),
];
for (const before of samples) {
  const kept = [...before.headers];
  const after = withSecurityHeaders(before, new URL(ORIGIN + "/x"));
  assert.equal(after.status, before.status);
  assert.equal(after.statusText, before.statusText);
  for (const [name, value] of kept) assert.equal(after.headers.get(name), value, `${before.status} keeps ${name}`);
  assert.equal(after.headers.get("X-Content-Type-Options"), "nosniff");
}
assert.equal(await withSecurityHeaders(new Response("body bytes"), new URL(ORIGIN)).text(), "body bytes");
ok("the headers wrapper keeps status, body, ETag, Location, Content-Range and every other header: 304 (assets and video), 206, 416, 301, 404");
console.log("test-urls: all passed");
