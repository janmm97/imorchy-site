// Offline checks for the landing page's Worker (main.mjs): Google's verification file answers at its .html path,
// videos go through the cache, and everything else is handed to the static assets untouched. A fake ASSETS
// binding and cache stand in for Cloudflare. No network, no keys, no installed packages.
import assert from "node:assert/strict";
import worker from "./main.mjs";

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
const get = (path, method = "GET") => worker.fetch(new Request(`https://imorchy.dev${path}`, { method }), env);

// ── Google's verification file ──
let res = await get("/google0123abcd.html");
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

console.log("test-worker: all passed");
