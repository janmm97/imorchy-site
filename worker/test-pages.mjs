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

// The checker itself catches drift: an answer that isn't on the page fails.
assert.ok(!visibleText("<p>Orchy asks first.</p>").includes("Orchy never asks."));
assert.equal(visibleText("<h3>It&#39;s <b>local</b></h3><script>x</script>"), "It's local");
ok("visibleText drops tags and scripts and decodes entities");
