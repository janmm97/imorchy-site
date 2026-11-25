// Which requests run the Worker before the static assets (Cloudflare `assets.config.run_worker_first`).
// Page paths must reach the Worker so http:// and www. get their 301; static files skip it, because the free
// Workers plan counts every Worker-first request. In Cloudflare's patterns `*` also matches `/`, and a `!` rule
// beats any positive one, so videos (*.mp4, *.webm) are left out of the negations on purpose: /shared/ is negated
// per file type, never as /shared/*, so /shared/media/*.mp4|webm still reach the Worker (R2).
// Docs: https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first
export const RUN_WORKER_FIRST = [
  "/*",
  "!/assets/*.svg",
  "!/assets/*.png",
  "!/assets/*.webp",
  "!/js/*",
  "!/fonts/*",
  "!/styles.css",
  "!/css/*",
  "!/shared/*.css",
  "!/shared/*.js",
  "!/shared/*.svg",
  "!/shared/*.png",
  "!/shared/*.webp",
  "!/shared/*.woff2",
];
