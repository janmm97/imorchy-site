// Offline checks for the live app count (appcount.mjs): One's total is floored to the hundred, kept to 1000..5000,
// swapped into pages and llms.txt only when it differs from APP_COUNT_BASE, and any failure leaves the page as it is.
// One's API is faked; no network. Run by test.mjs (part of `npm test`).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_COUNT_BASE, APP_COUNT_SOURCE, appCountDisplay, fetchAppCount, forAppCount, liveAppCount, resetAppCount, withAppCount } from "./appcount.mjs";
import worker from "./main.mjs";

const ok = (name) => console.log(`ok - ${name}`);
const SITE = fileURLToPath(new URL("..", import.meta.url));
const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const page = (body, type = "text/html; charset=utf-8") =>
  new Response(body, { headers: { "Content-Type": type, "Content-Length": String(body.length), ETag: '"abc"' } });
const get = (p, method = "GET") => new Request("https://imorchy.dev" + p, { method });
const html = `<p>Connect ${APP_COUNT_BASE} apps.</p><p>${APP_COUNT_BASE} again</p>`;

// Display: floor to the hundred, comma, "+"; null outside 1000..5000 or for non-integers.
assert.equal(appCountDisplay(1108), "1,100+");
assert.equal(appCountDisplay(1199), "1,100+");
assert.equal(appCountDisplay(1200), "1,200+");
assert.equal(appCountDisplay(1000), "1,000+");
assert.equal(appCountDisplay(5000), "5,000+");
for (const bad of [999, 5001, 0, -1, 1108.5, NaN, Infinity, "1108", null, undefined]) assert.equal(appCountDisplay(bad), null, String(bad));
ok("app count: 1108 shows as 1,100+, and only whole numbers in 1000..5000 count");

