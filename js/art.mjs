// Cuts the characters out of the supplied SVG art. Each SVG holds two PNGs:
// a luminance mask, then the colour render. We apply the mask as alpha,
// find each character's body, crop it (dropping the baked floor reflection),
// and trace its silhouette so the 3D stage can extrude it into a solid toy.

const SHEET = "assets/orchy_and_sugagents.svg";
const MAIN = "assets/orchy-main.svg";
// Sheet order, left to right, top row then bottom row.
const SHEET_IDS = ["orchy", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function layers(url) {
  const text = await (await fetch(url)).text();
  const uris = [...text.matchAll(/href="(data:image\/png;base64,[^"]+)"/g)].map((m) => m[1]);
  if (uris.length < 2) throw new Error(`No masked render in ${url}`);
  const [mask, color] = await Promise.all(uris.slice(0, 2).map(loadImage));
  const w = color.naturalWidth, h = color.naturalHeight;
  const read = (img) => {
    const c = canvasOf(w, h), g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  };
  const rgba = read(color), m = read(mask);
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = m.data[i * 4];
  return { w, h, rgba, alpha };
}

// Connected regions of solid mask; the floor reflections are fainter and fall out.
function bodies(alpha, w, h, threshold = 236) {
  const label = new Int32Array(w * h).fill(-1);
  const found = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || alpha[start] < threshold) continue;
    const box = { minX: w, minY: h, maxX: 0, maxY: 0, area: 0, id: found.length };
    stack.push(start);
    label[start] = box.id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      box.area++;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || label[q] !== -1 || alpha[q] < threshold) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        label[q] = box.id;
        stack.push(q);
      }
    }
    found.push(box);
  }
  return found;
}

// Crop one body into its own canvas. Pixels outside the mask take the body
// colour, so the extruded front face never shows a dark fringe.
function cutOut(src, box, pad) {
  const x0 = Math.max(0, box.minX - pad), y0 = Math.max(0, box.minY - pad);
  const x1 = Math.min(src.w - 1, box.maxX + pad), y1 = Math.min(src.h - 1, box.maxY + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * src.w + x;
      if (src.alpha[i] < 230) continue;
      const R = src.rgba.data[i * 4], G = src.rgba.data[i * 4 + 1], B = src.rgba.data[i * 4 + 2];
      if (R + G + B < 120) continue; // skip the black faces
      r += R; g += G; b += B; n++;
    }
  }
  const body = n ? [r / n, g / n, b / n] : [200, 200, 200];
  const c = canvasOf(w, h), ctx = c.getContext("2d");
  const out = ctx.createImageData(w, h);
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * src.w + (x0 + x), o = (y * w + x) * 4;
      const k = src.alpha[i] / 255;
      a[y * w + x] = src.alpha[i];
      for (let ch = 0; ch < 3; ch++) out.data[o + ch] = src.rgba.data[i * 4 + ch] * k + body[ch] * (1 - k);
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return { canvas: c, w, h, alpha: a, body };
}

// Trace the silhouette on a coarse grid, filled side on the left, y up.
function trace(alpha, w, h, cell) {
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const filled = new Set();
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0, n = 0;
      for (let y = cy * cell; y < Math.min(h, (cy + 1) * cell); y++)
        for (let x = cx * cell; x < Math.min(w, (cx + 1) * cell); x++) { sum += alpha[y * w + x]; n++; }
      if (sum / n > 128) filled.add(cx + "," + cy);
    }
  }
  const has = (x, y) => filled.has(x + "," + y);
  const out = new Map();
  const add = (ax, ay, bx, by) => {
    const k = ax + "," + ay;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ a: [ax, ay], b: [bx, by], used: false });
  };
  for (const k of filled) {
    const [x, y] = k.split(",").map(Number);
    const top = -y, bot = -y - 1;
    if (!has(x, y + 1)) add(x, bot, x + 1, bot);
    if (!has(x + 1, y)) add(x + 1, bot, x + 1, top);
    if (!has(x, y - 1)) add(x + 1, top, x, top);
    if (!has(x - 1, y)) add(x, top, x, bot);
  }
  const turn = (dx, dy, e) => dx * (e.b[1] - e.a[1]) - dy * (e.b[0] - e.a[0]);
  const loops = [];
  for (const list of out.values()) {
    for (const start of list) {
      if (start.used) continue;
      start.used = true;
      const pts = [start.a];
      let cur = start;
      for (let guard = 0; guard < 100000; guard++) {
        const [ex, ey] = cur.b;
        if (ex === start.a[0] && ey === start.a[1]) break;
        pts.push(cur.b);
        const dx = cur.b[0] - cur.a[0], dy = cur.b[1] - cur.a[1];
        const next = (out.get(ex + "," + ey) || []).filter((e) => !e.used).sort((p, q) => turn(dx, dy, q) - turn(dx, dy, p))[0];
        if (!next) break;
        next.used = true;
        cur = next;
      }
      // Drop collinear points, then convert grid units to art pixels (y up).
      const n = pts.length;
      const simple = pts.filter((p, i) => {
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      const loop = simple.map(([x, y]) => [Math.min(w, x * cell), Math.max(0, h + y * cell)]);
      let area = 0;
      for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % loop.length];
        area += x1 * y2 - x2 * y1;
      }
      if (area > 0 && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

function character(id, src, box, { pad, cell, depth }) {
  const cut = cutOut(src, box, pad);
  return { id, ...cut, loops: trace(cut.alpha, cut.w, cut.h, cell), depth };
}

// Everything the stage needs, keyed by character id.
export async function loadSquadArt() {
  const [sheet, main] = await Promise.all([layers(SHEET), layers(MAIN)]);
  const found = bodies(sheet.alpha, sheet.w, sheet.h).filter((b) => b.area > sheet.w * sheet.h * 0.004);
  const cellW = sheet.w / 5, cellH = sheet.h / 2;
  const art = {};
  SHEET_IDS.forEach((id, i) => {
    const col = i % 5, row = Math.floor(i / 5);
    const inCell = found.filter((b) => {
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      return cx >= col * cellW && cx < (col + 1) * cellW && cy >= row * cellH && cy < (row + 1) * cellH;
    });
    const box = inCell.sort((a, b) => b.area - a.area)[0];
    if (box) art[id] = character(id, sheet, box, { pad: 3, cell: 2, depth: 0.17 });
  });
  // Orchy comes from his own front-on render: sharper, and squarely facing you.
  const mainBody = bodies(main.alpha, main.w, main.h).sort((a, b) => b.area - a.area)[0];
  if (mainBody) art.orchy = character("orchy", main, mainBody, { pad: 4, cell: 4, depth: 0.24 });
  return art;
}
