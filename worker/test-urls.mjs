// Offline checks of the URL regression list (urls.mjs) and the security headers (headers.mjs), driven through the
// Worker (main.mjs) with a fake ASSETS binding that serves the real files under site/ the way Cloudflare's static
// assets do (/name → name.html, ETag, 304), and a fake R2 video. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TYPES, siteFiles } from "./files.mjs";
import { CSP, IMPORTMAP_SHA256, SCRIPT_HOST, securityHeaders, withSecurityHeaders } from "./headers.mjs";
import worker from "./main.mjs";
import { RUN_WORKER_FIRST } from "./routes.mjs";
import { EXPECT_HEADERS, LINKS, LOAD_HOSTS, ORIGIN, PAGES as LISTED, REDIRECTS, headerProblems, liveUrl, locProblem, robotsProblems } from "./urls.mjs";
import { build, cli, fileFor, generatedProblems, markdown, parseSource, seoProblems, staleFiles } from "../build.mjs";

const SITE = fileURLToPath(new URL("..", import.meta.url));
// The regression list: the hand-written rows in urls.mjs plus a row for every page build.mjs generates.
const PAGES = [...LISTED, ...build(SITE).pages];
const ok = (name) => console.log(`ok - ${name}`);
const read = (rel) => fs.readFileSync(path.join(SITE, rel), "utf8").replace(/\r\n?/g, "\n");

const exists = (p) => fs.existsSync(path.join(SITE, fileFor(p)));
const assetsSeen = [];
const VIDEO = Uint8Array.from({ length: 3000 }, (_, i) => i % 199);
const r2 = { key: "assets/video.mp4", size: VIDEO.length, httpEtag: '"v9"', uploaded: new Date("2026-11-01T00:00:00Z"), httpMetadata: { contentType: "video/mp4" } };
const env = {
  ASSETS: {
    fetch: async (input) => {
      const req = typeof input === "string" ? new Request(input) : input;
      const p = new URL(req.url).pathname;
      assetsSeen.push(p);
      if (!exists(p)) return new Response("Not found", { status: 404 });
      const data = fs.readFileSync(path.join(SITE, fileFor(p)));
      const etag = `"${createHash("sha1").update(data).digest("hex")}"`;
      const headers = { "Content-Type": TYPES[path.extname(fileFor(p))], ETag: etag, "Cache-Control": "public, max-age=0, must-revalidate" };
      if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
      return new Response(data, { status: 200, headers });
    },
  },
  MEDIA: {
    head: async (key) => (key === r2.key ? r2 : null),
    get: async (key, opts) => {
      const { offset = 0, length = VIDEO.length - offset } = opts?.range || {};
      return key === r2.key ? { ...r2, body: new Blob([VIDEO.slice(offset, offset + length)]).stream() } : null;
    },
  },
};
const get = (url, headers = {}, method = "GET") => worker.fetch(new Request(url, { method, headers, redirect: "manual" }), env);

// ── the CSP: one hash for the importmap, one outside script host, no inline scripts ──
const importmaps = [...read("index.html").matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.equal(importmaps.length, 1, "index.html has one inline importmap");
const hash = "sha256-" + createHash("sha256").update(importmaps[0]).digest("base64");
assert.equal(IMPORTMAP_SHA256, hash, `the importmap in index.html changed: set IMPORTMAP_SHA256 in worker/headers.mjs to "${hash}"`);
const directive = (csp, name) => csp.split("; ").find((d) => d.startsWith(name + " "));
assert.equal(directive(CSP.hero, "script-src"), `script-src 'self' ${SCRIPT_HOST} '${hash}'`);
assert.equal(directive(CSP.page, "script-src"), "script-src 'none'");
for (const csp of Object.values(CSP)) {
  assert.doesNotMatch(csp, /unsafe-eval|report-uri|report-to/);
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "font-src 'self'", "img-src 'self' data:"])
    assert.ok(csp.includes(d), d);
}
assert.deepEqual(LOAD_HOSTS, { "/": [new URL(SCRIPT_HOST).host] }, "the CSP's outside host and the load allowlist agree");
for (const html of fs.readdirSync(SITE).filter((f) => f.endsWith(".html")))
  assert.equal([...read(html).matchAll(/<script\b(?![^>]*type="(?:importmap|application\/ld\+json)")[^>]*>\s*[^<\s]/g)].length, 0, `${html}: no inline script besides the importmap and JSON-LD`);
