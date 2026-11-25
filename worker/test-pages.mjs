// Offline checks for the site's pages and their search markup: every FAQPage question and answer in a page's JSON-LD
// appears word for word in that page's visible text, every price the JSON-LD claims is on /pricing (Nora, 2026-11-25),
// no page links to GitHub or makes an open-licence claim, and every page shares one header, one footer and one logo.
// 2026-11 redesign: the pages are hand-built (one /shared/site.css and /shared/site.js), so these checks read the
// files rather than build.mjs's old shell. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, fileFor } from "../build.mjs";

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
  return squash(decode(body.replace(/<\/?(a|span|strong|em|b|i|code|small)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ")));
}

/** Every schema.org node in the page's JSON-LD blocks, @graph flattened. */
export function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  return blocks.flatMap(([, raw]) => {
    const data = JSON.parse(raw);
    return [data].flat().flatMap((d) => d["@graph"] || [d]);
  });
}

/** Every served page (top level and one folder down), as a site-relative path. */
const SKIP = new Set(["shared", "worker", "node_modules", "content", "assets", ".well-known", ".git"]);
const walk = (dir) =>
  fs.readdirSync(path.join(SITE, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? SKIP.has(e.name) || dir ? [] : walk(e.name)
      : e.name.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(e.name) ? [dir ? `${dir}/${e.name}` : e.name] : [],
  );
const pages = walk("");
const read = (page) => fs.readFileSync(SITE + page, "utf8");
const pathOf = (page) => (page === "index.html" ? "/" : "/" + page.replace(/\.html$/, ""));
assert.ok(pages.includes("index.html"));
assert.equal(pages.length, 23, "the 23 site pages");

// ── search markup backed by the page: FAQ parity, prices, no GitHub, no open-licence claim ──
const pricing = read("pricing.html");
const plans = pricing.match(/<li class="plan\b/g)?.length ?? 0;
const pricingText = visibleText(pricing);
let checked = 0, offers = 0;
for (const page of pages) {
  const html = read(page);
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
  // Pricing is public (Nora, 2026-11-25): Offer markup is fine only if /pricing backs every number it claims.
  for (const node of nodes) {
    for (const offer of [node.offers ?? []].flat()) {
      offers++;
      for (const key of ["price", "lowPrice", "highPrice"]) {
        if (offer[key] === undefined) continue;
        assert.match(String(offer[key]), /^\d+(\.\d+)?$/, `${page}: ${key} is a plain number`);
        assert.ok(new RegExp(`\\$${offer[key]}\\b`).test(pricingText), `${page}: JSON-LD ${key} $${offer[key]} is shown on pricing.html`);
      }
      if (offer.priceCurrency) assert.equal(offer.priceCurrency, "USD", `${page}: offers are in USD`);
      if (offer.offerCount !== undefined) assert.equal(offer.offerCount, plans, `${page}: offerCount equals the ${plans} plans on pricing.html`);
    }
  }
  assert.ok(!/github\.com/i.test(html), `${page}: no GitHub links (no public GitHub)`);
  // The legal pages name a third-party tool ("the open-source tool age"); that's not a claim about Orchy's licence.
  assert.ok(!/open[\s-]source/i.test(html.replaceAll("the open-source tool age", "")), `${page}: no open-licence claim`);
  assert.doesNotMatch(text, /canada/i, `${page}: no "Canada" (Jan: removed everywhere, legal pages included)`);
}
assert.equal(plans, 4, "pricing.html shows the four plans");
assert.ok(offers >= 1, "at least one page has Offer markup to check");
assert.ok(jsonLd(read("index.html")).some((n) => n["@type"] === "FAQPage"), "index.html has a FAQPage");
ok(`FAQPage JSON-LD matches the visible FAQ (${checked} Q&As on ${pages.length} pages)`);
ok(`${offers} JSON-LD offer(s): every price is on pricing.html and offerCount is the ${plans} visible plans`);
ok("no GitHub links, no open-licence claim and no \"Canada\" on any page");

// ── every page: one H1, self-canonical at the extensionless path, og:url and og:image, a unique title and
// description, only our own scripts (JSON-LD, /shared/*.js deferred, the Cloudflare beacon), in the sitemap,
// and the start CTAs go through /go/start (never straight to the app's sign-up or a Notion form) ──
const sitemap = read("sitemap.xml");
const head = (html, re) => html.match(re)?.[1];
const titles = new Set(), descriptions = new Set();
const SCRIPTS = [
  '<script type="application/ld+json">',
  '<script src="/shared/site.js" defer>',
  '<script src="/shared/demo.js" defer>',
  '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"',
];
for (const page of pages) {
  const html = read(page);
  const url = `https://imorchy.dev${pathOf(page)}`;
  assert.equal(html.match(/<h1\b/gi)?.length, 1, `${page}: exactly one H1`);
  assert.equal(head(html, /<link rel="canonical" href="([^"]+)"/), url, `${page}: self-canonical`);
  assert.equal(head(html, /<meta property="og:url" content="([^"]+)"/), url, `${page}: og:url`);
  const og = head(html, /<meta property="og:image" content="https:\/\/imorchy\.dev\/([^"]+)"/);
  assert.ok(og && fs.existsSync(SITE + og), `${page}: og:image is a shipped file (${og})`);
  for (const tag of html.match(/<script\b[^>]*>/gi)) assert.ok(SCRIPTS.some((s) => tag.startsWith(s)), `${page}: unexpected script ${tag}`);
  assert.equal(html.split('<script src="/shared/site.js" defer>').length - 1, 1, `${page}: site.js exactly once`);
  assert.equal(html.split("static.cloudflareinsights.com/beacon.min.js").length - 1, 1, `${page}: the beacon exactly once`);
  assert.ok(!/importmap|three\.module|<canvas/i.test(html), `${page}: no Three.js or canvas`);
  const title = head(html, /<title>([^<]+)<\/title>/), description = head(html, /<meta name="description" content="([^"]+)"/);
  assert.ok(title && !titles.has(title), `${page}: unique title`);
  assert.ok(description && !descriptions.has(description), `${page}: unique meta description`);
  titles.add(title), descriptions.add(description);
  assert.ok(sitemap.includes(`<loc>${url}</loc>`), `${page}: in sitemap.xml`);
  const main = html.match(/<main\b[\s\S]*<\/main>/)?.[0] ?? "";
  assert.ok(main, `${page}: has a <main>`);
  assert.ok(!/href="[^"]*(notion\.site|polar\.sh\/(?!legal\/)|app\.imorchy\.dev\/(sign-?up|register))/.test(main), `${page}: no Notion form, checkout or sign-up link in the page body`);
  // The changelog is history (it may say what was in beta then); every other page speaks for today.
  if (page !== "changelog.html") assert.doesNotMatch(main.replace(/<h2 id="v3-changes">[\s\S]*?<\/ul>/, ""), /early.access|in beta|bring.your.own (AI )?key|own AI key/i, `${page}: launch copy, no early access, beta or own key (the legal "What changed" box is history)`);
  assert.ok(html.includes('href="/go/start?from=final"') && html.includes('href="/go/start?from=nav"'), `${page}: nav and final CTAs go through /go/start`);
}
// /local and /claude-code-orchestrator are retired: the Worker 301s them home (test-urls.mjs), so no file ships.
for (const gone of ["local", "claude-code-orchestrator"]) assert.ok(!pages.includes(`${gone}.html`), `${gone}.html is retired`);
ok(`all ${pages.length} pages: one H1, self-canonical, og image, unique title and description, own scripts only, in the sitemap, CTAs via /go/start`);

