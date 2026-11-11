// The URL regression list for imorchy.dev: what every public URL must answer. test-urls.mjs checks it offline
// against main.mjs and the files under site/ (part of `npm test`); check-live.mjs checks it against the live site
// after each deploy. ADR "imorchy.dev content, legal pages and access" (2026-11-03), point 7. Side-effect free.
//
// Each page: { path, type (Content-Type prefix), profile ("hero" | "page" for HTML: which CSP), markers (text that
// must be in the raw HTML, no JS) }. Every listed URL's file must exist under site/.

export const ORIGIN = "https://imorchy.dev";

export const PAGES = [
  {
    path: "/",
    type: "text/html",
    profile: "hero",
    markers: [
      '<h1 id="heroTitle"',
      "Orchy <span class=\"hero-ai\">AI</span>",
      "A command center for your AI agents.",
      "Early access: we approve each sign-up by hand and let people in in small groups.",
    ],
  },
  { path: "/approvals", type: "text/html", profile: "page", markers: ["<h1>AI agents that ask before they act</h1>"] },
  { path: "/client-workspaces", type: "text/html", profile: "page", markers: ["<h1>Separate AI agents and logins for every client</h1>"] },
  { path: "/claude-code-orchestrator", type: "text/html", profile: "page", markers: ["<h1>Run Claude Code, Codex and Cursor as one team</h1>"] },
  { path: "/local", type: "text/html", profile: "page", markers: ["<h1>A command center for AI agents on your own computer</h1>"] },
  { path: "/robots.txt", type: "text/plain", markers: ["Sitemap: https://imorchy.dev/sitemap.xml"] },
  { path: "/sitemap.xml", type: "application/xml", markers: ["<urlset"] },
  // The legal pages and security.txt (RFC 9116): direct 200, no redirect.
  { path: "/privacy", type: "text/html", profile: "page", markers: ["<h1>Privacy Policy</h1>", "One Systems, Inc."] },
  { path: "/terms", type: "text/html", profile: "page", markers: ["<h1>Terms of Use</h1>", "One Systems, Inc."] },
  { path: "/security", type: "text/html", profile: "page", markers: ["<h1>Security</h1>", "/.well-known/security.txt"] },
  { path: "/data-privacy", type: "text/html", profile: "page", markers: ["<h1>Data Privacy: DPA and sub-processors</h1>", "href=\"/dpa\""] },
  { path: "/dpa", type: "text/html", profile: "page", markers: ["<h1>Data Processing Agreement (DPA)</h1>", "One Systems, Inc."] },
  { path: "/.well-known/security.txt", type: "text/plain", markers: ["Contact:", "Expires:", "Canonical: https://imorchy.dev/.well-known/security.txt"] },
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
 * Each must be on the page and point at its host; all but Get Started (the app, same tab) open in a new tab with rel="noopener".
 */
export const LINKS = [
  { text: "Get Started", host: "app.imorchy.dev", sameTab: true },
  { text: "Book a call", host: "calendly.com" },
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
  if (headers.get("x-robots-tag")) problems.push(`x-robots-tag: ${headers.get("x-robots-tag")} (want none: it can noindex a page)`);
  return problems;
}

/**
 * Other spellings of a page: each answers exactly one hop (Cloudflare's html_handling 307, or a 301/308) straight to
 * the clean URL, which answers 200 itself.
 */
export const ONE_HOP = [
  { from: "/approvals/", to: "/approvals" },
  { from: "/approvals.html", to: "/approvals" },
  { from: "/index.html", to: "/" },
];
export const HOP_STATUS = [301, 307, 308];

/** The answer search and AI-search crawlers must get on / (spec: OAI-SearchBot and PerplexityBot, as published). */
export const BOT_UAS = {
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

/** Crawlers robots.txt must never shut out of the whole site. ClaudeBot and other training bots are the owner's call. */
export const MUST_CRAWL = ["*", "googlebot", "bingbot", "oai-searchbot", "chatgpt-user", "perplexitybot"];

/**
 * What in robots.txt blocks a crawler that must reach the site. Groups follow RFC 9309: consecutive User-agent lines
 * share the rules that follow them, and only an Allow or Disallow line ends the run of User-agent lines; a crawler obeys
 * its own group, else the `*` group.
 */
export function robotsProblems(text) {
  const groups = [];
  let open = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === "user-agent") {
      if (!open) groups.push({ agents: [], disallow: [] });
      groups.at(-1).agents.push(value.toLowerCase());
      open = true;
    } else if (key === "allow" || key === "disallow") {
      if (groups.length && key === "disallow") groups.at(-1).disallow.push(value);
      open = false;
    } // Sitemap, Crawl-delay and other lines aren't group members (RFC 9309 2.2.4), so they leave the group open.
  }
  return MUST_CRAWL.flatMap((bot) => {
    const own = groups.filter((g) => g.agents.includes(bot));
    const rules = (own.length ? own : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.disallow);
    return rules.filter((r) => r === "/" || r === "/*").map((r) => `robots.txt: "Disallow: ${r}" shuts ${bot} out of the whole site`);
  });
}

/** Where check-live fetches a sitemap <loc> when it checks `domain` (a staging copy serves the same paths). */
export const liveUrl = (loc, domain) => loc.replace(/^https:\/\/imorchy\.dev\//, `https://${domain}/`);

/** What's wrong with a fetched sitemap page: it must answer 200 itself and name its imorchy.dev loc as its one canonical. */
export function locProblem(loc, { status, location, canon }) {
  if (status !== 200 || location) return `${loc}: HTTP ${status}${location ? ` → ${location}` : ""}`;
  if (canon.length !== 1 || canon[0] !== loc) return `${loc}: canonical ${JSON.stringify(canon)}`;
  return null;
}
