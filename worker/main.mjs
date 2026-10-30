// The landing page's Worker: one address (https://imorchy.dev), the launch video, and Google's verification file.
// Pages, videos and /google*.html run the Worker first; static files skip it (site/worker/routes.mjs).

/** Static assets ignore Range, and Safari won't play an mp4 without it: videos go through the edge cache, which answers Range with 206. */
async function video(request, env, url) {
  const cache = caches.default,
    key = url.origin + url.pathname;
  const hit = await cache.match(request);
  if (hit) return hit;
  const full = await env.ASSETS.fetch(key);
  if (!full.ok) return full;
  const stored = new Response(full.body, full);
  stored.headers.set("Cache-Control", "public, max-age=86400");
  stored.headers.set("Accept-Ranges", "bytes");
  await cache.put(key, stored);
  return (await cache.match(request)) || env.ASSETS.fetch(key);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // One address for search engines: http:// and www. move permanently to https://imorchy.dev, path and query kept.
    if (url.protocol === "http:" || url.hostname === "www.imorchy.dev")
      return Response.redirect("https://imorchy.dev" + url.pathname + url.search, 301);
    if (url.pathname.endsWith(".mp4") && request.method === "GET") return video(request, env, url);
    // Google Search Console's verification file must answer 200 at its .html path; static assets would redirect it to the bare name.
    if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) return env.ASSETS.fetch(url.origin + url.pathname.slice(0, -5));
    return env.ASSETS.fetch(request);
  },
};
