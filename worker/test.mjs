// Offline checks for the landing page's Worker (main.mjs): http:// and www. get a 301 to https://imorchy.dev,
// Google's verification file answers at its .html path, videos go through the cache, and everything else is
// handed to the static assets untouched; routes.mjs sends pages and videos to the Worker, not static files. A fake ASSETS
// binding and cache stand in for Cloudflare. No network, no keys, no installed packages.
import assert from "node:assert/strict";
import worker from "./main.mjs";
import { RUN_WORKER_FIRST } from "./routes.mjs";

const ok = (name) => console.log(`ok - ${name}`);
const seen = [];
const env = {
  ASSETS: {
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;
      seen.push(url);
      return new Response(`asset ${new URL(url).pathname}`, { status: 200, headers: { "Content-Type": "text/plain" } });
    },
  },
};
const store = new Map();
globalThis.caches = {
  default: {
    match: async (req) => store.get(typeof req === "string" ? req : req.url)?.clone(),
    put: async (key, res) => void store.set(key, res),
  },
};
const get = (path, method = "GET", origin = "https://imorchy.dev") => worker.fetch(new Request(origin + path, { method }), env);

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
res = await get("/googlec22430d134477d04.html");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/googlec22430d134477d04");
ok("the live Google verification file still answers 200 from assets");

// ── run_worker_first, read the way Cloudflare does: `*` matches across "/", a "!" rule beats any positive one ──
const glob = (p) => new RegExp("^" + p.split(/\*+/).map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
const workerFirst = (path) =>
  RUN_WORKER_FIRST.some((p) => !p.startsWith("!") && glob(p).test(path)) &&
  !RUN_WORKER_FIRST.some((p) => p.startsWith("!") && glob(p.slice(1)).test(path));
for (const p of ["/", "/approvals", "/sitemap.xml", "/robots.txt", "/assets/video.mp4", "/googlec22430d134477d04.html"])
  assert.ok(workerFirst(p), `${p} should reach the Worker`);
for (const p of ["/styles.css", "/js/main.mjs", "/fonts/JetBrainsMono-Bold.woff2", "/assets/orchy-main.svg", "/assets/logos/tools/github.svg", "/assets/og-image.png", "/favicon.svg"])
  assert.ok(!workerFirst(p), `${p} should skip the Worker`);
ok("run_worker_first: pages, videos and google*.html reach the Worker; CSS, JS, fonts and images don't");

// ── Google's verification file ──
res = await get("/google0123abcd.html");
assert.equal(res.status, 200);
assert.equal(seen.at(-1), "https://imorchy.dev/google0123abcd");
ok("google*.html: served from assets at the bare name, so it answers 200 with no redirect");

// ── the launch video ──
res = await get("/assets/video.mp4");
assert.equal(res.headers.get("Accept-Ranges"), "bytes");
assert.ok(store.has("https://imorchy.dev/assets/video.mp4"));
const fetchesBefore = seen.length;
await get("/assets/video.mp4");
assert.equal(seen.length, fetchesBefore);
ok("*.mp4: fetched once into the edge cache with Accept-Ranges, then answered from the cache");

// ── everything else ──
res = await get("/styles.css");
assert.equal(await res.text(), "asset /styles.css");
res = await get("/api/session");
assert.equal(await res.text(), "asset /api/session");
ok("other paths (the old /api included) go straight to the static assets");

await import("./test-pages.mjs");
console.log("test-worker: all passed");
