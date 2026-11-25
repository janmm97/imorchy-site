// Offline checks for the mobile-speed budget: every image is sized and small, icons and preloads stay small,
// the only web font is self-hosted JetBrains Mono (Regular + Bold, swap, preloaded), and no page loads WebGL or a
// render-blocking script. 2026-11 redesign: the kit lives under shared/. Run by test.mjs (part of `npm test`). No network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ok = (name) => console.log(`ok - ${name}`);
const read = (p) => fs.readFileSync(SITE + p, "utf8");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const local = (src) => SITE + src.replace(/^\//, "").split(/[?#]/)[0];

// every page: top level plus one folder down (blog/, compare/, alternatives/)
const SKIP = new Set(["shared", "worker", "node_modules", "content", "assets", ".well-known", ".git"]);
const pages = [];
for (const e of fs.readdirSync(SITE, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(e.name)) pages.push(e.name);
  else if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith("."))
    for (const f of fs.readdirSync(SITE + e.name)) if (f.endsWith(".html")) pages.push(`${e.name}/${f}`);
}
assert.ok(pages.length >= 20, `found ${pages.length} pages`);

// ── no page paints with a heavy image: <img>, icons and preloads stay small and sized ──
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
    // Preloaded fonts are subset to the characters the site uses: 40 KB each.
    const cap = attr(tag, "as") === "font" ? 40 * 1024 : BUDGET;
    assert.ok(fs.statSync(local(href)).size <= cap, `${page}: ${href} is over ${cap / 1024} KB`);
  }
}
ok(`every <img>, icon and preload on ${pages.length} pages is sized and under budget`);

// ── home: the LCP is the hero text; a high-priority hero image (if one comes back) comes with its preload ──
for (const page of ["index.html"]) {
  const html = read(page);
  const hero = html.match(/<img[^>]*fetchpriority="high"[^>]*>/i)?.[0];
  const preload = html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/i)?.[0];
  assert.equal(!!hero, !!preload, `${page}: a high-priority hero image and its preload come together`);
  if (hero) {
    assert.equal(attr(preload, "href"), attr(hero, "src"), page);
    assert.ok(html.indexOf(preload) < html.indexOf('rel="stylesheet"'), `${page}: the preload comes before the stylesheet`);
  }
}

// ── one typeface (Jan, 2026-11-24): JetBrains Mono, self-hosted Regular + Bold only, swap, preloaded on every page ──
{
  const css = read("shared/site.css");
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.equal(faces.length, 2, "two @font-face rules");
  for (const face of faces) assert.match(face, /font-display:\s*swap/, `swap: ${face.slice(0, 80)}`);
  const urls = [...css.matchAll(/url\("?([^")]+\.woff2)"?\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, ["/shared/fonts/JetBrainsMono-Bold.woff2", "/shared/fonts/JetBrainsMono-Regular.woff2"], "only the two JetBrains Mono files are downloaded");
  assert.doesNotMatch(read("shared/blog.css"), /@font-face|url\([^)]*\.woff/, "blog.css downloads no other font");
  for (const f of fs.readdirSync(SITE + "shared/fonts")) assert.match(f, /^(JetBrainsMono-(Regular|Bold)\.woff2|OFL-JetBrainsMono\.txt)$/, `unexpected font file ${f}`);
  for (const w of ["Regular", "Bold"]) assert.ok(fs.statSync(SITE + `shared/fonts/JetBrainsMono-${w}.woff2`).size < 32 * 1024, `JetBrainsMono-${w} under 32 KB`);
  for (const page of pages) for (const w of ["Regular", "Bold"])
    assert.match(read(page), new RegExp(`<link rel="preload" href="/shared/fonts/JetBrainsMono-${w}\\.woff2" as="font" type="font/woff2" crossorigin\\s*/?>`), `${page} preloads JetBrains Mono ${w}`);
}
ok("every font is JetBrains Mono from /shared/fonts, under 32 KB, font-display: swap, and preloaded on every page");

// ── no WebGL, no import map, no render-blocking script on any page ──
for (const page of pages) {
  const html = read(page);
  for (const s of ["importmap", "three.module", "cdn.jsdelivr.net", "<canvas"]) assert.ok(!html.includes(s), `${page} loads no ${s}`);
  for (const tag of html.match(/<script[^>]*src="[^"]*"[^>]*>/gi) || [])
    assert.ok(/type="module"|defer|async/.test(tag), `${page}: ${tag} doesn't block rendering`);
}
ok("no page loads Three.js, an import map or a canvas, and every script is deferred or a module");
