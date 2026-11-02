// The URL regression list for imorchy.dev: what every public URL must answer. test-urls.mjs checks it offline
// against main.mjs and the files under site/ (part of `npm test`); check-live.mjs checks it against the live site
// after each deploy. ADR "imorchy.dev content, legal pages and access" (2026-11-03), point 7. Side-effect free.
//
// Each page: { path, type (Content-Type prefix), profile ("hero" | "page" for HTML: which CSP), markers (text that
// must be in the raw HTML, no JS), ships? }. `ships: "legal-pr"` marks a URL whose file comes in a later PR: until
// then only its routing is checked, and the PR that adds the file removes the mark, so from then on a missing file fails.

export const ORIGIN = "https://imorchy.dev";

export const PAGES = [
  {
    path: "/",
    type: "text/html",
    profile: "hero",
    markers: [
      '<h1 id="heroTitle"',
      "Orchy <span class=\"hero-ai\">AI</span>",
      "A command center for your AI agents, on your own computer.",
      "Orchy AI is in early access.",
    ],
  },
  { path: "/approvals", type: "text/html", profile: "page", markers: ["<h1>AI agents that ask before they act</h1>"] },
  { path: "/client-workspaces", type: "text/html", profile: "page", markers: ["<h1>Separate AI agents and logins for every client</h1>"] },
  { path: "/claude-code-orchestrator", type: "text/html", profile: "page", markers: ["<h1>Run Claude Code, Codex and Cursor as one team</h1>"] },
  { path: "/local", type: "text/html", profile: "page", markers: ["<h1>A command center for AI agents on your own computer</h1>"] },
  { path: "/robots.txt", type: "text/plain", markers: ["Sitemap: https://imorchy.dev/sitemap.xml"] },
  { path: "/sitemap.xml", type: "application/xml", markers: ["<urlset"] },
  // The legal pages and security.txt (RFC 9116): direct 200, no redirect, once the legal PR ships them.
  { path: "/privacy", type: "text/html", profile: "page", markers: [], ships: "legal-pr" },
  { path: "/terms", type: "text/html", profile: "page", markers: [], ships: "legal-pr" },
  { path: "/security", type: "text/html", profile: "page", markers: [], ships: "legal-pr" },
  { path: "/data-privacy", type: "text/html", profile: "page", markers: [], ships: "legal-pr" },
  { path: "/.well-known/security.txt", type: "text/plain", markers: ["Contact:", "Expires:"], ships: "legal-pr" },
];

/** One address: each of these answers 301 straight to `to`, which answers 200 (one hop, no loop). */
export const REDIRECTS = [
  { from: "http://imorchy.dev/", to: "https://imorchy.dev/" },
  { from: "http://imorchy.dev/approvals?ref=x", to: "https://imorchy.dev/approvals?ref=x" },
  { from: "http://www.imorchy.dev/approvals?ref=x", to: "https://imorchy.dev/approvals?ref=x" },
  { from: "https://www.imorchy.dev/approvals?ref=x", to: "https://imorchy.dev/approvals?ref=x" },
  { from: "https://www.imorchy.dev/", to: "https://imorchy.dev/" },
];

/**
 * The calls to action on / (imorchy.dev has no form or approval endpoint of its own: both are outbound links).
 * Each must be on the page, open in a new tab with rel="noopener", and point at its host.
 */
export const LINKS = [
  { text: "Join the early-access list", host: "flaxen-crayon-74f.notion.site" },
  { text: "Book 30 minutes", host: "calendly.com" },
];

/** Hosts a page may load anything from (script, style, image, font, frame, media). Links are not loads. */
export const LOAD_HOSTS = { "/": ["cdn.jsdelivr.net"] };

/** The security headers every https answer carries, and the ones an HTML page adds next to its CSP profile. */
export const EXPECT_HEADERS = {
  all: {
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  },
  html: {
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
};

/** What's wrong with an answer's headers for `page` (and the CSP text it should carry), as a list of messages. */
export function headerProblems(headers, page, csp) {
  const want = { ...EXPECT_HEADERS.all, ...(page.profile ? { ...EXPECT_HEADERS.html, "content-security-policy": csp[page.profile] } : {}) };
  const problems = Object.entries(want)
    .filter(([name, value]) => headers.get(name) !== value)
    .map(([name, value]) => `${name}: got ${JSON.stringify(headers.get(name))}, want ${JSON.stringify(value)}`);
  const type = headers.get("content-type") || "";
  if (!type.startsWith(page.type)) problems.push(`content-type: got ${JSON.stringify(type)}, want ${page.type}`);
  if (headers.get("location")) problems.push(`location: ${headers.get("location")} (want no redirect)`);
  return problems;
}
