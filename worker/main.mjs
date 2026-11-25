// The landing page's Worker: one address (https://imorchy.dev), the launch video, Google's verification file, and
// the security headers on every answer (headers.mjs).
// Pages, videos and /google*.html run the Worker first; static files skip it (site/worker/routes.mjs).
import { withSecurityHeaders } from "./headers.mjs";
import { byteRange } from "./range.mjs";
import { forAppCount, liveAppCount, withAppCount } from "./appcount.mjs";
import { VIDEO_TYPES } from "./files.mjs";

/** Videos live in R2 (MEDIA), under their site path: too big for static assets and kept out of git. Safari won't play an mp4 without byte ranges, so Range gets a 206. */
async function video(request, env, url, ext) {
  const key = url.pathname.slice(1);
  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": head.httpMetadata?.contentType || VIDEO_TYPES[ext],
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    ETag: head.httpEtag,
    "Last-Modified": head.uploaded.toUTCString(),
  });
  if (request.headers.get("If-None-Match") === head.httpEtag) return new Response(null, { status: 304, headers });
  const range = byteRange(request.headers.get("Range"), head.size);
  if (range === null) {
    headers.set("Content-Range", `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range || { start: 0, end: head.size - 1 };
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${head.size}`);
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const body = await env.MEDIA.get(key, range ? { range: { offset: start, length: end - start + 1 } } : undefined);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body.body, { status, headers });
}

/** Retired v3 pages (Ruby's v4 redirect map, L2): every spelling answers one 301 to the homepage. */
const RETIRED = /^\/(?:local|claude-code-orchestrator)(?:\.html|\/)?$/;
/** Where the "Get started" CTA lands (sign-up). `from` (the page section) is passed on so the app can count sign-ups per CTA. */
export const SIGN_UP = "https://app.imorchy.dev/";
const SECTION = /^[a-z0-9-]{1,40}$/;
/** A plan card's choice, passed on so the app preselects it (orchy-ai planChoice checks it again). */
const PLAN = /^(starter|solo|pro|business)$/;
const INTERVAL = /^(month|year)$/;
/** /go/start is the CTA hop; /go/early-access stays as an alias so old links and posts keep working. */
const CTA_HOPS = new Set(["/go/start", "/go/early-access"]);

/** /go/start?from=<section>: a same-origin hop so every CTA click is a Worker request, then on to the app. */
function signUp(url) {
  const to = new URL(SIGN_UP);
  const from = url.searchParams.get("from");
  if (from && SECTION.test(from)) to.searchParams.set("from", from);
  const plan = url.searchParams.get("plan"), interval = url.searchParams.get("interval");
  if (plan && PLAN.test(plan)) {
    to.searchParams.set("plan", plan);
    if (interval && INTERVAL.test(interval)) to.searchParams.set("interval", interval);
  }
  return new Response(null, { status: 302, headers: { Location: to.href, "Cache-Control": "no-store" } });
}

/** Where a request goes: the 301s, the CTA hop, a video from R2, Google's file or the static assets. */
async function route(request, env, url) {
  // One address for search engines: http:// and www. move permanently to https://imorchy.dev, path and query kept.
  if (url.protocol === "http:" || url.hostname === "www.imorchy.dev")
    return Response.redirect("https://imorchy.dev" + url.pathname + url.search, 301);
  if (RETIRED.test(url.pathname)) return Response.redirect("https://imorchy.dev/", 301);
  if (CTA_HOPS.has(url.pathname)) return signUp(url);
  const ext = /\.(mp4|webm)$/.exec(url.pathname)?.[0];
  if (ext && ["GET", "HEAD"].includes(request.method)) return video(request, env, url, ext);
  // Google Search Console's verification file must answer 200 at its .html path; static assets would redirect it to the bare name.
  if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) return env.ASSETS.fetch(url.origin + url.pathname.slice(0, -5));
  return env.ASSETS.fetch(request);
}

export default {
  // Every answer gets the security headers (headers.mjs); its status, body and other headers are kept as they are.
  // Pages and llms.txt carry One's live app count when it differs from the one they were written with (appcount.mjs).
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const live = await liveAppCount(ctx);
    const req = forAppCount(request, url, live);
    const res = withSecurityHeaders(await withAppCount(await route(req, env, url), req, url, live), url);
    // The workers.dev preview (deploy.mjs --preview binds PREVIEW) must never be indexed next to imorchy.dev.
    if (env.PREVIEW) res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  },
};
