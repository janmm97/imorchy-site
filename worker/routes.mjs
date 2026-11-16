// Which requests run the Worker before the static assets (Cloudflare `assets.config.run_worker_first`).
// Page paths must reach the Worker so http:// and www. get their 301; static files skip it, because the free
// Workers plan counts every Worker-first request. In Cloudflare's patterns `*` also matches `/`, and a `!` rule
// beats any positive one, so videos (/assets/*.mp4, /media/*.mp4 and *.webm) are left out of the negations on purpose:
// the Worker answers their byte ranges.
// Docs: https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first
export const RUN_WORKER_FIRST = [
  "/*",
  "!/assets/*.svg",
  "!/assets/*.png",
  "!/assets/*.webp",
  "!/js/*",
  "!/fonts/*",
  "!/styles.css",
  "!/home.css",
  "!/media/*.jpg",
];
