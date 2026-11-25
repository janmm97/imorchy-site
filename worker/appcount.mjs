// The app count on the pages ("1,100+ apps") follows One's live catalogue without a redeploy.
// Every page and llms.txt is written with APP_COUNT_BASE. When One's public count, floored to the hundred, differs
// from it, the Worker swaps the text on the way out. One's API is never on the page's critical path: the count is
// read from memory or the Cache API, and a miss refreshes it in the background (ctx.waitUntil) while the page goes
// out unchanged. Any error, timeout, odd answer or count outside 1000..5000 leaves the page as it is.
import { videoExt } from "./media.mjs";

/** The count every page is written with. Change it here and in the pages together (test-app-count.mjs checks). */
export const APP_COUNT_BASE = "1,100+";
export const APP_COUNT_SOURCE = "https://api.withone.ai/v1/available-connectors?limit=1";
const CACHE_KEY = "https://imorchy.dev/__app-count";
const TTL_S = 6 * 3600;
const RETRY_S = 600;
const TIMEOUT_MS = 1500;
const SHAPE = /^\d,\d{3}\+$/;

/** 1108 → "1,100+"; null for anything that isn't a whole number in 1000..5000. */
export function appCountDisplay(total) {
  if (!Number.isInteger(total) || total < 1000 || total > 5000) return null;
  const n = Math.floor(total / 100) * 100;
  return `${Math.floor(n / 1000)},${String(n % 1000).padStart(3, "0")}+`;
}

/** One's live count as display text, or null on any failure (network, timeout, non-2xx, bad JSON, out of bounds). */
export async function fetchAppCount(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(APP_COUNT_SOURCE, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return appCountDisplay(body?.total);
  } catch {
    return null;
  }
}

let memo = { value: null, until: 0 };
/** Tests only: forget the in-memory count. */
export function resetAppCount() {
  memo = { value: null, until: 0 };
}

async function refresh(fetchImpl, cache, now) {
  const value = await fetchAppCount(fetchImpl);
  // A failed lookup keeps the last good count and tries again in 10 minutes; it never overwrites the cached count.
  if (!value) {
    memo = { value: memo.value, until: now() + RETRY_S * 1000 };
    return;
  }
  memo = { value, until: now() + TTL_S * 1000 };
  try {
    await cache?.put(CACHE_KEY, new Response(value, { headers: { "Cache-Control": `max-age=${TTL_S}` } }));
  } catch {}
}

/**
 * The live display text if it is known now, else null. Never waits on One: a miss starts a background refresh.
 * deps (tests): fetch, cache (a Cache API object), now.
 */
export async function liveAppCount(ctx, deps = {}) {
  const { fetch: fetchImpl = fetch, cache = globalThis.caches?.default, now = Date.now } = deps;
  if (now() < memo.until) return memo.value;
  try {
    const hit = await cache?.match(CACHE_KEY);
    if (hit) {
      const text = await hit.text();
      memo = { value: SHAPE.test(text) ? text : null, until: now() + 60_000 };
      return memo.value;
    }
  } catch {}
  // One refresh at a time per isolate: hold the miss for a minute while it runs.
  memo = { value: memo.value, until: now() + 60_000 };
  // Without a ctx (tests, local calls) nothing runs in the background.
  if (ctx?.waitUntil) ctx.waitUntil(refresh(fetchImpl, cache, now));
  return memo.value;
}

/** The live text when it should replace APP_COUNT_BASE, else null. */
export function shownAppCount(live) {
  return typeof live === "string" && SHAPE.test(live) && live !== APP_COUNT_BASE ? live : null;
}

/**
 * While a live count is shown, a GET page request goes to the assets without If-None-Match / If-Modified-Since, so a
 * browser holding a page from before the count changed gets it again (200, rewritten) rather than a 304 that keeps
 * the old count. Videos (.mp4 and .webm, any case) keep their conditionals.
 */
export function forAppCount(request, url, live) {
  if (!shownAppCount(live) || request.method !== "GET" || videoExt(url.pathname)) return request;
  if (!request.headers.has("If-None-Match") && !request.headers.has("If-Modified-Since")) return request;
  const headers = new Headers(request.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  return new Request(request, { headers });
}

/** Swaps APP_COUNT_BASE for the live text in a 200 GET text/html answer or /llms.txt; any other answer is returned as is. */
export async function withAppCount(res, request, url, live) {
  live = shownAppCount(live);
  if (!live || request.method !== "GET" || res.status !== 200 || !res.body) return res;
  const type = (res.headers.get("Content-Type") || "").toLowerCase();
  if (!type.startsWith("text/html") && url.pathname !== "/llms.txt") return res;
  const text = await res.text();
  const headers = new Headers(res.headers);
  if (!text.includes(APP_COUNT_BASE)) return new Response(text, { status: res.status, statusText: res.statusText, headers });
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(text.split(APP_COUNT_BASE).join(live), { status: res.status, statusText: res.statusText, headers });
}
