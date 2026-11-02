// Security headers for every response the Worker gives (main.mjs) and for the local preview (serve.mjs), so the
// preview matches live. ADR "imorchy.dev content, legal pages and access" (2026-11-03), point 6. Side-effect free:
// no I/O, no globals, so test-urls.mjs and check-live.mjs import it directly. Static files on the negated
// run_worker_first paths (routes.mjs) skip the Worker and get none of this; they're same-origin subresources.

/**
 * The sha256 of the inline importmap in site/index.html, as the browser hashes it (the text between the tags, line
 * ends as LF). Hard-coded on purpose (the deploy path stays untouched): change the importmap and this in the same
 * PR. test-urls.mjs fails if they disagree; a stale hash would leave the hero on its static fallback.
 */
export const IMPORTMAP_SHA256 = "sha256-oRZKROs/rPg3kUle68jwgMPfk4YGUFiZzB6Q02QFCN0=";

/** The only outside host any page may load from: three.js for the hero, on / only. */
export const SCRIPT_HOST = "https://cdn.jsdelivr.net";

const csp = (scriptSrc) =>
  [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // 'unsafe-inline' for styles only: a few style="" attributes and CSSOM writes from the hero scripts.
    "style-src 'self' 'unsafe-inline'",
    // data: for art.mjs's decoded PNG masks.
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

/** The two Content-Security-Policy profiles: the WebGL hero (/) and every other page (no scripts; JSON-LD is data, not run). */
export const CSP = {
  hero: csp(`'self' ${SCRIPT_HOST} '${IMPORTMAP_SHA256}'`),
  page: csp("'none'"),
};
const HERO_PATHS = new Set(["/", "/index", "/index.html"]);

/** On every response. HSTS is added on https only, one year, without includeSubDomains or preload (Jan decides those later). */
export const BASE = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
export const HSTS = "max-age=31536000";
/** On HTML responses as well, next to the CSP. */
export const HTML = {
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/**
 * The security headers for a response to `pathname`, sent over https or not, with this Content-Type. Over plain
 * http (the local preview) the CSP drops upgrade-insecure-requests, which would send its files to an https:// that
 * isn't there; live, http:// only ever gets the 301.
 */
export function securityHeaders({ https, pathname, contentType }) {
  const headers = { ...BASE };
  if (https) headers["Strict-Transport-Security"] = HSTS;
  if (/^text\/html\b/i.test(contentType || "")) {
    const csp = HERO_PATHS.has(pathname) ? CSP.hero : CSP.page;
    Object.assign(headers, HTML, { "Content-Security-Policy": https ? csp : csp.replace("; upgrade-insecure-requests", "") });
  }
  return headers;
}

/**
 * `res` with the security headers added, and nothing else changed: the same status, status text, body stream and
 * every header it had (ETag, Location, Content-Range, Content-Length, Cache-Control), so 301s, 304s and the video's
 * 206/416 answer exactly as before. Only the security header names are set.
 */
export function withSecurityHeaders(res, url) {
  // new Response(body, res) is the Workers idiom for a copy with writable headers; it keeps everything else as well.
  const out = new Response(res.body, res);
  const add = securityHeaders({ https: url.protocol === "https:", pathname: url.pathname, contentType: res.headers.get("Content-Type") });
  for (const [name, value] of Object.entries(add)) out.headers.set(name, value);
  return out;
}
