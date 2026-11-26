// Offline checks for the landing page's Worker (main.mjs): http:// and www. get a 301 to https://imorchy.dev,
// Google's verification file answers at its .html path, videos come from R2 with byte ranges, and everything else is
// handed to the static assets untouched. Fake ASSETS and MEDIA (R2) bindings stand in for Cloudflare. No network, no
// keys, no installed packages. Routing (run_worker_first) and the deploy file list are checked in test-deploy.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { cli } from "../build.mjs";
import worker from "./main.mjs";
import { byteRange } from "./range.mjs";
import { forAppCount } from "./appcount.mjs";
import { VIDEO_TYPES, videoExt, videoType } from "./media.mjs";

const ok = (name) => console.log(`ok - ${name}`);
const seen = [];
// The video in R2: 5000 known bytes under its site path, with the fields the Worker reads from an R2 object.
const VIDEO = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
const CLIP = VIDEO.slice(0, 3000);
const media = {
  "assets/video.mp4": VIDEO,
  "shared/media/clip.webm": CLIP,
  "shared/media/octet.webm": CLIP,
  "shared/media/mislabelled.mp4": CLIP,
  "shared/media/codecs.webm": CLIP,
  "shared/media/LOUD.WEBM": CLIP,
};
// The Content-Type each object was uploaded with (none for clip.webm and LOUD.WEBM).
const stored = {
  "assets/video.mp4": "video/mp4",
  "shared/media/octet.webm": "application/octet-stream",
  "shared/media/mislabelled.mp4": "video/webm",
  "shared/media/codecs.webm": 'video/webm; codecs="vp9"',
};
const r2 = [];
const object = (key) => ({ key, size: media[key].length, httpEtag: '"v1"', uploaded: new Date("2026-10-31T00:00:00Z"), httpMetadata: stored[key] ? { contentType: stored[key] } : {} });
const env = {
  ASSETS: {
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;
      seen.push(url);
      return new Response(`asset ${new URL(url).pathname}`, { status: 200, headers: { "Content-Type": "text/plain" } });
    },
  },
  MEDIA: {
    head: async (key) => (r2.push(["head", key]), media[key] ? object(key) : null),
    get: async (key, opts) => {
      r2.push(["get", key, opts?.range]);
      if (!media[key]) return null;
      const { offset = 0, length = media[key].length - offset } = opts?.range || {};
      return { ...object(key), body: new Blob([media[key].slice(offset, offset + length)]).stream() };
    },
  },
};
const get = (path, method = "GET", origin = "https://imorchy.dev", headers = {}) => worker.fetch(new Request(origin + path, { method, headers }), env);
const bytes = async (res) => new Uint8Array(await res.arrayBuffer());

// ── one address: http:// and www. move permanently ──
let res = await get("/", "GET", "http://imorchy.dev");
assert.equal(res.status, 301);
assert.equal(res.headers.get("Location"), "https://imorchy.dev/");
res = await get("/x?y=1", "GET", "https://www.imorchy.dev");
assert.equal(res.status, 301);
assert.equal(res.headers.get("Location"), "https://imorchy.dev/x?y=1");
res = await get("/assets/video.mp4", "GET", "http://www.imorchy.dev");
assert.equal(res.headers.get("Location"), "https://imorchy.dev/assets/video.mp4");
assert.equal(seen.length, 0);
ok("http:// and www. answer 301 to https://imorchy.dev with path and query kept, before any asset fetch");
res = await get("/");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/");
assert.equal(res.headers.get("X-Robots-Tag"), null);
ok("https://imorchy.dev/ passes through to the static assets, with no X-Robots-Tag in production");
for (const p of ["/", "/go/start?from=hero", "/go/early-access?from=hero", "/local"]) {
  res = await worker.fetch(new Request("https://imorchy-site-preview.janmm97.workers.dev" + p), { ...env, PREVIEW: "1" });
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow", p);
}
ok("with the PREVIEW binding (deploy.mjs --preview) every answer, redirects too, says X-Robots-Tag: noindex, nofollow");
const ANSWER_PAGES = ["/approvals", "/client-workspaces"];
for (const p of ANSWER_PAGES) {
  res = await get(p);
  assert.equal(res.status, 200);
  assert.equal(seen.at(-1), "https://imorchy.dev" + p);
  res = await get(p, "GET", "https://www.imorchy.dev");
  assert.equal(res.headers.get("Location"), "https://imorchy.dev" + p);
}
ok("the answer pages pass through to the static assets at their extensionless paths, and www. 301s to them");
res = await get("/googlec22430d134477d04.html");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/googlec22430d134477d04");
ok("the live Google verification file still answers 200 from assets");

