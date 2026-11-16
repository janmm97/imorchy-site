// The landing page's Worker: one address (https://imorchy.dev), the launch video, Google's verification file, and
// the security headers on every answer (headers.mjs).
// Pages, videos and /google*.html run the Worker first; static files skip it (site/worker/routes.mjs).
import { withSecurityHeaders } from "./headers.mjs";
import { byteRange } from "./range.mjs";

/** Answers a video with byte ranges: Safari won't play an mp4 without them, so Range gets a 206.
 * `file` is { size, type, etag, modified }; `read(range)` returns the body for the range (or the whole file when null). */
async function ranged(request, file, read) {
  const headers = new Headers({ "Content-Type": file.type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" });
  if (file.etag) headers.set("ETag", file.etag);
  if (file.modified) headers.set("Last-Modified", file.modified);
  if (file.etag && request.headers.get("If-None-Match") === file.etag) return new Response(null, { status: 304, headers });
  const range = byteRange(request.headers.get("Range"), file.size);
  if (range === null) {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range || { start: 0, end: file.size - 1 };
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const body = await read(range);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { status, headers });
}

/** The launch video lives in R2 (MEDIA), under its site path: too big for static assets and kept out of git. */
async function video(request, env, url) {
  const key = url.pathname.slice(1);
  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const file = { size: head.size, type: head.httpMetadata?.contentType || "video/mp4", etag: head.httpEtag, modified: head.uploaded.toUTCString() };
  return ranged(request, file, async (r) => (await env.MEDIA.get(key, r ? { range: { offset: r.start, length: r.end - r.start + 1 } } : undefined))?.body);
}

/** The homepage loops (/media/*.mp4, *.webm, a few MB each) are static assets, which ignore Range: the Worker slices them. */
async function mediaVideo(request, env, url) {
  const res = await env.ASSETS.fetch(url.origin + url.pathname);
  if (!res.ok) return res;
  const data = new Uint8Array(await res.arrayBuffer());
  const file = { size: data.length, type: res.headers.get("Content-Type"), etag: res.headers.get("ETag") };
  return ranged(request, file, (r) => (r ? data.slice(r.start, r.end + 1) : data));
}

/** Where a request goes: the 301, a homepage loop, the launch video from R2, Google's file or the static assets. */
async function route(request, env, url) {
  // One address for search engines: http:// and www. move permanently to https://imorchy.dev, path and query kept.
  if (url.protocol === "http:" || url.hostname === "www.imorchy.dev")
    return Response.redirect("https://imorchy.dev" + url.pathname + url.search, 301);
  const read = ["GET", "HEAD"].includes(request.method);
  if (read && /^\/media\/[^/]+\.(mp4|webm)$/.test(url.pathname)) return mediaVideo(request, env, url);
  if (read && url.pathname.endsWith(".mp4")) return video(request, env, url);
  // Google Search Console's verification file must answer 200 at its .html path; static assets would redirect it to the bare name.
  if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) return env.ASSETS.fetch(url.origin + url.pathname.slice(0, -5));
  return env.ASSETS.fetch(request);
}

export default {
  // Every answer gets the security headers (headers.mjs); its status, body and other headers are kept as they are.
  async fetch(request, env) {
    const url = new URL(request.url);
    return withSecurityHeaders(await route(request, env, url), url);
  },
};