const preview = securityHeaders({ https: false, pathname: "/", contentType: "text/html; charset=utf-8" });
assert.equal(preview["Content-Security-Policy"], CSP.hero.replace("; upgrade-insecure-requests", ""), "the http preview's CSP doesn't upgrade its own files to https");
assert.equal(preview["Strict-Transport-Security"], undefined, "no HSTS over http");
assert.ok(CSP.hero.endsWith("; upgrade-insecure-requests") && CSP.page.endsWith("; upgrade-insecure-requests"));
ok("CSP: IMPORTMAP_SHA256 is the sha256 of index.html's importmap; / allows only self, cdn.jsdelivr.net and that hash; other pages run no script");

// ── every page in the list ──
const worksFirst = (p) => {
  const glob = (g) => new RegExp("^" + g.split(/\*+/).map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return RUN_WORKER_FIRST.some((r) => !r.startsWith("!") && glob(r).test(p)) && !RUN_WORKER_FIRST.some((r) => r.startsWith("!") && glob(r.slice(1)).test(p));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchy-urls-"));
let live = 0;
try {
  for (const page of PAGES) {
    assert.ok(worksFirst(page.path), `${page.path} runs the Worker first, so it gets the headers`);
    if (!exists(page.path)) {
      assert.equal(page.ships, "legal-pr", `site/${fileFor(page.path)} is missing, and ${page.path} isn't marked to ship later`);
      const res = await get(ORIGIN + page.path);
      assert.equal(res.headers.get("Location"), null, `${page.path}: main.mjs doesn't redirect it`);
      assert.equal(assetsSeen.at(-1), page.path, `${page.path}: main.mjs hands it to the static assets`);
      const file = path.join(tmp, fileFor(page.path));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "x");
      continue;
    }
    assert.equal(page.ships, undefined, `site/${fileFor(page.path)} exists: remove ships from ${page.path} in urls.mjs, so check-live.mjs checks it`);
    live++;
    const res = await get(ORIGIN + page.path);
    assert.equal(res.status, 200, page.path);
    assert.deepEqual(headerProblems(res.headers, page, CSP), [], page.path);
    const body = await res.text();
    for (const marker of page.markers) assert.ok(body.includes(marker), `${page.path} has ${JSON.stringify(marker)} in its raw HTML`);
  }
  const uploaded = siteFiles(tmp).map((f) => f.rel).sort();
  assert.deepEqual(uploaded, PAGES.filter((p) => !exists(p.path)).map((p) => fileFor(p.path)).sort(), "files.mjs uploads the later pages once they exist");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const sec = PAGES.find((p) => p.path === "/.well-known/security.txt");
if (exists(sec.path)) {
  const txt = read(fileFor(sec.path));
  const expires = Date.parse(/^Expires:\s*(\S+)/m.exec(txt)?.[1]);
  assert.ok(expires > Date.now() && expires <= Date.now() + 366 * 864e5, "security.txt Expires is in the future and at most a year out");
  assert.match(txt, /^Canonical: https:\/\/imorchy\.dev\/\.well-known\/security\.txt$/m);
}
ok(`${live} live URLs answer 200 with no redirect, the right type, their raw-HTML markers and the headers per profile; ${PAGES.length - live} legal URLs (ships: "legal-pr") route through the Worker untouched and would upload`);

// ── every shipped HTML page is fit for search (spec item 1): the same seoProblems build.mjs --check runs ──
const shipped = PAGES.filter((p) => p.type === "text/html" && exists(p.path));
for (const page of shipped) assert.deepEqual(seoProblems(read(fileFor(page.path)), page.path), [], `${page.path}: SEO`);
for (const page of shipped.filter((p) => p.generated)) assert.deepEqual(generatedProblems(read(fileFor(page.path))), [], `${page.path}: generated pages load no script`);
const good = '<title>T</title><meta name="description" content="D"><link rel="canonical" href="https://imorchy.dev/x"><meta property="og:image" content="https://imorchy.dev/a.png"><h1>H</h1><script type="application/ld+json">{}</script>';
assert.deepEqual(seoProblems(good, "/x"), []);
for (const [bad, why] of [
  [good.replace("/x", "/y"), /canonical/],
  [good + '<meta name="robots" content="noindex">', /noindex/],
  [good + "<h1>2</h1>", /2 <h1>/],
  [good.replace("<title>T</title>", ""), /title/],
  [good.replace('name="description" content="D"', ""), /description/],
  [good.replace('content="D"', 'content=""'), /no meta description/],
  [good.replace('content="D"', 'content="  "'), /no meta description/],
  [good.replace('property="og:image"', ""), /og:image/],
  [good.replace("{}", "{"), /JSON-LD block 1 doesn't parse/],
  [good.replace(/<script[\s\S]*<\/script>/, ""), /no JSON-LD/],
])
  assert.match(seoProblems(bad, "/x").join(" | "), why);
assert.deepEqual(seoProblems(good + '<script type="application/ld+json">[]</script>', "/x"), [], "two JSON-LD blocks are fine when both parse");
assert.match(headerProblems(new Headers({ ...EXPECT_HEADERS.all, "content-type": "text/plain", "x-robots-tag": "noindex" }), { type: "text/plain" }).join(), /x-robots-tag/);
ok(`seoProblems: ${shipped.length} shipped pages are self-canonical, indexable, with 1 h1, a title, a description, an og:image and JSON-LD that parses; headerProblems flags an X-Robots-Tag`);

// ── the sitemap: its <loc>s are exactly the shipped HTML pages (spec item 8), on https://imorchy.dev, no future lastmod ──
const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const today = new Date().toISOString().slice(0, 10);
assert.ok(locs.length >= 5);
assert.equal(new Set(locs).size, locs.length, "no loc twice");
for (const loc of locs) assert.ok(shipped.some((p) => ORIGIN + p.path === loc), `${loc} is in the sitemap but not a shipped HTML page in urls.mjs PAGES (or generated)`);
for (const p of shipped) assert.ok(locs.includes(ORIGIN + p.path), `${p.path} is a shipped HTML page but not in the sitemap: add it to content/pages.json and run node site/build.mjs`);
for (const [, d] of sitemap.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/g)) {
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(d <= today, `lastmod ${d} is not in the future`);
}
ok(`sitemap.xml: its ${locs.length} locs and the ${shipped.length} shipped HTML pages are the same set, both ways; no future lastmod`);

// ── robots.txt never shuts a search or AI-search crawler out of the whole site (spec item 3) ──
assert.deepEqual(robotsProblems(read("robots.txt")), [], "robots.txt");
for (const [txt, want] of [
  ["User-agent: *\nDisallow: /", 6],
  ["User-agent: *\nDisallow: /*", 6],
  ["User-agent: GPTBot\nUser-agent: OAI-SearchBot\nDisallow: /", 1],
  ["User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:", 1],
  ["User-agent: *\nDisallow: /\n\nUser-agent: Bingbot\nAllow: /", 5],
  ["user-agent: perplexitybot # AI search\ndisallow: / # oops", 1],
  ["User-agent: ClaudeBot\nDisallow: /", 0],
  ["User-agent: *\nDisallow: /private\nDisallow:\nSitemap: https://imorchy.dev/sitemap.xml", 0],
  // RFC 9309: Sitemap (and Crawl-delay, not in the RFC) aren't group members, so they don't split a group.
  ["User-agent: Googlebot\nSitemap: https://imorchy.dev/sitemap.xml\nUser-agent: Bingbot\nDisallow: /", 2],
  ["User-agent: Googlebot\nCrawl-delay: 5\nUser-agent: Bingbot\nDisallow: /", 2],
])
  assert.equal(robotsProblems(txt).length, want, JSON.stringify(txt));
ok("robots.txt: no Disallow: / or /* for *, Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User or PerplexityBot (groups with several User-agent lines parsed, and a Sitemap: or Crawl-delay: line doesn't split one; ClaudeBot left to the owner)");

// ── check-live's sitemap check: each <loc> is fetched on the domain under test; its canonical is the imorchy.dev loc ──
assert.equal(liveUrl("https://imorchy.dev/approvals", "imorchy.dev"), "https://imorchy.dev/approvals");
assert.equal(liveUrl("https://imorchy.dev/approvals", "staging.example.com"), "https://staging.example.com/approvals");
assert.equal(liveUrl("https://elsewhere.example/a", "staging.example.com"), "https://elsewhere.example/a", "a loc off imorchy.dev isn't rewritten, so check-live fails it");
const fetched = { status: 200, location: null, canon: ["https://imorchy.dev/approvals"] };
assert.equal(locProblem("https://imorchy.dev/approvals", fetched), null, "a staging copy names the imorchy.dev URL as canonical: that passes");
for (const [res, why] of [
  [{ ...fetched, canon: ["https://staging.example.com/approvals"] }, /canonical/],
  [{ ...fetched, canon: [] }, /canonical/],
  [{ ...fetched, canon: [fetched.canon[0], fetched.canon[0]] }, /canonical/],
  [{ ...fetched, status: 301, location: "/x" }, /HTTP 301 → \/x/],
])
  assert.match(locProblem("https://imorchy.dev/approvals", res) || "", why);
ok("check-live sitemap check: each <loc> is fetched on the domain under test, answers 200 itself, and has one canonical, the imorchy.dev loc (a staging run passes; production is as strict)");

// ── an unknown path is a plain 404 with the headers, not a redirect (spec item 5) ──
for (const p of [`/no-such-page-${Date.now().toString(36)}`, "/no-such-dir/page"]) {
  const res = await get(ORIGIN + p);
  assert.equal(res.status, 404, p);
  assert.equal(res.headers.get("Location"), null, `${p}: no redirect`);
  for (const [name, value] of Object.entries(EXPECT_HEADERS.all)) assert.equal(res.headers.get(name), value, `${p}: ${name}`);
}
ok("an unknown path answers 404, no Location, with HSTS, nosniff and Referrer-Policy");

// ── the content build (ADR points 1-3), on a fixture site in a temp folder ──
const fx = fs.mkdtempSync(path.join(os.tmpdir(), "orchy-build-"));
try {
  const put = (rel, text) => (fs.mkdirSync(path.dirname(path.join(fx, rel)), { recursive: true }), fs.writeFileSync(path.join(fx, rel), text));
  put("index.html", read("index.html"));
  put("assets/og-image.png", "png");
  put("content/pages.json", '[{ "path": "/", "lastmod": "2026-10-30" }]');
  put("content/blog/2026-10-31-first-post.md", "---\ntitle: First <post>\ndescription: A test post.\ndate: 2026-10-31\nupdated: 2026-11-01\nog_image: /assets/og-image.png\ncanonical: https://imorchy.dev/blog/first-post\n---\n# Why\n\nText with `code`, **bold**, [a link](/approvals) and [bad](javascript:alert(1)).\n\n<script>alert(1)</script>\n\n- one\n- two\n");
  put("content/changelog/2026-10-31-v1.md", "---\ntitle: v1\ndescription: The first release.\ndate: 2026-10-31\nsecurity: false\n---\nFirst release.\n");
  const out = build(fx, { today: "2026-11-02" });
  assert.deepEqual(out.problems, []);
  assert.deepEqual([...out.files.keys()].sort(), ["blog.html", "blog/first-post.html", "changelog.html", "feed.xml", "index.html", "sitemap.xml"]);
  assert.deepEqual(out.pages.map((p) => p.path), ["/blog", "/blog/first-post", "/changelog"]);
  const mapped = [...out.files.get("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)/g)].map((m) => m[1].slice(ORIGIN.length) + " " + m[2]);
  assert.deepEqual(mapped, ["/ 2026-10-30", "/blog 2026-11-01", "/blog/first-post 2026-11-01", "/changelog 2026-10-31"], "lastmod = updated || date; an index takes its newest entry");
  const post = out.files.get("blog/first-post.html");
  for (const p of out.pages) assert.deepEqual([...seoProblems(out.files.get(fileFor(p.path)), p.path), ...generatedProblems(out.files.get(fileFor(p.path)))], [], p.path);
  assert.ok(post.includes("<h1>First &lt;post&gt;</h1>") && out.pages[1].markers[0] === "<h1>First &lt;post&gt;</h1>", "the title is escaped, and the row's marker matches it");
  assert.ok(post.includes("<h2>Why</h2>") && post.includes("<code>code</code>") && post.includes('<a href="/approvals">a link</a>') && post.includes("<li>two</li>"));
  assert.ok(post.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !post.includes("javascript:"), "HTML in markdown is text; a javascript: link is dropped");
  assert.match(out.files.get("feed.xml"), /<updated>2026-11-01T00:00:00Z<\/updated>\n  <author>/);
  assert.deepEqual(build(fx, { today: "2026-11-02" }).files, out.files, "the same sources give the same bytes");
  for (const [rel, text] of out.files) put(rel, text);
  assert.deepEqual(staleFiles(fx, out.files), []);
  put("blog/first-post.html", post.replace("Why", "Who"));
  put("blog/old.html", post);
  assert.deepEqual(staleFiles(fx, out.files), ["blog/first-post.html", "blog/old.html (its source is gone: delete it)"]);
  // The command line: write mode rewrites the stale page but still exits 1 on the orphan, as --check does.
  const said = [];
  const say = { log: (m) => said.push(m), error: (m) => said.push(m) };
  assert.equal(cli(fx, [], say), 1, "write mode exits 1 on an orphaned output");
  assert.match(said.join("\n"), /site\/blog\/old\.html \(its source is gone: delete it\)/);
  assert.equal(fs.readFileSync(path.join(fx, "blog/first-post.html"), "utf8"), post, "write mode rewrote the stale page");
  assert.equal(cli(fx, ["--check"], say), 1, "--check exits 1 on the orphan too");
  fs.rmSync(path.join(fx, "blog/old.html"));
  assert.deepEqual([cli(fx, [], say), cli(fx, ["--check"], say)], [0, 0], "no orphan: both modes pass");
  for (const [file, text, why] of [
    ["content/blog/2026-12-01-later.md", "---\ntitle: L\ndescription: D\ndate: 2026-12-01\nog_image: /assets/og-image.png\ncanonical: https://imorchy.dev/blog/later\n---\n", /after today/],
    ["content/blog/2026-10-30-x.md", "---\ntitle: X\ndescription: D\ndate: 2026-10-30\nog_image: /assets/nope.png\ncanonical: https://imorchy.dev/blog/y\n---\n", /canonical must be[\s\S]*og_image/],
    ["content/blog/2026-10-30-x.md", "---\ntitle: X\ndate: 2026-10-30\nupdated: 2026-10-29\nog_image: /assets/og-image.png\ncanonical: https://imorchy.dev/blog/x\nauthor: me\n---\n", /unknown field "author"[\s\S]*missing description[\s\S]*updated is before date/],
    ["content/blog/2026-02-30-x.md", "---\ntitle: X\ndescription: D\ndate: 2026-02-30\nog_image: /assets/og-image.png\ncanonical: https://imorchy.dev/blog/x\n---\n", /isn't a real YYYY-MM-DD/],
    ["content/changelog/2026-10-30-fix.md", "---\ntitle: Fix\ndescription: D\ndate: 2026-10-30\nsecurity: true\n---\nRun `curl evil`.\n", /a security entry can't have code/],
    ["content/changelog/Fix.md", "x", /name it/],
    ["content/changelog/2026-10-30-pr.md", "---\ntitle: P\ndescription: D\ndate: 2026-10-30\nsecurity: false\n---\n- A fix. (PR #12)\n", /no PR numbers/],
    ["content/changelog/2026-10-30-pull.md", "---\ntitle: P\ndescription: D\ndate: 2026-10-30\nsecurity: false\n---\n- [A fix](https://github.com/x/y/pull/3)\n", /no PR numbers or \/pull\/ links/],
    ["index.html", "<!doctype html><title>x</title>", /index\.html: needs exactly one <footer>/],
    ["content/pages.json", '[{ "path": "/gone", "lastmod": "2026-10-30" }]', /\/gone has no page file/],
    ["content/pages.json", '{ "path": "/" }', /content\/pages\.json: must be a list/],
    ["content/blog/2026-10-29-first-post.md", "---\ntitle: F\ndescription: D\ndate: 2026-10-29\nog_image: /assets/og-image.png\ncanonical: https://imorchy.dev/blog/first-post\n---\n", /duplicate slug: blog\/first-post/],
    ["content/pages.json", '[{ "path": "/", "lastmod": "2026-10-30" }, { "path": "/blog", "lastmod": "2026-10-30" }]', /\/blog is a generated page/],
  ]) {
    const before = fs.existsSync(path.join(fx, file)) ? fs.readFileSync(path.join(fx, file)) : null;
    put(file, text);
    assert.match(build(fx, { today: "2026-11-02" }).problems.join(" | "), why, file);
    before ? fs.writeFileSync(path.join(fx, file), before) : fs.rmSync(path.join(fx, file));
  }
  // A UTF-8 BOM (Windows editors) is ignored in a source and in pages.json.
  assert.equal(parseSource("\uFEFF---\ntitle: X\n---\nBody\n").meta.title, "X");
  put("content/pages.json", '\uFEFF[{ "path": "/", "lastmod": "2026-10-30" }]');
  assert.deepEqual(build(fx, { today: "2026-11-02" }).problems, [], "pages.json with a BOM");
  // A pasted U+2028 in a list item used to stop the item from matching, and markdown() never advanced.
  assert.match(markdown("- a\u2028b\n- c"), /<li>a\u2028b<\/li>\s*<li>c<\/li>/);
  // A link needs https://, a site path or #: a browser reads //host, /\host and \\host as off-site, so they stay text.
  assert.equal(markdown("[a](//evil.example) [b](/\\evil.example) [c](\\\\evil.example) [d](/ok)"), '<p>a b c <a href="/ok">d</a></p>');
  // Emphasis stays out of link targets and code; a lone * between spaces is just a star.
  assert.match(markdown("[x](/p/*b*/) and *em* and `*c*` and 2 * 3 * 4"), /<a href="\/p\/\*b\*\/">x<\/a> and <em>em<\/em> and <code>\*c\*<\/code> and 2 \* 3 \* 4/);
  fs.rmSync(path.join(fx, "content", "blog"), { recursive: true });
  fs.rmSync(path.join(fx, "content", "changelog"), { recursive: true });
  assert.deepEqual([...build(fx, { today: "2026-11-02" }).files.keys()], ["index.html", "sitemap.xml"], "no content: only the sitemap and the footer stamped on the hand-written page");
} finally {
  fs.rmSync(fx, { recursive: true, force: true });
}
ok("build.mjs: blog + changelog fixture → pages, feed and sitemap that pass seoProblems and load no script; escaped HTML, safe links; same bytes twice; stale and orphaned outputs found, and write mode exits 1 on an orphan as --check does; bad sources (blank description, non-list pages.json, duplicate slug) fail");

// ── one address: 301 straight to the https://imorchy.dev URL, which answers 200 (one hop, no loop) ──
for (const { from, to } of REDIRECTS) {
  const res = await get(from);
  assert.equal(res.status, 301, from);
  assert.equal(res.headers.get("Location"), to, from);
  assert.equal(res.headers.get("Strict-Transport-Security"), from.startsWith("https:") ? "max-age=31536000" : null, `${from}: HSTS on https only`);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  const next = await get(to);
  assert.equal(next.status, 200, `${to} answers 200, no second hop`);
}
ok("http:// and www. answer 301 with Location kept, then 200 on https://imorchy.dev; HSTS only on the https answers");

// ── the calls to action on /: outbound, new tab, noopener, on their host ──
const home = read("index.html");
for (const { text, host } of LINKS) {
  const anchors = [...home.matchAll(/<a\b([^>]*)>\s*([^<]*)/g)].filter((m) => m[2].trim().startsWith(text));
  assert.ok(anchors.length, `/ links "${text}"`);
  for (const [, attrs] of anchors) {
    assert.equal(new URL(/href="([^"]+)"/.exec(attrs)[1]).host, host, text);
    assert.match(attrs, /target="_blank"/, text);
    assert.match(attrs, /rel="[^"]*noopener/, text);
  }
}
ok("/ has the early-access and booking links, each opening its own host in a new tab with rel=noopener");

// ── nothing loads from a host outside the allowlist (scripts, styles, images, fonts, frames, media, imports) ──
const outside = (text, allowed) =>
  [...text.matchAll(/(?:\b(?:src|srcset|data|poster)="|<link\b[^>]*\bhref="|url\(\s*['"]?|@import\s+['"]|"imports"\s*:\s*\{[^}]*?")((?:https?:)?\/\/[^/"')\s]+)/g)]
    .map((m) => new URL(m[1], ORIGIN).host)
    .filter((h) => h !== new URL(ORIGIN).host && !allowed.includes(h));
for (const page of PAGES.filter((p) => p.profile && exists(p.path))) assert.deepEqual(outside(read(fileFor(page.path)), LOAD_HOSTS[page.path] || []), [], page.path);
assert.deepEqual(outside(read("styles.css"), []), [], "styles.css");
assert.deepEqual(outside('<img src="https://example.com/x.png">', []), ["example.com"], "the scan sees an outside load");
ok("no page or stylesheet loads from a host outside the allowlist (cdn.jsdelivr.net, on / only)");

// ── the wrapper keeps status, body and every header: 304, video 206/416, redirects ──
const etag = (await get(ORIGIN + "/")).headers.get("ETag");
let res = await get(ORIGIN + "/", { "If-None-Match": etag });
assert.equal(res.status, 304);
assert.equal(res.headers.get("ETag"), etag);
assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
res = await get(ORIGIN + "/assets/video.mp4", { Range: "bytes=100-199" });
assert.equal(res.status, 206);
assert.equal(res.headers.get("Content-Range"), "bytes 100-199/3000");
assert.equal(res.headers.get("Content-Length"), "100");
assert.equal(res.headers.get("ETag"), '"v9"');
assert.equal(res.headers.get("Accept-Ranges"), "bytes");
assert.equal(res.headers.get("Content-Security-Policy"), null, "no CSP on the video");
assert.deepEqual(new Uint8Array(await res.arrayBuffer()), VIDEO.slice(100, 200));
res = await get(ORIGIN + "/assets/video.mp4", { Range: "bytes=3000-" });
assert.equal(res.status, 416);
assert.equal(res.headers.get("Content-Range"), "bytes */3000");
res = await get(ORIGIN + "/assets/video.mp4", { "If-None-Match": '"v9"' });
assert.equal(res.status, 304);
assert.equal(res.headers.get("ETag"), '"v9"');
for (const [name, value] of Object.entries(EXPECT_HEADERS.all)) assert.equal(res.headers.get(name), value, name);
const samples = [
  new Response(null, { status: 304, headers: { ETag: '"a"', "Cache-Control": "no-cache" } }),
  new Response("part", { status: 206, statusText: "Partial Content", headers: { "Content-Range": "bytes 0-3/9", "Content-Type": "video/mp4" } }),
  new Response(null, { status: 416, headers: { "Content-Range": "bytes */9" } }),
  Response.redirect("https://imorchy.dev/a?b=1", 301),
  new Response("<p>", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Other": "kept" } }),
];
for (const before of samples) {
  const kept = [...before.headers];
  const after = withSecurityHeaders(before, new URL(ORIGIN + "/x"));
  assert.equal(after.status, before.status);
  assert.equal(after.statusText, before.statusText);
  for (const [name, value] of kept) assert.equal(after.headers.get(name), value, `${before.status} keeps ${name}`);
  assert.equal(after.headers.get("X-Content-Type-Options"), "nosniff");
}
assert.equal(await withSecurityHeaders(new Response("body bytes"), new URL(ORIGIN)).text(), "body bytes");
ok("the headers wrapper keeps status, body, ETag, Location, Content-Range and every other header: 304 (assets and video), 206, 416, 301, 404");
console.log("test-urls: all passed");
