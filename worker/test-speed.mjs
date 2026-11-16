// Offline checks for the mobile-speed budget: first paint never waits on the big SVG art, every image has a size,
// the hero poster is preloaded, the 3D squad boots late and only on desktop, and the character SVGs keep the
// mask-then-colour PNG pair that js/art.mjs reads. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ok = (name) => console.log(`ok - ${name}`);
const read = (p) => fs.readFileSync(SITE + p, "utf8");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const local = (src) => SITE + src.replace(/^\//, "");

// ── no page paints with a heavy image: <img>, icons and image preloads stay small and sized ──
const pages = fs.readdirSync(SITE).filter((f) => f.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(f));
const BUDGET = 64 * 1024;
for (const page of pages) {
  const html = read(page);
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, "src");
    assert.ok(attr(tag, "width") && attr(tag, "height"), `${page}: <img src="${src}"> has width and height`);
    for (const url of [src, ...(attr(tag, "srcset") || "").split(",").map((s) => s.trim().split(/\s+/)[0])].filter(Boolean))
      assert.ok(fs.statSync(local(url)).size <= BUDGET, `${page}: ${url} is over ${BUDGET / 1024} KB`);
  }
  for (const tag of html.match(/<link\b[^>]*rel="(?:icon|preload)"[^>]*>/gi) || []) {
    const href = attr(tag, "href");
    // Preloaded fonts are subset to the characters the site uses (Latin-1, punctuation, arrows): 40 KB each.
    const cap = attr(tag, "as") === "font" ? 40 * 1024 : BUDGET;
    assert.ok(fs.statSync(local(href)).size <= cap, `${page}: ${href} is over ${cap / 1024} KB`);
  }
}
ok(`every <img>, icon and image preload on ${pages.length} pages is sized and under ${BUDGET / 1024} KB`);

// ── the hero video's poster (the LCP element) is the only image preload, high priority, ahead of the CSS ──
const home = read("index.html");
const heroVideo = home.match(/<section class="hero[\s\S]*?(<video\b[^>]*>)/)?.[1];
const preloads = home.match(/<link\b[^>]*rel="preload"[^>]*as="image"[^>]*>/gi) || [];
assert.ok(heroVideo && preloads.length === 1, "index.html has a hero video and one image preload");
assert.equal(attr(preloads[0], "href"), attr(heroVideo, "poster"));
assert.equal(attr(preloads[0], "fetchpriority"), "high");
assert.ok(home.indexOf(preloads[0]) < home.indexOf('rel="stylesheet"'), "the preload comes before the stylesheet");
const css = read("styles.css");
assert.equal((css.match(/@font-face/g) || []).length, (css.match(/font-display:\s*swap/g) || []).length);
ok("the hero poster is preloaded ahead of the CSS, and every font uses font-display: swap");

// ── the squad: after load + idle, never on small screens, Save-Data or reduced motion ──
const main = read("js/main.mjs");
assert.ok(!/^bootSquad\(\);?$/m.test(main), "main.mjs does not boot the squad straight away");
assert.ok(/addEventListener\("load"/.test(main) && /requestIdleCallback/.test(main) && /setTimeout\(task/.test(main));
assert.ok(main.includes("(max-width: 768px)") && main.includes("saveData") && /reduced:\s*reducedMotion\(\)/.test(main));
assert.ok(/else root\.classList\.add\("no-stage"\)/.test(main), "skipped devices keep the static art");
const sheet = read("js/robots.mjs").match(/img\.src = "([^"]+)"/)?.[1];
assert.ok(sheet && fs.statSync(local(sheet)).size <= BUDGET, "the demo sprites use a small sheet, not the 1 MB SVG");
ok("the 3D squad waits for load + idle, and phones, Save-Data and reduced motion keep the static art");

// ── js/art.mjs reads the first two embedded PNGs of each SVG: the mask (greyscale), then the colour render ──
for (const svg of ["assets/orchy-main.svg", "assets/orchy_and_sugagents.svg"]) {
  const pngs = [...read(svg).matchAll(/href="data:image\/png;base64,([^"]+)"/g)].map((m) => Buffer.from(m[1], "base64"));
  assert.ok(pngs.length >= 2, `${svg}: two embedded PNGs`);
  const [mask, color] = pngs.map((b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: b[25] }));
  assert.equal(mask.type, 0, `${svg}: first PNG is the greyscale mask`);
  assert.equal(color.type, 2, `${svg}: second PNG is the RGB colour render`);
  assert.deepEqual([mask.w, mask.h], [color.w, color.h], `${svg}: mask and colour are the same size`);
}
ok("both character SVGs keep the mask-then-colour PNG pair that art.mjs cuts the squad from");
