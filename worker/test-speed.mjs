// Offline checks for the mobile-speed budget: first paint never waits on the big SVG art, every image has a size,
// the hero art is preloaded, the 3D squad boots late and only on desktop, and the character SVGs keep the
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

// ── v4 home: the LCP is the hero's text, so no hero image to preload; if one comes back, it must be preloaded ──
const home = read("index.html");
const hero = home.match(/<img[^>]*fetchpriority="high"[^>]*>/i)?.[0];
const preload = home.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/i)?.[0];
assert.equal(!!hero, !!preload, "a high-priority hero image and its preload come together");
if (hero) {
  assert.equal(attr(preload, "href"), attr(hero, "src"));
  assert.equal(attr(preload, "imagesrcset"), attr(hero, "srcset"));
  assert.equal(attr(preload, "imagesizes"), attr(hero, "sizes"));
  assert.ok(home.indexOf(preload) < home.indexOf('rel="stylesheet"'), "the preload comes before the stylesheet");
}
const css = read("styles.css");
assert.equal((css.match(/@font-face/g) || []).length, (css.match(/font-display:\s*swap/g) || []).length);
// v4 kit: every downloaded face (url(...)) swaps; local() size-adjusted fallbacks download nothing, so they need no swap.
for (const f of ["css/tokens.css", "css/components.css", "css/home.css", "css/blog.css", "css/demos-home.css"]) {
  for (const face of read(f).match(/@font-face\s*\{[^}]*\}/g) || []) {
    if (/url\(/.test(face)) assert.match(face, /font-display:\s*swap/, `${f}: ${face.slice(0, 80)}`);
  }
}
assert.match(read("css/tokens.css"), /@font-face\{font-family:"Instrument Serif"[^}]*url\(/, "the display serif is self-hosted");
ok("hero image (if any) preloaded ahead of the CSS; every font uses font-display: swap");

// ── v4 home: no WebGL, no hero bundle, and no script that blocks rendering ──
for (const s of ["importmap", "three.module", "cdn.jsdelivr.net", "js/main.mjs", "<canvas"]) assert.ok(!home.includes(s), `index.html loads no ${s}`);
for (const tag of home.match(/<script[^>]*src="[^"]*"[^>]*>/gi) || [])
  assert.ok(/type="module"|defer|async/.test(tag), `index.html: ${tag} doesn't block rendering`);
ok("the homepage loads no Three.js, importmap or hero bundle, and every script is deferred or a module");

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