// One's API: the right URL, a timeout signal, and null for every failure.
let asked;
assert.equal(await fetchAppCount(async (u, init) => ((asked = { u, init }), new Response('{"total":1234}'))), "1,200+");
assert.equal(asked.u, APP_COUNT_SOURCE);
assert.ok(asked.init.signal instanceof AbortSignal, "the fetch carries a timeout signal");
assert.equal(await fetchAppCount(json({ total: 1108 }, 500)), null, "non-2xx");
assert.equal(await fetchAppCount(json({ rows: [] })), null, "missing total");
assert.equal(await fetchAppCount(json({ total: "lots" })), null, "non-numeric total");
assert.equal(await fetchAppCount(json({ total: 999 })), null, "below 1000");
assert.equal(await fetchAppCount(json({ total: 5001 })), null, "above 5000");
assert.equal(await fetchAppCount(async () => new Response("<html>oops</html>")), null, "not JSON");
assert.equal(await fetchAppCount(async () => { throw new TypeError("network down"); }), null, "network error");
// AbortSignal.timeout's timer doesn't hold Node's event loop open, so a plain interval does while the tests wait on it.
const keepAlive = setInterval(() => {}, 100);
const hang = (_u, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
const t0 = Date.now();
assert.equal(await fetchAppCount(hang), null, "timeout");
assert.ok(Date.now() - t0 < 3000, "the timeout fires in about 1.5 s");
ok("app count: errors, timeouts, garbage and out-of-bounds totals give no count");

// The rewrite: HTML and llms.txt only, never when equal, never for HEAD or non-200; headers dropped only on rewrite.
let res = await withAppCount(page(html), get("/apps"), new URL("https://imorchy.dev/apps"), "1,200+");
assert.equal(await res.text(), "<p>Connect 1,200+ apps.</p><p>1,200+ again</p>");
assert.equal(res.headers.get("Content-Length"), null);
assert.equal(res.headers.get("ETag"), null);
assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
res = await withAppCount(page(`- ${APP_COUNT_BASE} apps`, "text/plain"), get("/llms.txt"), new URL("https://imorchy.dev/llms.txt"), "1,200+");
assert.equal(await res.text(), "- 1,200+ apps");
ok("app count: a different live count is swapped into pages and llms.txt, without Content-Length and ETag");

const untouched = async (name, r, req, live) => {
  const before = r;
  const after = await withAppCount(r, req, new URL(req.url), live);
  assert.equal(after, before, `${name}: the same response object comes back`);
};
await untouched("equal counts", page(html), get("/apps"), APP_COUNT_BASE);
await untouched("no live count", page(html), get("/apps"), null);
await untouched("odd live text", page(html), get("/apps"), "<script>");
await untouched("plain text", page(`${APP_COUNT_BASE}`, "text/plain"), get("/robots.txt"), "1,200+");
await untouched("css", page(`${APP_COUNT_BASE}`, "text/css"), get("/styles.css"), "1,200+");
await untouched("HEAD", page(html), get("/apps", "HEAD"), "1,200+");
await untouched("404", new Response(html, { status: 404, headers: { "Content-Type": "text/html" } }), get("/x"), "1,200+");
await untouched("video", new Response("mp4", { headers: { "Content-Type": "video/mp4" } }), get("/a.mp4"), "1,200+");
ok("app count: equal counts, failures, non-HTML, HEAD and non-200 answers are left untouched");

const cond = (p, method = "GET") => new Request("https://imorchy.dev" + p, { method, headers: { "If-None-Match": '"abc"', "If-Modified-Since": "Mon, 23 Nov 2026 00:00:00 GMT", Accept: "text/html" } });
let req = forAppCount(cond("/apps"), new URL("https://imorchy.dev/apps"), "1,200+");
assert.equal(req.headers.get("If-None-Match"), null);
assert.equal(req.headers.get("If-Modified-Since"), null);
assert.equal(req.headers.get("Accept"), "text/html", "other headers are kept");
for (const [name, r0, live] of [
  ["equal counts", cond("/apps"), APP_COUNT_BASE],
  ["no live count", cond("/apps"), null],
  ["HEAD", cond("/apps", "HEAD"), "1,200+"],
  ["video", cond("/assets/launch.mp4"), "1,200+"],
]) assert.equal(forAppCount(r0, new URL(r0.url), live), r0, `${name}: conditionals kept`);
ok("app count: while a live count is shown, page requests skip the 304 that would keep the old count; videos keep theirs");

// The cache: a miss never waits on One; the refresh runs in the background and the next request uses it.
const store = new Map();
const cache = { match: async (k) => store.get(k)?.clone(), put: async (k, r) => void store.set(k, r) };
let clock = 0;
const now = () => clock;
let calls = 0;
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const deps = { cache, now, fetch: async () => (calls++, new Response('{"total":1234}')) };
resetAppCount();
assert.equal(await liveAppCount(ctx, deps), null, "a miss serves the page as written");
assert.equal(waits.length, 1, "and refreshes in the background");
await Promise.all(waits);
assert.equal(await liveAppCount(ctx, deps), "1,200+");
resetAppCount();
assert.equal(await liveAppCount(ctx, deps), "1,200+", "another isolate reads the Cache API");
assert.equal(calls, 1, "One is asked once per 6 hours");
clock += 6 * 3600 * 1000 + 1;
store.clear();
await liveAppCount(ctx, deps);
await Promise.all(waits);
assert.equal(calls, 2, "after 6 hours the count is fetched again");
let down = true;
const flaky = { cache, now, fetch: async () => (calls++, down ? new Response("busy", { status: 503 }) : new Response('{"total":1234}')) };
clock += 6 * 3600 * 1000 + 1;
assert.equal(await liveAppCount(ctx, flaky), "1,200+", "an expired count stays shown while it's refreshed");
await Promise.all(waits);
assert.equal(await liveAppCount(ctx, flaky), "1,200+", "a failed refresh keeps the last good count");
const before = calls;
clock += 5 * 60 * 1000;
await liveAppCount(ctx, flaky);
assert.equal(calls, before, "and waits 10 minutes before asking One again");
assert.ok(store.has("https://imorchy.dev/__app-count"), "the cached count isn't replaced by the failure");
store.clear();
resetAppCount();
store.set("https://imorchy.dev/__app-count", new Response("<b>9</b>"));
assert.equal(await liveAppCount(ctx, deps), null, "a cached value of the wrong shape is ignored");
assert.equal(await liveAppCount(undefined, { cache: { match: async () => { throw new Error("x"); } }, now, fetch: deps.fetch }), null);
ok("app count: cached for 6 hours, refreshed in the background, a broken cache gives no count");

// Through the Worker: a page goes out unchanged at once while One is down, and with the live count once it's known.
const realFetch = globalThis.fetch;
const env = { ASSETS: { fetch: async () => page(html) } };
try {
  resetAppCount();
  const pending = [];
  globalThis.fetch = (u, init) => hang(u, init);
  const t1 = Date.now();
  res = await worker.fetch(get("/apps"), env, { waitUntil: (p) => pending.push(p) });
  assert.ok(Date.now() - t1 < 500, "One being down never slows the page");
  assert.equal(await res.text(), html);
  await Promise.all(pending);
  resetAppCount();
  globalThis.fetch = async () => new Response('{"total":1310}');
  await worker.fetch(get("/apps"), env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  res = await worker.fetch(get("/apps"), env, { waitUntil: (p) => pending.push(p) });
  assert.equal(await res.text(), html.split(APP_COUNT_BASE).join("1,300+"));
  assert.ok(res.headers.get("Content-Security-Policy"), "the security headers are still added");
  const env304 = { ASSETS: { fetch: async (r0) => (r0.headers.get("If-None-Match") ? new Response(null, { status: 304, headers: { ETag: '"abc"' } }) : page(html)) } };
  res = await worker.fetch(new Request("https://imorchy.dev/apps", { headers: { "If-None-Match": '"abc"' } }), env304, { waitUntil: (p) => pending.push(p) });
  assert.equal(res.status, 200, "an old cached page is replaced, not confirmed with a 304");
  assert.equal(await res.text(), html.split(APP_COUNT_BASE).join("1,300+"));
} finally {
  globalThis.fetch = realFetch;
  resetAppCount();
}
clearInterval(keepAlive);
ok("app count: the Worker never waits on One and serves the live count once it's cached");

// Every Orchy app count on the site is written with APP_COUNT_BASE, so the swap finds them all. (Other products' counts,
// like the "3,000+ integrations" a competitor lists on alternatives/grok-bot, are other numbers and stay as written.)
const SKIP_DIRS = new Set([".git", "node_modules", "worker", "scratch"]);
const walk = (d) =>
  fs.readdirSync(path.join(SITE, d), { withFileTypes: true }).flatMap((e) => {
    const rel = d ? `${d}/${e.name}` : e.name;
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(rel);
    return e.name.endsWith(".html") ? [rel] : [];
  });
const files = ["llms.txt", ...walk("")];
assert.ok(files.includes("blog/virtual-assistant-cost.html"), "the scan reaches subfolders");
let found = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(SITE, f), "utf8");
  for (const m of text.matchAll(/\d,\d{3}\+ (?:apps|more)/g)) {
    assert.ok(m[0].startsWith(APP_COUNT_BASE), `${f}: "${m[0]}" should use APP_COUNT_BASE (${APP_COUNT_BASE})`);
    found++;
  }
  // The swap changes every APP_COUNT_BASE on a page, so it may only ever stand for Orchy's app count.
  for (const m of text.matchAll(new RegExp(APP_COUNT_BASE.replace(/[+]/g, "\\+") + "(.{0,6})", "g")))
    assert.match(m[1], /^ (?:apps|more)/, `${f}: "${APP_COUNT_BASE}${m[1]}" isn't an app count, but the Worker would change it`);
}
assert.ok(found > 10, `the site's app counts were found (${found})`);
ok(`app count: all ${found} counts on the site use ${APP_COUNT_BASE}`);
