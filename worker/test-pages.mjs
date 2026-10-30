// Offline checks for the landing pages' search markup: every FAQPage question and answer in a page's JSON-LD
// appears word for word in that page's visible text, no offers are claimed, and no page links to GitHub or
// makes an open-licence claim. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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
  return squash(decode(body.replace(/<[^>]+>/g, " ")));
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
  assert.ok(!/open[\s-]source/i.test(html),`${page}: no open-licence claim`);
}
assert.ok(jsonLd(fs.readFileSync(SITE + "index.html", "utf8")).some((n) => n["@type"] === "FAQPage"), "index.html has a FAQPage");
ok(`FAQPage JSON-LD matches the visible FAQ (${checked} Q&As on ${pages.length} page(s))`);
ok("no offers in structured data, no GitHub links and no open-licence claim on any page");

// ── the answer pages: plain HTML with no scripts but JSON-LD, one H1, a unique title, a self-canonical at the
// extensionless path Cloudflare serves, the shared og image, links home and to the form, in the sitemap, linked from home ──
const ANSWER = ["approvals", "client-workspaces", "claude-code-orchestrator", "local"];
const home = fs.readFileSync(SITE + "index.html", "utf8");
const sitemap = fs.readFileSync(SITE + "sitemap.xml", "utf8");
const head = (html, re) => html.match(re)?.[1];
const titles = new Set([head(home, /<title>([^<]+)<\/title>/)]);
const descriptions = new Set([head(home, /name="description"\s+content="([^"]+)"/)]);
for (const slug of ANSWER) {
  assert.ok(pages.includes(`${slug}.html`), `${slug}.html exists`);
  const html = fs.readFileSync(SITE + `${slug}.html`, "utf8");
  const url = `https://imorchy.dev/${slug}`;
  assert.equal(html.match(/<h1\b/gi)?.length, 1, `${slug}: exactly one H1`);
  assert.ok(html.includes(`<link rel="canonical" href="${url}" />`), `${slug}: self-canonical`);
  assert.ok(html.includes(`<meta property="og:url" content="${url}" />`), `${slug}: og:url`);
  assert.ok(html.includes('<meta property="og:image" content="https://imorchy.dev/assets/og-image.png" />'), `${slug}: og:image`);
  assert.ok(jsonLd(html).some((n) => n["@type"] === "FAQPage"), `${slug}: FAQPage JSON-LD`);
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  assert.ok(scripts.every((s) => s === '<script type="application/ld+json">'), `${slug}: no scripts but JSON-LD`);
  assert.ok(!/<canvas|importmap|three\.module/i.test(html), `${slug}: no canvas or Three.js`);
  const title = head(html, /<title>([^<]+)<\/title>/);
  const description = head(html, /name="description" content="([^"]+)"/);
  assert.ok(title && !titles.has(title), `${slug}: unique title`);
  assert.ok(description && !descriptions.has(description), `${slug}: unique meta description`);
  titles.add(title);
  descriptions.add(description);
  assert.ok(html.includes('href="/"'), `${slug}: links home`);
  assert.ok(html.includes('href="https://flaxen-crayon-74f.notion.site/'), `${slug}: links to the early-access form`);
  assert.ok(sitemap.includes(`<loc>${url}</loc>`), `${slug}: in sitemap.xml`);
  assert.ok((home.match(new RegExp(`href="/${slug}"`, "g")) || []).length >= 1, `${slug}: linked from the home nav`);
}
const approvals = visibleText(fs.readFileSync(SITE + "approvals.html", "utf8"));
assert.equal(approvals.match(/human-in-the-loop/g)?.length, 1, "/approvals says human-in-the-loop once");
assert.equal(
  head(fs.readFileSync(SITE + "claude-code-orchestrator.html", "utf8"), /<title>([^<]+)<\/title>/),
  "Claude Code orchestrator for Codex and Cursor | Orchy AI",
);
assert.ok(pages.length >= 5, "home plus the four answer pages are checked");
ok("answer pages: one H1, unique title and description, self-canonical, og image, FAQPage, no scripts, in the sitemap, linked from home");

// The checker itself catches drift: an answer that isn't on the page fails.
assert.ok(!visibleText("<p>Orchy asks first.</p>").includes("Orchy never asks."));
assert.equal(visibleText("<h3>It&#39;s <b>local</b></h3><script>x</script>"), "It's local");
ok("visibleText drops tags and scripts and decodes entities");