// ── Google's verification file ──
res = await get("/google0123abcd.html");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/google0123abcd");
ok("google*.html: served from assets at the bare name, so it answers 200 with no redirect");

// ── Bing Webmaster verification file ──
res = await get("/BingSiteAuth.xml");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/BingSiteAuth.xml");
ok("/BingSiteAuth.xml passes through to the static assets at its exact path with 200");

// ── the launch video, from R2 ──
assert.deepEqual(byteRange("bytes=0-1023", 5000), { start: 0, end: 1023 });
assert.deepEqual(byteRange("bytes=4000-", 5000), { start: 4000, end: 4999 });
assert.deepEqual(byteRange("bytes=-10", 5000), { start: 4990, end: 4999 });
assert.deepEqual(byteRange("bytes=4990-9999", 5000), { start: 4990, end: 4999 });
for (const whole of [null, "", "bytes=-", "bytes=0-1,5-9", "items=0-1"]) assert.equal(byteRange(whole, 5000), undefined, String(whole));
for (const bad of ["bytes=5000-", "bytes=9-3", "bytes=-0"]) assert.equal(byteRange(bad, 5000), null, bad);
ok("byteRange: one range (start-end, start-, -suffix, clamped to the end); several or malformed ranges get the whole file; unsatisfiable ones get null");

const seenBefore = seen.length;
res = await get("/assets/video.mp4");
assert.equal(res.status, 200);
assert.equal(res.headers.get("Content-Type"), "video/mp4");
assert.equal(res.headers.get("Accept-Ranges"), "bytes");
assert.equal(res.headers.get("Content-Length"), "5000");
assert.equal(res.headers.get("Cache-Control"), "public, max-age=86400");
assert.equal(res.headers.get("ETag"), '"v1"');
assert.equal(res.headers.get("Last-Modified"), "Sat, 31 Oct 2026 00:00:00 GMT");
assert.deepEqual(await bytes(res), VIDEO);
ok("*.mp4 without Range: 200 with the whole file from R2, video/mp4, Accept-Ranges, a day's Cache-Control, ETag and Last-Modified");

