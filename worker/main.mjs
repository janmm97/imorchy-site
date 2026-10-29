// The landing page's Worker: static files, the launch video, and Google's verification file.
// Everything else is a static asset; only *.mp4 and /google*.html run the Worker first (site/deploy.mjs).

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
    if (url.pathname.endsWith(".mp4") && request.method === "GET") return video(request, env, url);
    // Google Search Console's verification file must answer 200 at its .html path; static assets would redirect it to the bare name.
    if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) return env.ASSETS.fetch(url.origin + url.pathname.slice(0, -5));
    return env.ASSETS.fetch(request);
  },
};
