// Offline checks for the landing pages' search markup: every FAQPage question and answer in a page's JSON-LD
// appears word for word in that page's visible text, no offers are claimed, and no page links to GitHub or
// makes an open-licence claim. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build, fileFor, footer, FOOTER_COLUMNS, header, FEATURES, SHELL_SCRIPTS, STYLE_LINKS } from "../build.mjs";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ok = (name) => console.log(`ok - ${name}`);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘" };
const decode = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m,
  );
const squash = (s) => s.replace(/\s+/g, " ").trim();

/** The text a reader sees: no scripts, styles or tags, entities decoded, whitespace collapsed. */
export function visibleText(html) {
  const body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  // Inline tags join their text ("Email <a>x</a>." reads "Email x."); every other tag breaks words.
  return squash(decode(body.replace(/<\/?(a|span|strong|em|b|i|code)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ")));
}

/** Every schema.org node in the page's JSON-LD blocks, @graph flattened. */
export function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  return blocks.flatMap(([, raw]) => {
    const data = JSON.parse(raw);
    return [data].flat().flatMap((d) => d["@graph"] || [d]);
  });
}

const pages = fs.readdirSync(SITE).filter((f) => f.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(f));
assert.ok(pages.includes("index.html"));
let checked = 0;
for (const page of pages) {
  const html = fs.readFileSync(SITE + page, "utf8");
  const nodes = jsonLd(html);
  const text = visibleText(html);
  for (const faq of nodes.filter((n) => n["@type"] === "FAQPage")) {
    assert.ok(faq.mainEntity?.length, `${page}: FAQPage has questions`);
    for (const q of faq.mainEntity) {
      assert.ok(text.includes(squash(q.name)), `${page}: question not in the visible text: ${q.name}`);
      const answer = squash(q.acceptedAnswer.text);
      assert.ok(text.includes(answer), `${page}: answer not in the visible text: ${answer.slice(0, 60)}…`);
      checked++;
    }
  }
  assert.ok(!JSON.stringify(nodes).includes('"offers"'), `${page}: structured data claims no offers or price`);
  assert.ok(!/github\.com/i.test(html), `${page}: no GitHub links (no public GitHub)`);
  // The legal pages name a third-party tool ("the open-source tool age"); that's not a claim about Orchy's licence.
  assert.ok(!/open[\s-]source/i.test(html.replaceAll("the open-source tool age", "")), `${page}: no open-licence claim`);
}
assert.ok(jsonLd(fs.readFileSync(SITE + "index.html", "utf8")).some((n) => n["@type"] === "FAQPage"), "index.html has a FAQPage");
ok(`FAQPage JSON-LD matches the visible FAQ (${checked} Q&As on ${pages.length} page(s))`);
ok("no offers in structured data, no GitHub links and no open-licence claim on any page");

// ── the answer pages: plain HTML with no scripts but JSON-LD, one H1, a unique title, a self-canonical at the
// extensionless path Cloudflare serves, the shared og image, links home and to the form, in the sitemap, linked from home ──
// v4 (2026-11-18): the five feature pages. agents and apps are new; security moved from the legal set to here.
const ANSWER = ["approvals", "client-workspaces", "agents", "apps", "security"];
const LINKED_FROM_HOME = ["approvals", "client-workspaces"]; // agents and apps join the nav with the v4 shell
const home = fs.readFileSync(SITE + "index.html", "utf8");
const sitemap = fs.readFileSync(SITE + "sitemap.xml", "utf8");
const head = (html, re) => html.match(re)?.[1];
const titles = new Set([head(home, /<title>([^<]+)<\/title>/)]);
const descriptions = new Set([head(home, /name="description"\s+content="([^"]+)"/)]);
// What every content page shares: it exists, one H1, self-canonical, og:url and og:image, no scripts but JSON-LD,
// a title and description no other page uses, and a sitemap entry. Returns the page's HTML.
const contentPage = (slug) => {
  assert.ok(pages.includes(`${slug}.html`), `${slug}.html exists`);
  const html = fs.readFileSync(SITE + `${slug}.html`, "utf8");
  const url = `https://imorchy.dev/${slug}`;
  assert.equal(html.match(/<h1\b/gi)?.length, 1, `${slug}: exactly one H1`);
  assert.ok(html.includes(`<link rel="canonical" href="${url}" />`), `${slug}: self-canonical`);
  assert.ok(html.includes(`<meta property="og:url" content="${url}" />`), `${slug}: og:url`);
  assert.ok(html.includes('<meta property="og:image" content="https://imorchy.dev/assets/og-image.png" />'), `${slug}: og:image`);
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const allowed = ['<script type="application/ld+json">', ...SHELL_SCRIPTS.map((t) => t.replace("</script>", ""))];
  assert.ok(scripts.every((s) => allowed.includes(s)), `${slug}: no scripts but JSON-LD and the shell's (nav, beacon)`);
  const title = head(html, /<title>([^<]+)<\/title>/);
  const description = head(html, /name="description" content="([^"]+)"/);
  assert.ok(title && !titles.has(title), `${slug}: unique title`);
  assert.ok(description && !descriptions.has(description), `${slug}: unique meta description`);
  titles.add(title);
  descriptions.add(description);
  assert.ok(sitemap.includes(`<loc>${url}</loc>`), `${slug}: in sitemap.xml`);
  return html;
};
for (const slug of ANSWER) {
  const html = contentPage(slug);
  assert.ok(jsonLd(html).some((n) => n["@type"] === "FAQPage"), `${slug}: FAQPage JSON-LD`);
  assert.ok(!/<canvas|importmap|three\.module/i.test(html), `${slug}: no canvas or Three.js`);
  assert.ok(html.includes('href="/"'), `${slug}: links home`);
  const ctas = [...html.matchAll(/href="\/go\/start\?from=([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(ctas.includes(`${slug}-hero`) && ctas.includes(`${slug}-final`), `${slug}: hero and final CTAs go through /go/start`);
  assert.doesNotMatch(html, /early.access|by hand|in beta|bring your own|bring a key/i, `${slug}: launch copy, no early access, hand approval, beta or own key`);
  assert.ok(!html.includes("app.imorchy.dev") && !html.includes("notion.site"), `${slug}: no direct app link, no Notion form`);
  assert.ok(/<div class="scene" data-scene id="demo-[a-z-]+">/.test(html), `${slug}: the demo frame has a stable id`);
  assert.doesNotMatch(html.match(/<main\b[\s\S]*<\/main>/)[0], /\b(Facebook|Instagram|Shopify)\b/,`${slug}: no Facebook, Instagram or Shopify in the page body`);
  if (LINKED_FROM_HOME.includes(slug)) assert.ok((home.match(new RegExp(`href="/${slug}"`, "g")) || []).length >= 1, `${slug}: linked from the home nav`);
}
// v4 copy: "human-in-the-loop" is in the approved meta description (Ruby), not in the body text.
assert.match(fs.readFileSync(SITE + "approvals.html", "utf8"), /name="description" content="Human-in-the-loop by default/, "/approvals meta says human-in-the-loop");
assert.ok(fs.readFileSync(SITE + "apps.html", "utf8").includes("Inbox agent · Gmail<span"), "/apps: the last Inbox agent row names Gmail");
assert.ok(fs.readFileSync(SITE + "security.html", "utf8").includes('href="/.well-known/security.txt"'), "/security links security.txt");
// v4 retires /local and /claude-code-orchestrator: the Worker 301s them home (test-urls.mjs), so no file ships.
for (const gone of ["local", "claude-code-orchestrator"]) assert.ok(!pages.includes(`${gone}.html`), `${gone}.html is retired`);
assert.ok(pages.length >= 3, "home plus the answer pages are checked");
ok("answer pages: one H1, unique title and description, self-canonical, og image, FAQPage, no scripts but the shell's, in the sitemap, linked from home");

// ── the legal pages (Jan, 2026-11-04): the approved text as plain HTML, indexable, no scripts but JSON-LD, no draft
// markers, headings in order, every table in a labelled, focusable scroll box (readable at 360px), linked from the footer ──
// (2026-11-11) v2 texts add the DPA at /dpa, linked from Data Privacy. (2026-11-18, v4 kit footer) Legal is Privacy · Terms;
// Security, Data privacy and DPA sit in the Security column. /security is a v4 feature page now (lane B), tested with them.
const LEGAL = { privacy: "Privacy Policy", terms: "Terms of Use", "data-privacy": "Data Privacy: DPA and sub-processors", dpa: "Data Processing Agreement (DPA)" };
for (const [slug, h1] of Object.entries(LEGAL)) {
  const html = contentPage(slug);
  assert.ok(html.includes(`<h1>${h1}</h1>`), `${slug}: the H1 is "${h1}"`);
  assert.doesNotMatch(html, /name="robots"/i, `${slug}: no robots meta`);
  assert.ok(jsonLd(html).some((n) => n["@type"] === "WebPage" && n.url === `https://imorchy.dev/${slug}` && n.name === h1), `${slug}: WebPage JSON-LD`);
  assert.doesNotMatch(html, /\[\[|\]\]|DRAFT|TODO|<!--|READY TO PUBLISH|not for publication/i, `${slug}: no placeholders, draft box, comments or revision notes`);
  assert.doesNotMatch(visibleText(html), /\bPR\s*#\d+/i, `${slug}: no PR numbers`);
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  levels.forEach((l, i) => i && assert.ok(l <= levels[i - 1] + 1, `${slug}: heading h${l} skips a level after h${levels[i - 1]}`));
  const tables = html.match(/<table\b/g)?.length ?? 0;
  const boxed = html.match(/<div class="(?:table-scroll|tbl)" role="region" tabindex="0" aria-label="Table: [^"]+"><table>/g)?.length ?? 0;
  assert.equal(boxed, tables, `${slug}: every table sits in a labelled scroll box`);
  if (slug === "privacy") assert.equal(tables, 3, "privacy.html has its three tables");
  if (slug !== "security") {
    // v4 legal (changes.md v6): Version 3.0, a "What changed" box, and no call, booking or desktop-app text outside it
    assert.match(html, /Last updated: \d{1,2} [A-Z][a-z]+ 2026 · Version 3\.\d/, `${slug}: Version 3.x header line`);
    const box = html.match(/<aside class="changed"[\s\S]*?<\/aside>/)?.[0];
    assert.ok(/What changed in Version 3\.\d/.test(box ?? ""), `${slug}: "What changed" box`);
    const rest = visibleText(html.replace(box, ""));
    assert.doesNotMatch(rest, /access call|booking|Calendly|Granola|Google Meet|setup call|transcript|call audio|desktop app/i, `${slug}: no call, booking or desktop-app text outside the box (X-check)`);
    assert.doesNotMatch(rest, /\bMIT\b/, `${slug}: no MIT licence text`);
    // changes v7 addendum (2026-11-18): at most 3 bullets in the box, no OVH city (Jan never confirmed one)
    assert.ok((box.match(/<li>/g)?.length ?? 0) <= 3, `${slug}: "What changed" box has at most 3 bullets`);
    assert.doesNotMatch(html, /Beauharnois/, `${slug}: no OVH city`);
    if (slug === "data-privacy") assert.ok(html.includes(`Last updated: ${html.match(/Last updated: (\d{1,2} [A-Z][a-z]+ 2026) · Version/)[1]}.</p>`), "data-privacy: the sub-processor date equals the header date");
    if (slug === "terms") assert.doesNotMatch(html.match(/<h2 id="s17">[\s\S]*?<\/p>/)[0], /the app,/, "terms: §17 no longer says \"the app,\"");
  }
  assert.ok(FOOTER_COLUMNS.some((c) => ["Legal", "Security"].includes(c.heading) && c.links.some(([, h]) => h === `/${slug}`)), `${slug}: in the footer's Legal or Security group`);
}
assert.deepEqual(FOOTER_COLUMNS.find((c) => c.heading === "Legal").links.map(([t]) => t), ["Privacy", "Terms"], "the footer's Legal column is exactly Privacy · Terms");
assert.deepEqual(FOOTER_COLUMNS.find((c) => c.heading === "Security").links.map(([t]) => t), ["Security", "Data privacy", "DPA"], "the footer's Security column is exactly Security · Data privacy · DPA");
assert.ok(fs.readFileSync(SITE + "data-privacy.html", "utf8").includes('<a href="/dpa">'), "Data Privacy links the DPA at /dpa");
ok(`legal pages: ${Object.keys(LEGAL).length} pages, one H1 each, indexable, no scripts or placeholders, tables in scroll boxes, in the sitemap and the footer`);

// ── one logo (Jan, 2026-10-31): every page's tab icon is orchy-icon-64.png, cut from orchy-main.svg; the old robot
// favicon.svg is gone and no page names it ──
const ICON = /^\/?assets\/orchy-icon-64\.png$/;
for (const page of pages) {
  const html = fs.readFileSync(SITE + page, "utf8");
  const icons = [...html.matchAll(/<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/gi)].map((m) => m[0]);
  assert.equal(icons.length, 1, `${page}: exactly one icon link`);
  assert.match(icons[0].match(/\bhref="([^"]+)"/)?.[1] ?? "", ICON, `${page}: icon is orchy-icon-64.png`);
  assert.ok(icons[0].includes('type="image/png"'), `${page}: icon type is image/png`);
  assert.ok(!/favicon\.svg|lilorchy/i.test(html), `${page}: no old robot icon (favicon.svg, lilorchy)`);
}
assert.ok(!fs.existsSync(SITE + "favicon.svg"), "favicon.svg (the old robot) is removed");
assert.ok(fs.existsSync(SITE + "assets/orchy-icon-64.png"), "assets/orchy-icon-64.png exists");
ok(`one logo: all ${pages.length} pages use orchy-icon-64.png as their only tab icon, none names favicon.svg`);

// ── one footer (Jan, 2026-11-03): every shipped page has build.mjs's shared footer, the same on all of them except
// the back link and aria-current, and every site link in it resolves to a page in the sitemap or a built file ──
const SHIPPED = ["index", ...ANSWER, "changelog", ...Object.keys(LEGAL)];
for (const slug of SHIPPED) assert.ok(pages.includes(`${slug}.html`), `${slug}.html exists`);
const pathOf = (page) => (page === "index.html" ? "/" : "/" + page.replace(/\.html$/, ""));
const locs = [...fs.readFileSync(SITE + "sitemap.xml", "utf8").matchAll(/<loc>https:\/\/imorchy\.dev([^<]*)<\/loc>/g)].map((m) => m[1]);
const built = build(SITE).files;
const same = new Set();
for (const page of pages) {
  const html = fs.readFileSync(SITE + page, "utf8");
  const footers = html.match(/<footer\b[\s\S]*?<\/footer>/gi) || [];
  assert.equal(footers.length, 1, `${page}: exactly one footer`);
  assert.equal(footers[0], footer(pathOf(page)).trim(), `${page}: footer is build.mjs's shared one (run node build.mjs)`);
  const nav = footers[0];
  for (const [, link] of nav.matchAll(/<a href="([^"]+)"/g)) {
    if (/^https:\/\//.test(link)) continue;
    const href = link.split("#")[0] || "/"; // /#how is a section of the home page
    assert.match(href, /^\/[a-z0-9./-]*$/, `${page}: footer link ${link} is a site path`);
    assert.ok(fs.existsSync(SITE + fileFor(href)) && (locs.includes(href) || built.has(fileFor(href))), `${page}: footer link ${link} resolves to a built page`);
  }
  const current = [...nav.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);
  // Every page but home is a footer link, so it marks itself; home's links are #sections, not "/".
  const linked = FOOTER_COLUMNS.some((c) => c.links.some(([, h]) => h === pathOf(page)));
  assert.deepEqual(current, linked ? [pathOf(page)] : [], `${page}: aria-current marks this page only`);
  same.add(footers[0].replace(/ aria-current="page"/g, ""));
}
assert.equal(same.size, 1, "every page has the identical footer, apart from aria-current");
// v4.1 removed home sections: no page may link a /#id that index.html no longer has
const homeIds = new Set([...fs.readFileSync(SITE + "index.html", "utf8").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
for (const page of pages) {
  for (const [, id] of fs.readFileSync(SITE + page, "utf8").matchAll(/href="\/#([^"]+)"/g)) {
    assert.ok(homeIds.has(id), `${page}: link /#${id} has no matching id on the home page`);
  }
}
assert.ok(footer("/").includes('<footer class="site" id="site-footer">'), "the footer is the kit's footer.site, the no-JS Menu target");
assert.ok(FOOTER_COLUMNS.flatMap((c) => c.links).some(([t, h]) => t === "Changelog" && h === "/changelog"), "the footer links /changelog");
assert.ok(FOOTER_COLUMNS.flatMap((c) => c.links).some(([t, h]) => t === "Blog" && h === "/blog"), "the footer links /blog");
// Orchy's social accounts, in this order (Jan, 2026-11-18: Facebook, X, Instagram, YouTube). The home page's Organization sameAs names the same four.
const SOCIAL = [
  ["Facebook", "https://www.facebook.com/OrchyAI/"],
  ["X", "https://x.com/OrchyAI"],
  ["Instagram", "https://www.instagram.com/orchyai/"],
  ["YouTube", "https://www.youtube.com/@orchy-ai"],
];
assert.deepEqual(FOOTER_COLUMNS.find((c) => c.heading === "Follow")?.links, SOCIAL, "the footer's Follow column links Facebook, X, Instagram and YouTube, in that order");
for (const [, url] of SOCIAL) assert.ok(footer("/").includes(`<a href="${url}" target="_blank" rel="noopener noreferrer">`), `footer opens ${url} in a new tab, safely`);

// ── one header (v4 shell, 2026-11-18): every shipped page has build.mjs's kit header and both kit stylesheets
// before styles.css; aria-current marks only the page's own link; the Features menu is the five approved items;
// without JS the nav still works (Features and Menu → the footer, which lists every page) ──
assert.deepEqual(FEATURES.map(([n]) => n), ["Client workspaces", "Approvals", "Agents & Agent Builder", "Apps (One)", "Security"], "Features menu: the five approved items, in order");
for (const page of pages) {
  const html = fs.readFileSync(SITE + page, "utf8");
  const headers = html.match(/<header class="nav"[\s\S]*?<\/header>/g) || [];
  assert.equal(headers.length, 1, `${page}: exactly one site header`);
  assert.equal(headers[0], header(pathOf(page)).trim(), `${page}: header is build.mjs's shared one (run node build.mjs)`);
  assert.doesNotMatch(headers[0], /Teams|huddle/i, `${page}: no Teams & huddles in the nav`);
  const current = [...headers[0].matchAll(/<a [^>]*href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);
  assert.ok(current.every((h) => h === pathOf(page)) && current.length <= 1, `${page}: header aria-current marks this page only`);
  for (const fallback of ['href="#site-footer"', 'href="/go/start?from=nav"']) assert.ok(headers[0].includes(fallback), `${page}: header has ${fallback}`);
  assert.doesNotMatch(html, /Get early access|\/go\/early-access/, `${page}: no "Get early access" CTA left`);
  const css = html.indexOf(STYLE_LINKS.trim()), v3 = html.indexOf('href="/styles.css"');
  // v4 pages are kit-only; a v3 page still links /styles.css, after the kit.
  assert.ok(css > 0 && (v3 === -1 || v3 > css), `${page}: links /css/tokens.css and /css/components.css (before /styles.css, if any)`);
  for (const tag of SHELL_SCRIPTS) assert.equal(html.split(tag).length - 1, 1, `${page}: ${tag.slice(0, 40)}… exactly once (in the header)`);
}
ok(`one header: all ${pages.length} pages share build.mjs's kit header, five Features items, no-JS fallbacks, kit stylesheets`);
const org = [...fs.readFileSync(SITE + "index.html", "utf8").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((m) => [JSON.parse(m[1])]).flatMap((j) => j["@graph"] ?? [j]).find((n) => n["@type"] === "Organization");
assert.deepEqual([...(org?.sameAs ?? [])].sort(), SOCIAL.map(([, u]) => u).sort(), "index.html's Organization sameAs lists the four social accounts");
ok(`one footer: all ${pages.length} pages carry the shared footer; its site links resolve to built pages`);

// ── the changelog names no pull requests (Jan, 2026-11-03): no "PR #nn" and no /pull/ links in the page or the feed ──
for (const file of ["changelog.html", "feed.xml"]) {
  const text = fs.readFileSync(SITE + file, "utf8");
  assert.doesNotMatch(visibleText(text), /\bPR\s*#\d+/i, `${file}: no PR numbers`);
  assert.doesNotMatch(text, /\bPR\s*#\d+|\/pull\//i, `${file}: no PR numbers or /pull/ links`);
}
ok("changelog.html and feed.xml name no PR numbers and link no /pull/ pages");

// The checker itself catches drift: an answer that isn't on the page fails.
assert.ok(!visibleText("<p>Orchy asks first.</p>").includes("Orchy never asks."));
assert.equal(visibleText("<h3>It&#39;s <b>local</b></h3><script>x</script>"), "It's local");
ok("visibleText drops tags and scripts and decodes entities");
