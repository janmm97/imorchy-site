// The landing page's Worker: one address (https://imorchy.dev), the launch video, and Google's verification file.
// Pages, videos and /google*.html run the Worker first; static files skip it (site/worker/routes.mjs).
import { byteRange } from "./range.mjs";

/** Videos live in R2 (MEDIA), under their site path: too big for static assets and kept out of git. Safari won't play an mp4 without byte ranges, so Range gets a 206. */
async function video(request, env, url) {
  const key = url.pathname.slice(1);
  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": head.httpMetadata?.contentType || "video/mp4",
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // One address for search engines: http:// and www. move permanently to https://imorchy.dev, path and query kept.
    if (url.protocol === "http:" || url.hostname === "www.imorchy.dev")
      return Response.redirect("https://imorchy.dev" + url.pathname + url.search, 301);
    if (url.pathname.endsWith(".mp4") && ["GET", "HEAD"].includes(request.method)) return video(request, env, url);
    // Google Search Console's verification file must answer 200 at its .html path; static assets would redirect it to the bare name.
    if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) return env.ASSETS.fetch(url.origin + url.pathname.slice(0, -5));
    return env.ASSETS.fetch(request);
  },
};
