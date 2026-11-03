// Offline checks for the landing page's Worker (main.mjs): http:// and www. get a 301 to https://imorchy.dev,
// Google's verification file answers at its .html path, videos come from R2 with byte ranges, and everything else is
// handed to the static assets untouched. Fake ASSETS and MEDIA (R2) bindings stand in for Cloudflare. No network, no
// keys, no installed packages. Routing (run_worker_first) and the deploy file list are checked in test-deploy.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import worker from "./main.mjs";
import { byteRange } from "./range.mjs";

const ok = (name) => console.log(`ok - ${name}`);
const seen = [];
// The video in R2: 5000 known bytes under its site path, with the fields the Worker reads from an R2 object.
const VIDEO = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
const media = { "assets/video.mp4": VIDEO };
const r2 = [];
const object = (key) => ({ key, size: media[key].length, httpEtag: '"v1"', uploaded: new Date("2026-10-31T00:00:00Z"), httpMetadata: { contentType: "video/mp4" } });
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
ok("https://imorchy.dev/ passes through to the static assets");
const ANSWER_PAGES = ["/approvals", "/client-workspaces", "/claude-code-orchestrator", "/local"];
for (const p of ANSWER_PAGES) {
  res = await get(p);
  assert.equal(res.status, 200);
  assert.equal(seen.at(-1), "https://imorchy.dev" + p);
  res = await get(p, "GET", "https://www.imorchy.dev");
  assert.equal(res.headers.get("Location"), "https://imorchy.dev" + p);
}
ok("the four answer pages pass through to the static assets at their extensionless paths, and www. 301s to them");
res = await get("/googlec22430d134477d04.html");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/googlec22430d134477d04");
ok("the live Google verification file still answers 200 from assets");

// ── Google's verification file ──
res = await get("/google0123abcd.html");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/google0123abcd");
ok("google*.html: served from assets at the bare name, so it answers 200 with no redirect");

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

// The committed generated files (sitemap.xml, and any blog/changelog pages) match a fresh build of site/content.
const check = spawnSync(process.execPath, [fileURLToPath(new URL("../build.mjs", import.meta.url)), "--check"], { encoding: "utf8" });
process.stdout.write(check.stdout);
process.stderr.write(check.stderr);
assert.equal(check.status, 0, "node site/build.mjs --check failed: run node site/build.mjs and commit what it writes");
assert.match(check.stdout, /^build --check: [1-9]\d* generated file\(s\) match their sources/m, "build.mjs --check ran its check (not just exited 0)");
console.log("ok - node site/build.mjs --check: the committed generated files match site/content");
console.log("test-worker: all passed");