// ── /pricing (Jan, 2026-11-24): four plans as text; each card passes its plan to the app's picker through
// /go/start (main.mjs forwards plan and interval); Starter is monthly only ──
for (const plan of ["Starter", "Solo", "Pro", "Business"]) assert.ok(pricing.includes(`<h3>${plan}</h3>`), `pricing: the ${plan} plan`);
for (const [page, from] of [["pricing.html", "pricing"], ["index.html", "home"]]) {
  for (const plan of ["starter", "solo", "pro", "business"])
    assert.ok(read(page).includes(`href="/go/start?from=${from}-${plan}&amp;plan=${plan}&amp;interval=month"`), `${page}: ${plan} card links to the app's plan picker`);
}
assert.ok(!pricing.includes('data-m="$9" data-y'), "pricing: Starter has no yearly price");
assert.match(read("shared/site.js"), /interval=' \+ \(show \? 'year' : 'month'\)/, "the Monthly/Yearly toggle switches the cards' interval");
assert.ok(jsonLd(pricing).some((n) => n["@type"] === "FAQPage"), "pricing: FAQPage JSON-LD");
ok("pricing: four plans, plan picker links (Yearly switches the interval), FAQPage");

// ── the legal pages (Jan, 2026-11-04): indexable, a WebPage node, no draft markers, headings in order, every table in
// a labelled, focusable scroll box (readable at 360px), Version 3.x with a short "What changed" box ──
const LEGAL = { privacy: "Privacy Policy", terms: "Terms of Use", "data-privacy": "Data Privacy: DPA and sub-processors", dpa: "Data Processing Agreement (DPA)" };
for (const [slug, h1] of Object.entries(LEGAL)) {
  const html = read(`${slug}.html`);
  assert.match(html, new RegExp(`<h1\\b[^>]*>${h1.replace(/[()]/g, "\\$&")}</h1>`), `${slug}: the H1 is "${h1}"`);
  assert.doesNotMatch(html, /name="robots"/i, `${slug}: no robots meta`);
  assert.ok(jsonLd(html).some((n) => n["@type"] === "WebPage" && n.url === `https://imorchy.dev/${slug}`), `${slug}: WebPage JSON-LD`);
  assert.doesNotMatch(html, /\[\[|\]\]|\bDRAFT\b|TODO|<!--|READY TO PUBLISH|not for publication/i, `${slug}: no placeholders, draft box, comments or revision notes`);
  assert.doesNotMatch(visibleText(html), /\bPR\s*#\d+/i, `${slug}: no PR numbers`);
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  levels.forEach((l, i) => i && assert.ok(l <= levels[i - 1] + 1, `${slug}: heading h${l} skips a level after h${levels[i - 1]}`));
  const tables = html.match(/<table\b/g)?.length ?? 0;
  const boxed = html.match(/<div class="(?:table-scroll|tbl)" role="region" tabindex="0" aria-label="Table: [^"]+"><table>/g)?.length ?? 0;
  assert.equal(boxed, tables, `${slug}: every table sits in a labelled scroll box`);
  if (slug === "privacy") assert.equal(tables, 3, "privacy.html has its three tables");
  assert.match(html, /Last updated: \d{1,2} [A-Z][a-z]+ 2026 · Version 3\.\d/, `${slug}: Version 3.x header line`);
  const box = html.match(/<aside class="changed"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(/What changed in Version 3\.\d/.test(box ?? ""), `${slug}: "What changed" box`);
  assert.ok((box.match(/<li>/g)?.length ?? 0) <= 3, `${slug}: "What changed" box has at most 3 bullets`);
  const rest = visibleText(html.replace(box, "").replace(/<header class="gnav"[\s\S]*?<\/header>|<footer\b[\s\S]*?<\/footer>/g, ""));
  assert.doesNotMatch(rest, /access call|booking|Calendly|Granola|Google Meet|setup call|transcript|call audio|desktop app/i, `${slug}: no call, booking or desktop-app text outside the box`);
  assert.doesNotMatch(rest, /\bMIT\b/, `${slug}: no MIT licence text`);
  assert.doesNotMatch(html, /Beauharnois/, `${slug}: no OVH city`);
  if (slug === "data-privacy") assert.ok(html.includes(`Last updated: ${html.match(/Last updated: (\d{1,2} [A-Z][a-z]+ 2026) · Version/)[1]}.</p>`), "data-privacy: the sub-processor date equals the header date");
}
assert.ok(read("data-privacy.html").includes('href="/dpa"'), "Data Privacy links the DPA at /dpa");
ok(`legal pages: ${Object.keys(LEGAL).length} pages, indexable, WebPage JSON-LD, no placeholders, tables in scroll boxes, Version 3.x`);

// ── one header, one footer, one logo: every page carries the same header and footer (apart from aria-current, which
// marks only the page itself), every site link in them resolves to a built page, and the tab icon is the Orchy mark ──
const norm = (s) => s.replace(/ aria-current="page"/g, "");
const homeHtml = read("index.html");
const HEADER = norm(homeHtml.match(/<header class="gnav"[\s\S]*?<\/header>/)[0]);
const FOOTER = norm(homeHtml.match(/<footer\b[\s\S]*?<\/footer>/)[0]);
const locs = [...sitemap.matchAll(/<loc>https:\/\/imorchy\.dev([^<]*)<\/loc>/g)].map((m) => m[1]);
const built = build(SITE).files;
const homeIds = new Set([...homeHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
for (const page of pages) {
  const html = read(page);
  const headers = html.match(/<header class="gnav"[\s\S]*?<\/header>/g) || [];
  const footers = html.match(/<footer\b[\s\S]*?<\/footer>/g) || [];
  assert.equal(headers.length, 1, `${page}: exactly one site header`);
  assert.equal(footers.length, 1, `${page}: exactly one footer`);
  assert.equal(norm(headers[0]), HEADER, `${page}: the shared header`);
  assert.equal(norm(footers[0]), FOOTER, `${page}: the shared footer`);
  for (const [, current] of (headers[0] + footers[0]).matchAll(/<a [^>]*href="([^"]+)"[^>]*aria-current="page"/g))
    assert.equal(current, pathOf(page), `${page}: aria-current marks this page only`);
  for (const [, link] of (headers[0] + footers[0]).matchAll(/<a [^>]*href="([^"]+)"/g)) {
    if (/^https:\/\//.test(link) || link.startsWith("/go/") || link.startsWith("#")) continue;
    const href = link.split("#")[0] || "/";
    assert.match(href, /^\/[a-z0-9./-]*$/, `${page}: nav link ${link} is a site path`);
    assert.ok(fs.existsSync(SITE + fileFor(href)) && (locs.includes(href) || built.has(fileFor(href))), `${page}: nav link ${link} resolves to a built page`);
  }
  for (const [, id] of html.matchAll(/href="\/#([^"]+)"/g)) assert.ok(homeIds.has(id), `${page}: link /#${id} has no matching id on the home page`);
  const icons = [...html.matchAll(/<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/gi)].map((m) => m[0]);
  assert.deepEqual(icons, ['<link rel="icon" href="/shared/orchy-main-128.webp" type="image/webp">'], `${page}: the one Orchy tab icon`);
  assert.ok(!/favicon\.svg|lilorchy/i.test(html), `${page}: no old robot icon (favicon.svg, lilorchy)`);
}
assert.ok(!fs.existsSync(SITE + "favicon.svg"), "favicon.svg (the old robot) is removed");
for (const link of ['href="/changelog"', 'href="/blog"', 'href="/pricing"', 'href="/privacy"', 'href="/terms"', 'href="/dpa"', 'href="/data-privacy"', 'href="/security"'])
  assert.ok(FOOTER.includes(link), `the footer links ${link}`);
// Orchy's social accounts (Jan, 2026-11-18: Facebook, X, Instagram, YouTube), each in a new tab, safely; the home page's
// Organization sameAs names the same four.
const SOCIAL = ["https://www.facebook.com/OrchyAI/", "https://x.com/OrchyAI", "https://www.instagram.com/orchyai/", "https://www.youtube.com/@orchy-ai"];
const social = [...FOOTER.matchAll(/<a href="(https:\/\/(?:www\.)?(?:facebook|x|instagram|youtube)\.com[^"]*)"([^>]*)>/g)];
assert.deepEqual(social.map((m) => m[1]), SOCIAL, "the footer links Facebook, X, Instagram and YouTube, in that order");
for (const [, url, attrs] of social) assert.match(attrs, /target="_blank" rel="noopener noreferrer"/, `footer opens ${url} in a new tab, safely`);
const org = jsonLd(homeHtml).find((n) => n["@type"] === "Organization");
assert.deepEqual([...(org?.sameAs ?? [])].sort(), [...SOCIAL].sort(), "index.html's Organization sameAs lists the four social accounts");
ok(`one header, one footer, one logo on all ${pages.length} pages; nav links resolve; four social accounts`);

// ── the changelog names no pull requests (Jan, 2026-11-03): no "PR #nn" and no /pull/ links in the page or the feed ──
for (const file of ["changelog.html", "feed.xml"]) {
  const text = read(file);
  assert.doesNotMatch(visibleText(text), /\bPR\s*#\d+/i, `${file}: no PR numbers`);
  assert.doesNotMatch(text, /\bPR\s*#\d+|\/pull\//i, `${file}: no PR numbers or /pull/ links`);
}
ok("changelog.html and feed.xml name no PR numbers and link no /pull/ pages");

// The checker itself catches drift: an answer that isn't on the page fails.
assert.ok(!visibleText("<p>Orchy asks first.</p>").includes("Orchy never asks."));
assert.equal(visibleText("<h3>It&#39;s <b>local</b></h3><script>x</script>"), "It's local");
ok("visibleText drops tags and scripts and decodes entities");