res = await get("/assets/video.mp4", "GET", undefined, { Range: "bytes=0-1023" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Range"), "bytes 0-1023/5000");
assert.equal(res.headers.get("Content-Length"), "1024");
assert.deepEqual(await bytes(res), VIDEO.slice(0, 1024));
assert.deepEqual(r2.at(-1), ["get", "assets/video.mp4", { offset: 0, length: 1024 }]);
res = await get("/assets/video.mp4", "GET", undefined, { Range: "bytes=-100" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Range"), "bytes 4900-4999/5000");
assert.deepEqual(await bytes(res), VIDEO.slice(4900));
ok("*.mp4 with Range: 206 with Content-Range and only the asked bytes, read from R2 as a range (Safari can play and seek)");

res = await get("/assets/video.mp4", "GET", undefined, { Range: "bytes=5000-" });
assert.equal(res.status, 416);
assert.equal(res.headers.get("Content-Range"), "bytes */5000");
ok("*.mp4 with a Range past the end: 416 with Content-Range bytes */size");

const reads = r2.filter(([op]) => op === "get").length;
res = await get("/assets/video.mp4", "HEAD", undefined, { Range: "bytes=0-1" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Length"), "2");
res = await get("/assets/video.mp4", "GET", undefined, { "If-None-Match": '"v1"' });
assert.equal(res.status, 304);
assert.equal(r2.filter(([op]) => op === "get").length, reads);
ok("*.mp4 HEAD answers the headers and a matching If-None-Match answers 304, neither reading the video from R2");

res = await get("/assets/missing.mp4");
assert.equal(res.status, 404);
assert.equal(seen.length, seenBefore);
ok("an .mp4 that isn't in R2 is a 404, and videos never touch the static assets");

res = await get("/shared/media/clip.webm", "GET", undefined, { Range: "bytes=0-99" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Type"), "video/webm");
assert.equal(res.headers.get("Content-Range"), "bytes 0-99/3000");
assert.equal((await res.arrayBuffer()).byteLength, 100);
res = await get("/shared/media/missing.webm");
assert.equal(res.status, 404);
assert.equal(seen.length, seenBefore);
ok("*.webm comes from R2 like *.mp4: 206 with Content-Range, video/webm when the object has no type, 404 when missing");

// #32: .webm gets the same answers as .mp4: no-Range 200, HEAD, 304 and 416, and HEAD and 304 never read the body.
res = await get("/shared/media/clip.webm");
assert.equal(res.status, 200);
assert.equal(res.headers.get("Content-Type"), "video/webm");
assert.equal(res.headers.get("Accept-Ranges"), "bytes");
assert.equal(res.headers.get("Content-Length"), "3000");
assert.equal(res.headers.get("Content-Range"), null);
assert.equal(res.headers.get("ETag"), '"v1"');
assert.deepEqual(await bytes(res), CLIP);
const webmReads = r2.filter(([op]) => op === "get").length;
res = await get("/shared/media/clip.webm", "HEAD");
assert.equal(res.status, 200);
assert.equal(res.headers.get("Content-Type"), "video/webm");
assert.equal(res.headers.get("Content-Length"), "3000");
assert.equal(await res.text(), "");
res = await get("/shared/media/clip.webm", "HEAD", undefined, { Range: "bytes=10-19" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Range"), "bytes 10-19/3000");
assert.equal(res.headers.get("Content-Length"), "10");
res = await get("/shared/media/clip.webm", "GET", undefined, { "If-None-Match": '"v1"' });
assert.equal(res.status, 304);
assert.equal(res.headers.get("ETag"), '"v1"');
assert.equal(r2.filter(([op]) => op === "get").length, webmReads);
res = await get("/shared/media/clip.webm", "GET", undefined, { Range: "bytes=3000-" });
assert.equal(res.status, 416);
assert.equal(res.headers.get("Content-Range"), "bytes */3000");
assert.equal(r2.filter(([op]) => op === "get").length, webmReads);
ok("*.webm: 200 with the whole clip without Range, HEAD answers headers only (200, or 206 with a Range), 304 on a matching ETag, 416 past the end; HEAD, 304 and 416 never read R2");

// While a live app count is shown, a video request keeps its conditionals, so a .webm (any case) still gets its 304.
for (const p of ["/shared/media/clip.webm", "/assets/video.mp4", "/shared/media/LOUD.WEBM"]) {
  const req = new Request("https://imorchy.dev" + p, { headers: { "If-None-Match": '"v1"' } });
  assert.equal(forAppCount(req, new URL(req.url), "1,200+"), req, `${p}: conditionals kept while a live count is shown`);
}
ok("a live app count never strips If-None-Match from a video request (.mp4 or .webm, any case)");

// The stored Content-Type is used only when it names the extension's type; else the extension's type wins.
for (const [path, type] of [
  ["/shared/media/octet.webm", "video/webm"],
  ["/shared/media/mislabelled.mp4", "video/mp4"],
  ["/shared/media/codecs.webm", 'video/webm; codecs="vp9"'],
  ["/assets/video.mp4", "video/mp4"],
]) {
  res = await get(path, "HEAD");
  assert.equal(res.status, 200, path);
  assert.equal(res.headers.get("Content-Type"), type, path);
}
assert.equal(videoType(".webm", undefined), "video/webm");
assert.equal(videoType(".webm", ""), "video/webm");
assert.equal(videoType(".mp4", "Video/MP4"), "Video/MP4");
ok("video Content-Type: a missing, application/octet-stream or mismatched stored type gets the extension's type; a matching one (codecs too) is kept");

// Extensions match in any case: /…/LOUD.WEBM comes from R2 as video/webm, never from the static assets.
const seenCase = seen.length;
res = await get("/shared/media/LOUD.WEBM", "GET", undefined, { Range: "bytes=0-9" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Type"), "video/webm");
assert.deepEqual(r2.at(-1), ["get", "shared/media/LOUD.WEBM", { offset: 0, length: 10 }]);
res = await get("/shared/media/missing.MP4");
assert.equal(res.status, 404);
assert.equal(seen.length, seenCase);
assert.equal(videoExt("/a/b.Mp4"), ".mp4");
for (const p of ["/a/b.mp4.html", "/mp4", "/a.mp4/x", "/a/b.mov", "/a/b."]) assert.equal(videoExt(p), undefined, p);
ok("video extensions match in any case (.WEBM, .MP4), only at the end of the path");

// The Worker bundle carries no node code: nothing main.mjs imports (followed through every relative import) reaches
// node:*, and media.mjs, which the deploy side shares with it, imports nothing.
const reached = new Set();
const follow = (file) => {
  if (reached.has(file)) return;
  reached.add(file);
  const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  for (const [, spec] of src.matchAll(/^\s*(?:import|export)\b[^"'`;]*?from\s*["']([^"']+)["']/gm)) {
    assert.ok(!/^node:|^(fs|path|os|child_process|url)$/.test(spec), `${file} imports ${spec}: node code would ride into the Worker bundle`);
    if (spec.startsWith("./")) follow(spec);
  }
};
follow("./main.mjs");
assert.ok(reached.has("./media.mjs") && !reached.has("./files.mjs"), "main.mjs reads media.mjs, never files.mjs");
assert.doesNotMatch(fs.readFileSync(new URL("./media.mjs", import.meta.url), "utf8"), /^\s*import\b/m, "media.mjs imports nothing");
assert.deepEqual(VIDEO_TYPES, { ".mp4": "video/mp4", ".webm": "video/webm" });
ok(`the Worker's modules (${[...reached].join(", ")}) import no node:* module; media.mjs is side-effect free`);

// ── everything else ──
res = await get("/styles.css");
assert.equal(await res.text(), "asset /styles.css");
res = await get("/api/session");
assert.equal(await res.text(), "asset /api/session");
ok("other paths (the old /api included) go straight to the static assets");

await import("./test-pages.mjs");
await import("./test-speed.mjs");
await import("./test-deploy.mjs");
await import("./test-deploy-api.mjs");
await import("./test-urls.mjs");
await import("./test-app-count.mjs");

// The committed generated files (sitemap.xml, and any blog/changelog pages) match a fresh build of site/content.
const said = [];
const code = cli(fileURLToPath(new URL("..", import.meta.url)), ["--check"], { log: (m) => (said.push(m), console.log(m)), error: console.error });
assert.equal(code, 0, "node build.mjs --check failed: run node build.mjs and commit what it writes");
assert.match(said.join("\n"), /^build --check: [1-9]\d* generated file\(s\) match their sources/m, "build.mjs --check ran its check (not just returned 0)");
console.log("ok - node build.mjs --check: the committed generated files match content/");
console.log("test-worker: all passed");
