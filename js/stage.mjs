import * as THREE from "three";

// One transparent WebGL layer over the whole page. Its world is measured in
// CSS pixels: a character standing at depth 0 is exactly as big on screen as
// its size says, so characters can stand on the page's own cards and ride
// along as you scroll. Each character is the supplied art on the front of a
// solid, bevelled extrusion of its own silhouette.

const FOV = 30;
const GRAVITY = 2600; // px/s²
// Held and thrown characters move in a plane in front of everyone else.
const FRONT = 260;
// Each character travels in its own depth lane, so two hopping across each
// other pass in front of and behind one another instead of through.
const LANES = { orchy: -99, red: -77, orange: -55, yellow: -33, green: -11, cyan: 11, blue: 33, purple: 55, pink: 77, gray: 99 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,.42)");
  grd.addColorStop(0.65, "rgba(255,255,255,.1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildModel(ch, renderer) {
  const W = ch.w, H = ch.h;
  const shapes = ch.loops.map((l) => new THREE.Shape(l.map(([x, y]) => new THREE.Vector2(x, y))));
  // The front cap shows the art at its own pixel coordinates.
  const UVGenerator = {
    generateTopUV: (g, v, a, b, c) => [a, b, c].map((i) => new THREE.Vector2(v[i * 3] / W, v[i * 3 + 1] / H)),
    generateSideWallUV: () => [0, 0, 0, 0].map(() => new THREE.Vector2()),
  };
  const depth = ch.depth * W;
  const bevel = Math.max(2, W * 0.014);
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth, steps: 1, curveSegments: 1, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, UVGenerator,
  });
  // ExtrudeGeometry puts both lids in group 0, back lid first: give the back its own material.
  const groups = geo.groups.map((g) => ({ ...g }));
  geo.clearGroups();
  for (const g of groups) {
    if (g.materialIndex !== 0) { geo.addGroup(g.start, g.count, g.materialIndex); continue; }
    const half = Math.floor(g.count / 6) * 3;
    geo.addGroup(g.start, half, 2);
    geo.addGroup(g.start + half, g.count - half, 0);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of ch.loops) for (const [x, y] of l) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Feet on the origin, centred, so every rotation and squash pivots at the feet.
  geo.translate(-(minX + maxX) / 2, -minY, -depth / 2);
  const tex = new THREE.CanvasTexture(ch.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const body = new THREE.Color().setRGB(ch.body[0] / 255, ch.body[1] / 255, ch.body[2] / 255, THREE.SRGBColorSpace);
  const side = new THREE.MeshStandardMaterial({ color: body.clone().multiplyScalar(0.82), roughness: 0.5, metalness: 0, emissive: body, emissiveIntensity: 0.06 });
  const back = new THREE.MeshStandardMaterial({ color: body.clone().multiplyScalar(0.6), roughness: 0.6 });
  const front = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, [front, side, back]);
  return { mesh, side, height: maxY - minY, aspect: (maxX - minX) / (maxY - minY), depthRatio: depth / (maxY - minY), body };
}

class Actor {
  constructor(stage, id, ch, info) {
    this.stage = stage;
    this.id = id;
    this.info = info;
    this.model = buildModel(ch, stage.renderer);
    this.root = new THREE.Group();
    this.lift = new THREE.Group();
    this.turn = new THREE.Group();
    this.squashG = new THREE.Group();
    this.holder = new THREE.Group();
    this.root.add(this.lift);
    this.lift.add(this.turn);
    this.turn.add(this.squashG);
    this.squashG.add(this.holder);
    this.holder.add(this.model.mesh);
    this.model.mesh.userData.actor = this;
    const glow = `#${this.model.body.getHexString()}`;
    const sprite = () => new THREE.Sprite(new THREE.SpriteMaterial({ map: stage.glowTex, color: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.halo = sprite();
    this.lift.add(this.halo);
    this.pool = sprite();
    this.root.add(this.pool);
    stage.scene.add(this.root);

    // Feet position in screen pixels; depth in px toward the viewer.
    this.sx = innerWidth / 2;
    this.sy = -400;
    this.z = 0;
    this.dz = 0; // extra depth to slip past a body in the way (see dodge())
    this.rideOn = null;
    this.size = 90;
    this.vx = 0;
    this.vy = 0;
    this.mode = "rest";
    this.home = null;
    this.anchor = null;
    this.leg = null;
    this.hop = null;
    this.hopY = 0;
    this.script = null;
    this.yaw = 0;
    this.yawBias = 0;
    this.pitch = 0;
    this.roll = 0;
    this.lean = 0;
    this.spin = 0;
    this.spinT = null;
    this.sq = 1;
    this.sqv = 0;
    this.glow = 0.25;
    this.glowTarget = 0.25;
    this.pulse = false;
    this.lookAt = null;
    this.phase = Math.random() * 100;
    this.nextIdle = 2 + Math.random() * 5;
    this.peekT = 3 + Math.random() * 9;
    this.peeking = false;
    this.peekAmt = 0;
    this.visible = false;
  }

  get width() { return this.size * this.model.aspect; }
  get thick() { return this.size * this.model.depthRatio + 4; }

  land(strength = 1) {
    this.sq = 1 - 0.22 * strength;
    this.sqv = 0;
  }

  hopNow({ height = 0.35, dur = 0.42, spin = 0 } = {}) {
    if (this.stage.reduced || this.mode === "script" || this.mode === "drag" || this.mode === "fly") return;
    this.hop = { t: 0, dur, h: height * this.size, anticip: 0.08 };
    if (spin) this.spinT = { t: 0, dur: dur + 0.12, turns: spin };
  }

  travelTo(anchor) {
    this.anchor = anchor;
    if (this.mode === "drag" || this.mode === "fly" || this.mode === "script") return;
    this.mode = "travel";
    this.leg = null;
  }
}

export async function createStage({ canvas, overlay, art, squad }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1c24, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-0.5, 0.9, 1);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb8f9d4, 0.6);
  rim.position.set(1, 0.3, -0.6);
  scene.add(rim);

  const stage = {
    renderer, scene, camera, glowTex: glowTexture(),
    reduced: false, W: innerWidth, H: innerHeight, D: 1000,
    actors: {}, listeners: {},
    pointer: { x: innerWidth / 2, y: innerHeight / 3, vx: 0, vy: 0, t: 0 },
    scrollV: 0,
  };
  const info = Object.fromEntries(squad.map((s) => [s.id, s]));
  for (const id of Object.keys(art)) stage.actors[id] = new Actor(stage, id, art[id], info[id] || { name: id });
  const actors = Object.values(stage.actors);
  const meshes = actors.map((a) => a.model.mesh);

  const emit = (name, detail) => (stage.listeners[name] || []).forEach((fn) => fn(detail));
  stage.on = (name, fn) => (stage.listeners[name] ||= []).push(fn);

  function resize() {
    stage.W = innerWidth;
    stage.H = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(stage.W, stage.H, false);
    camera.aspect = stage.W / stage.H;
    stage.D = stage.H / 2 / Math.tan((FOV / 2) * (Math.PI / 180));
    camera.position.set(0, 0, stage.D);
    camera.near = 10;
    camera.far = stage.D * 4;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize);

  // ---- Anchors: where a character's feet belong right now -------------------

  const rectCache = new Map();
  const rectOf = (el) => {
    if (!el) return null;
    if (!rectCache.has(el)) {
      const r = el.getBoundingClientRect();
      rectCache.set(el, r.width || r.height ? r : null);
    }
    return rectCache.get(el);
  };
  stage.rectOf = rectOf;
  stage.resolve = (anchor, actor) => {
    if (!anchor) return null;
    if (anchor.fn) return anchor.fn(actor);
    if (anchor.park) {
      const size = anchor.size || 80;
      const w = size * actor.model.aspect;
      const left = anchor.park === "left";
      const hidden = anchor.hide ? w * 1.4 : w * 0.62;
      const out = left ? -hidden : stage.W + hidden;
      const peek = left ? w * 0.16 : stage.W - w * 0.16;
      return { sx: out + (peek - out) * actor.peekAmt, sy: stage.H * anchor.fy, z: 0, size, park: true };
    }
    if (anchor.screen) return { sx: anchor.screen[0], sy: anchor.screen[1], z: anchor.z || 0, size: anchor.size || actor.size };
    if (anchor.follow) {
      const o = stage.actors[anchor.follow];
      return { sx: o.sx, sy: o.sy - o.size * (anchor.at ?? 0.74) * o.sq - o.hopY, z: o.z + 6, size: anchor.size || actor.size };
    }
    const el = typeof anchor.el === "string" ? document.querySelector(anchor.el) : anchor.el;
    const r = rectOf(el);
    if (!r) return null;
    return {
      sx: r.left + r.width * (anchor.fx ?? 0.5) + (anchor.dx || 0),
      sy: r.top + (anchor.fy ? r.height * anchor.fy : Number(el.dataset.inkTop || 0)) + (anchor.dy || 0),
      z: anchor.z || 0,
      size: anchor.size || actor.size,
    };
  };
  stage.screenOf = (id) => {
    const a = stage.actors[id];
    return { sx: a.sx, sy: a.sy, z: a.z, size: a.size, width: a.width, sq: a.sq };
  };

  // ---- Actions ---------------------------------------------------------------

  function snap(a) {
    const p = stage.resolve(a.anchor, a);
    if (!p) return;
    a.sx = p.sx; a.sy = p.sy; a.z = p.z; a.size = p.size;
  }
  stage.setHome = (id, anchor, { travel = true } = {}) => {
    const a = stage.actors[id];
    if (!a) return;
    a.home = anchor;
    if (a.mode === "perched" || a.mode === "script") { if (a.mode === "script") a.anchor = anchor; return; }
    if (travel) a.travelTo(anchor);
    else { a.anchor = anchor; a.mode = "rest"; snap(a); }
  };
  stage.place = (id, anchor) => {
    const a = stage.actors[id];
    if (!a) return;
    a.home = a.anchor = anchor;
    a.mode = "rest";
    a.script = null;
    a.leg = a.hop = null;
    a.hopY = 0;
    snap(a);
  };
  stage.hop = (id, opts) => stage.actors[id]?.hopNow(opts);
  stage.setGlow = (id, v) => { const a = stage.actors[id]; if (a) a.glowTarget = v; };
  stage.setPulse = (id, on) => { const a = stage.actors[id]; if (a) a.pulse = on; };
  stage.lookAt = (id, otherId) => { const a = stage.actors[id]; if (a) a.lookAt = otherId ? stage.actors[otherId] : null; };
  stage.slump = (id) => { const a = stage.actors[id]; if (a) { a.sq = 0.78; a.sqv = 0; a.glowTarget = 0.1; } };
  stage.runScript = (id, fn) => new Promise((resolve) => {
    const a = stage.actors[id];
    a.mode = "script";
    a.leg = a.hop = null;
    a.script = { fn, t: 0, resolve };
  });
  stage.stopScript = (id) => {
    const a = stage.actors[id];
    // Hop on to wherever it belongs now (travel settles to rest when already there).
    if (a?.script) { const r = a.script.resolve; a.script = null; a.mode = "travel"; a.leg = null; a.hopY = 0; a.spin = 0; r(); }
  };
  stage.setReduced = (v) => { stage.reduced = v; };

  const callouts = [];
  stage.say = (id, text, ms = 2400, tone = "") => {
    const a = stage.actors[id];
    if (!a || !overlay) return;
    for (const c of callouts) if (c.a === a) c.until = 0;
    const el = document.createElement("div");
    el.className = "bot-callout" + (tone ? ` bot-callout--${tone}` : "");
    el.style.setProperty("--c", a.info.color || "#fff");
    const name = document.createElement("b");
    name.textContent = (a.info.name || id) + ":";
    el.append(name, document.createTextNode(" " + text));
    overlay.append(el);
    callouts.push({ el, a, until: performance.now() + ms });
    requestAnimationFrame(() => el.classList.add("is-in"));
  };

  // ---- Input: hover, click, drag and throw -----------------------------------

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hit(x, y) {
    ndc.set((x / stage.W) * 2 - 1, -(y / stage.H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const visible = meshes.filter((m) => m.userData.actor.visible);
    const h = raycaster.intersectObjects(visible, false)[0];
    return h ? h.object.userData.actor : null;
  }
  stage.hit = hit;
  let drag = null, hovered = null, suppressClick = 0;
  const overControl = (t) => t instanceof Element && t.closest(".nav, dialog, input, textarea, select, [contenteditable]");
  function onDown(e) {
    if (e.button > 0 || overControl(e.target)) return;
    const a = hit(e.clientX, e.clientY);
    if (!a || a.mode === "script") return;
    e.preventDefault();
    e.stopPropagation();
    drag = { a, ox: a.sx - e.clientX, oy: a.sy - e.clientY, x0: e.clientX, y0: e.clientY, moved: 0 };
    stage.pointer.x = e.clientX;
    stage.pointer.y = e.clientY;
    stage.pointer.vx = stage.pointer.vy = 0;
    document.body.classList.add("is-grabbing");
  }
  function onMove(e) {
    const p = stage.pointer, now = performance.now();
    const dt = Math.max(1, now - p.t) / 1000;
    if (p.t && dt < 0.2) {
      p.vx = p.vx * 0.55 + ((e.clientX - p.x) / dt) * 0.45;
      p.vy = p.vy * 0.55 + ((e.clientY - p.y) / dt) * 0.45;
    }
    p.x = e.clientX; p.y = e.clientY; p.t = now;
    if (drag) {
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
      if (drag.moved > 6 && drag.a.mode !== "drag") {
        const a = drag.a;
        a.mode = "drag";
        a.hop = a.leg = null;
        a.vx = a.vy = 0;
        stage.say(a.id, "Whee!", 900);
      }
      if (e.cancelable) e.preventDefault();
    } else if (e.pointerType === "mouse") {
      const a = hit(e.clientX, e.clientY);
      if (a !== hovered) {
        hovered = a;
        document.body.classList.toggle("on-bot", !!a);
      }
    }
  }
  function onUp() {
    if (!drag) return;
    const a = drag.a;
    document.body.classList.remove("is-grabbing");
    suppressClick = performance.now() + 450;
    if (a.mode !== "drag") {
      a.hopNow({ height: 0.45, dur: 0.46, spin: 1 });
      a.glow = 1;
      emit("pick", a.id);
    } else {
      a.mode = "fly";
      a.vx = clamp(stage.pointer.vx, -3200, 3200);
      a.vy = clamp(stage.pointer.vy, -3200, 2400);
      emit("throw", a.id);
    }
    drag = null;
  }
  addEventListener("pointerdown", onDown, { capture: true, passive: false });
  addEventListener("pointermove", onMove, { passive: false });
  addEventListener("pointerup", onUp, { capture: true });
  addEventListener("pointercancel", onUp, { capture: true });
  // A grabbed character must not also scroll the page or press what's under it.
  addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t && !overControl(e.target) && hit(t.clientX, t.clientY)) e.preventDefault();
  }, { capture: true, passive: false });
  addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { capture: true, passive: false });
  addEventListener("click", (e) => {
    if (performance.now() < suppressClick) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  let lastScroll = scrollY, lastScrollT = performance.now();
  addEventListener("scroll", () => {
    const now = performance.now();
    const v = (scrollY - lastScroll) / Math.max(0.008, (now - lastScrollT) / 1000);
    stage.scrollV = stage.scrollV * 0.5 + v * 0.5;
    lastScroll = scrollY;
    lastScrollT = now;
  }, { passive: true });

  // ---- Movement ------------------------------------------------------------------

  function perchRects() {
    const list = [];
    for (const el of document.querySelectorAll("[data-perch]")) {
      const r = rectOf(el);
      // A perch may stand lower than its box: letters stand on their ink, not their line box.
      if (r && r.bottom > 0 && r.top < stage.H) list.push({ el, r, top: r.top + Number(el.dataset.inkTop || 0) });
    }
    return list;
  }

  // Travel is a string of hops. Long trips break into several so nothing slides
  // more than about a third of the screen in one move.
  function updateTravel(a, p, dt) {
    if (!p) return;
    // To a parking spot: hop straight out sideways at the current height (it snaps
    // into its slot once off screen), never sliding along the edge past others.
    if (p.park && a.visible) p = { ...p, sy: clamp(a.sy, a.size, stage.H) };
    const dist = Math.hypot(p.sx - a.sx, p.sy - a.sy);
    const off = (y, s) => y < -s * 1.5 || y - s > stage.H + s * 0.5;
    // Parking spots sit off the screen edge: an off-screen character just goes there.
    const parkJump = p.park && !a.leg && !a.visible;
    if (stage.reduced || dist < 3 || parkJump || (!a.leg && off(a.sy, a.size) && off(p.sy, p.size))) {
      a.sx = p.sx; a.sy = p.sy; a.z = p.z; a.size = p.size;
      a.mode = "rest";
      a.leg = null;
      return;
    }
    if (!a.leg && dist > stage.H * 1.1 && !p.park) {
      // From far away, drop in from the nearest edge instead of crossing the page.
      a.sx = clamp(p.sx + (Math.random() - 0.5) * 120, 40, stage.W - 40);
      a.sy = a.sy < p.sy ? -10 : stage.H + p.size * 1.3;
      a.size = p.size;
      // Arrive at its final depth: hero spots are already apart in depth, and
      // card spots are apart across the card.
      a.z = p.z;
    }
    if (!a.leg) {
      const d = Math.hypot(p.sx - a.sx, p.sy - a.sy);
      const reach = Math.max(200, Math.min(stage.W, stage.H) * 0.36);
      const step = Math.min(d, reach);
      const k = Math.min(1, reach / d);
      const tx = a.sx + (p.sx - a.sx) * k, ty = a.sy + (p.sy - a.sy) * k;
      // Full lanes between cards (everyone at depth 0); in the deep hero formation
      // depths are already apart, so only a nudge.
      const lane = (LANES[a.id] || 0) * (Math.abs(a.z) < 1 && Math.abs(p.z) < 1 ? 1 : 0.3);
      let h = clamp(30 + step * 0.3, 36, 200);
      // Anyone standing within the depths and width this hop sweeps through is an
      // obstacle: arc above the tallest of them, and change depth only near the top.
      const zLo = Math.min(a.z, p.z) + Math.min(0, lane) - a.thick / 2;
      const zHi = Math.max(a.z, p.z) + Math.max(0, lane) + a.thick / 2;
      const x0 = Math.min(a.sx, tx) - a.width / 2, x1 = Math.max(a.sx, tx) + a.width / 2;
      let top = Infinity;
      for (const o of actors) {
        if (o === a || !o.visible || o.mode === "travel" || o.mode === "fly" || o.mode === "drag") continue;
        if (o.z + o.thick / 2 < zLo || o.z - o.thick / 2 > zHi) continue;
        if (o.sx + o.width / 2 < x0 || o.sx - o.width / 2 > x1) continue;
        top = Math.min(top, o.sy - o.hopY - o.size * 1.04);
      }
      const blocked = top < Infinity;
      if (blocked) h = Math.max(h, Math.max(a.sy, ty) - top + 16);
      a.leg = {
        t: 0, crouch: 0.08, fromX: a.sx, fromY: a.sy, fromZ: a.z, fromS: a.size, k, lane, blocked,
        dur: clamp(0.3 + Math.max(step, h) / 1300, 0.32, 0.66), h,
      };
    }
    const L = a.leg;
    L.t += dt;
    if (L.t < L.crouch) { a.sq = damp(a.sq, 0.86, 30, dt); return; }
    const q = clamp((L.t - L.crouch) / L.dur, 0, 1);
    const tx = L.fromX + (p.sx - L.fromX) * L.k, ty = L.fromY + (p.sy - L.fromY) * L.k;
    const e = easeInOut(q);
    const ze = L.blocked ? easeInOut(clamp((q - 0.3) / 0.4, 0, 1)) : e;
    a.sx = L.fromX + (tx - L.fromX) * e;
    a.sy = L.fromY + (ty - L.fromY) * q - L.h * 4 * q * (1 - q);
    a.z = L.fromZ + (p.z - L.fromZ) * ze + L.lane * Math.sin(q * Math.PI);
    a.size = L.fromS + (p.size - L.fromS) * e;
    a.roll = clamp((tx - L.fromX) / 1100, -0.28, 0.28) * Math.sin(q * Math.PI);
    if (q >= 1) {
      a.land(0.75);
      a.leg = null;
      if (L.k >= 1) a.mode = "rest";
    }
  }

  function updateFly(a, rects, dt) {
    const prev = a.sy;
    a.vy += GRAVITY * dt;
    a.sx += a.vx * dt;
    a.sy += a.vy * dt;
    a.roll += a.vx * dt * 0.0035;
    a.z = damp(a.z, FRONT, 6, dt);
    const half = a.width / 2;
    if (a.sx < half) { a.sx = half; a.vx = Math.abs(a.vx) * 0.55; }
    if (a.sx > stage.W - half) { a.sx = stage.W - half; a.vx = -Math.abs(a.vx) * 0.55; }
    if (a.sy - a.size < 0 && a.vy < 0) { a.sy = a.size; a.vy = Math.abs(a.vy) * 0.35; }
    let surface = null;
    if (a.vy > 0) {
      for (const { el, r, top } of rects) {
        if (prev <= top + 2 && a.sy >= top && a.sx > r.left + 2 && a.sx < r.right - 2) { surface = { el, r, top }; break; }
      }
    }
    const floor = stage.H - 4;
    if (surface || a.sy >= floor) {
      a.sy = surface ? surface.top : floor;
      if (a.vy > 950) {
        a.vy = -a.vy * 0.32;
        a.vx *= 0.7;
        a.land(1);
        return;
      }
      a.vx = a.vy = 0;
      a.roll = 0;
      for (const o of actors) {
        if (o === a || Math.abs(o.z - a.z) > (o.thick + a.thick) / 2 || Math.abs(o.sy - a.sy) > a.size) continue;
        const gap = (o.width + a.width) / 2 + 4;
        if (Math.abs(o.sx - a.sx) < gap) a.sx = o.sx + (a.sx < o.sx ? -gap : gap);
      }
      a.land(1);
      a.mode = "perched";
      a.perchUntil = performance.now() + 2800;
      a.anchor = surface
        ? { el: surface.el, fx: (a.sx - surface.r.left) / surface.r.width, size: a.size, z: a.z }
        : { screen: [a.sx, floor], size: a.size, z: a.z };
      stage.say(a.id, surface ? "Nice landing." : "Oof.", 1400);
      emit("landed", a.id);
    }
  }

  // ---- The frame loop ----------------------------------------------------------

  // Depth dodge: a moving character (hopping, flying, held) that is about to
  // overlap another body slips in front of or behind it instead of through it.
  // Two movers split the difference by lane. Applied before contact, with a margin.
  const moving = (a) => a.mode === "travel" || a.mode === "fly" || a.mode === "drag";
  // Compared in world space, where bodies actually meet (screen space hides depth).
  function worldXY(a) {
    const k = (stage.D - (a.z + a.dz)) / stage.D;
    return [(a.sx - stage.W / 2) * k, (stage.H / 2 - a.sy) * k + a.hopY];
  }
  function near2D(a, b, m) {
    const [ax, ay] = worldXY(a), [bx, by] = worldXY(b);
    return Math.abs(ax - bx) < ((a.width + b.width) / 2) * m && ay < by + b.size * m && by < ay + a.size * m;
  }
  function dodge(dt) {
    // Anyone moving takes part, and anyone still offset from an earlier dodge.
    const active = actors.filter((a) => a.visible && !a.rideOn && (moving(a) || Math.abs(a.dz) > 0.5));
    for (const a of active) {
      // Try easing back toward its own depth first; keep that only if it is clear.
      let z = a.z + damp(a.dz, 0, 8, dt);
      for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        for (const b of actors) {
          if (b === a || !b.visible || a.rideOn === b.id || b.rideOn === a.id) continue;
          if (!near2D(a, b, 1.35)) continue;
          const need = (a.thick + b.thick) / 2 + 8;
          const bz = b.z + b.dz;
          if (Math.abs(z - bz) >= need) continue;
          // Stay on the side it is already on, so it never crosses through; two
          // that start level part by lane. A step of a few px of depth is
          // invisible as a size change, so it applies at once.
          const side = a.z + a.dz - bz;
          const dir = Math.abs(side) > 1 ? Math.sign(side) : (LANES[a.id] || 0) >= (LANES[b.id] || 0) ? 1 : -1;
          z = bz + dir * need;
          moved = true;
        }
        if (!moved) break;
      }
      a.dz = z - a.z;
    }
    // A rider shares its carrier's dodge, in the same frame.
    for (const a of actors) if (a.rideOn && stage.actors[a.rideOn]) a.dz = stage.actors[a.rideOn].dz;
  }

  // Bodies as boxes in world space, trimmed a little since silhouettes are not boxes.
  function measureOverlaps() {
    const box = (a) => {
      const X = a.root.position.x, Y = a.root.position.y + a.hopY, w = a.width * 0.84, h = a.size * clamp(a.sq, 0.6, 1.3) * 0.9;
      const Z = a.root.position.z;
      return { x0: X - w / 2, x1: X + w / 2, y0: Y, y1: Y + h, z0: Z - a.thick / 2 + 2, z1: Z + a.thick / 2 - 2 };
    };
    const list = actors.filter((a) => a.visible).map((a) => [a, box(a)]);
    const pairs = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, p] = list[i], [b, q] = list[j];
      if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1 && p.z0 < q.z1 && q.z0 < p.z1) pairs.push(`${a.id}+${b.id}:${a.mode}/${b.mode}`);
    }
    const d = stage.debug;
    d.frames++;
    if (pairs.length) {
      d.bad++;
      for (const p of pairs) d.pairs[p] = (d.pairs[p] || 0) + 1;
      if (d.samples.length < 24) {
        const s = (id) => { const a = stage.actors[id]; return `${id}(x${a.sx | 0},y${a.sy | 0},z${a.root.position.z | 0},dz${a.dz | 0},${a.mode},leg${a.leg ? a.leg.blocked : "-"})`; };
        d.samples.push(`${(performance.now() / 1000).toFixed(1)} ` + pairs.map((p) => p.split(":")[0].split("+").map(s).join(" & ")).join(" | "));
      }
    }
  }
  if (new URLSearchParams(location.search).has("squad-debug")) {
    stage.debug = { frames: 0, bad: 0, pairs: {}, samples: [] };
    window.squadStage = stage;
  }

  const clock = new THREE.Clock();
  const head = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();
    const time = clock.elapsedTime;
    rectCache.clear();
    const rects = perchRects();
    stage.scrollV = damp(stage.scrollV, 0, 6, dt);
    const scrollFast = Math.abs(stage.scrollV);

    for (const a of actors) {
      let sqSet = false;
      if (a.mode === "script" && a.script) {
        a.script.t += dt;
        const s = a.script.fn(a.script.t, a, stage) || {};
        for (const k of ["sx", "sy", "z", "size", "yaw", "roll", "spin", "hopY"]) if (s[k] !== undefined) a[k] = s[k];
        if (s.sq !== undefined) { a.sq = s.sq; a.sqv = 0; sqSet = true; }
        if (s.glow !== undefined) a.glowTarget = s.glow;
        if (s.done) stage.stopScript(a.id);
      } else if (a.mode === "drag" && drag) {
        const tx = stage.pointer.x + drag.ox, ty = stage.pointer.y + drag.oy;
        // A spring (stiffness ~300, damping ~30) so the body lags and swings.
        a.vx += ((tx - a.sx) * 320 - a.vx * 30) * dt;
        a.vy += ((ty - a.sy) * 320 - a.vy * 30) * dt;
        a.sx += a.vx * dt;
        a.sy += a.vy * dt;
        a.roll = damp(a.roll, clamp(-a.vx / 2400, -0.7, 0.7), 10, dt);
        a.z = damp(a.z, FRONT, 8, dt);
      } else if (a.mode === "fly") {
        updateFly(a, rects, dt);
      } else {
        if (a.mode === "perched" && now > a.perchUntil) a.travelTo(a.home);
        // Parked characters peek in from the edge now and then.
        if (a.anchor?.park && !a.anchor.hide && !stage.reduced && a.mode === "rest") {
          a.peekT -= dt;
          if (a.peekT < 0) {
            a.peeking = !a.peeking;
            a.peekT = a.peeking ? 1.4 + Math.random() * 1.2 : 6 + Math.random() * 10;
          }
          a.peekAmt = damp(a.peekAmt, a.peeking ? 1 : 0, a.peeking ? 5 : 3.5, dt);
          a.lean = (a.anchor.park === "left" ? -0.16 : 0.16) * a.peekAmt;
        } else {
          a.peekAmt = damp(a.peekAmt, 0, 4, dt);
          a.peeking = false;
          a.lean = 0;
        }
        const p = stage.resolve(a.anchor, a);
        if (a.mode === "travel") updateTravel(a, p, dt);
        else if (p && p.stick) {
          a.sx = p.sx; a.sy = p.sy; a.z = p.z;
          a.size = damp(a.size, p.size, 7, dt);
        } else if (p) {
          // Ride along with the card it stands on.
          a.sx = damp(a.sx, p.sx, 24, dt);
          a.sy = damp(a.sy, p.sy, 24, dt);
          a.z = damp(a.z, p.z, 8, dt);
          a.size = damp(a.size, p.size, 7, dt);
        }
        a.rideOn = p && p.rideOn ? p.rideOn : null;
        if (a.mode !== "travel") a.roll = damp(a.roll, a.lean, 8, dt);
        // Idle life: a little hop, a glance around, a bounce when the page moves fast.
        if (a.mode === "rest" && !stage.reduced) {
          a.nextIdle -= dt;
          if (a.nextIdle < 0) {
            a.nextIdle = 3.5 + Math.random() * 6;
            if (Math.random() < 0.5) a.hopNow({ height: 0.14 + Math.random() * 0.12, dur: 0.32 });
            else a.yawBias = (Math.random() - 0.5) * 0.9;
          }
          if (scrollFast > 2200 && !a.hop && Math.random() < dt * 3) a.hopNow({ height: 0.22, dur: 0.3 });
        }
      }
      a.yawBias = damp(a.yawBias, 0, 0.5, dt);

      // Hops, with a crouch first (anticipation).
      if (a.hop) {
        const H = a.hop;
        H.t += dt;
        if (H.t < H.anticip) a.sq = damp(a.sq, 0.88, 30, dt);
        else {
          const q = clamp((H.t - H.anticip) / H.dur, 0, 1);
          a.hopY = H.h * 4 * q * (1 - q);
          if (q >= 1) { a.hop = null; a.hopY = 0; a.land(0.55); }
        }
      } else if (a.mode !== "script") a.hopY = damp(a.hopY, 0, 20, dt);
      if (a.spinT) {
        a.spinT.t += dt;
        const q = clamp(a.spinT.t / a.spinT.dur, 0, 1);
        a.spin = easeOut(q) * Math.PI * 2 * a.spinT.turns;
        if (q >= 1) { a.spinT = null; a.spin = 0; }
      }

      // Squash spring: lands low, overshoots, settles (follow-through).
      if (!sqSet) {
        const breathe = a.mode === "rest" && !stage.reduced ? Math.sin(time * 2.4 + a.phase) * 0.012 : 0;
        const squeeze = a.mode === "rest" ? -clamp(scrollFast / 9000, 0, 0.1) : 0;
        a.sqv += ((1 + breathe + squeeze - a.sq) * 380 - a.sqv * 13) * dt;
        a.sq += a.sqv * dt;
      }

      // Look toward the pointer, or at a teammate.
      if (a.mode !== "script") {
        const headY = a.sy - a.size * 0.6;
        const lx = a.lookAt ? a.lookAt.sx : stage.pointer.x;
        const ly = a.lookAt ? a.lookAt.sy - a.lookAt.size * 0.6 : stage.pointer.y;
        const wantYaw = clamp(((lx - a.sx) / stage.W) * 1.7, -0.62, 0.62) + a.yawBias;
        const wantPitch = a.mode === "fly" ? 0 : clamp(((ly - headY) / stage.H) * 0.7, -0.28, 0.28);
        a.yaw = damp(a.yaw, stage.reduced ? 0 : wantYaw, 6, dt);
        a.pitch = damp(a.pitch, stage.reduced ? 0 : wantPitch, 6, dt);
      } else a.pitch = damp(a.pitch, 0, 6, dt);

      // Glow: hovered, grabbed, or pulsing while it waits for your OK.
      const hover = a === hovered || a.mode === "drag" ? 0.4 : 0;
      const pulse = a.pulse ? 0.35 + 0.35 * Math.sin(time * 5) : 0;
      a.glow = damp(a.glow, Math.min(1.2, a.glowTarget + hover + pulse), 5, dt);

    }
    dodge(dt);
    for (const a of actors) {
      // Screen feet position → world position at this depth.
      const z = a.z + a.dz;
      const k = (stage.D - z) / stage.D;
      a.root.position.set((a.sx - stage.W / 2) * k, (stage.H / 2 - a.sy) * k, z);
      a.lift.position.y = a.hopY;
      a.turn.rotation.set(a.pitch, a.yaw + a.spin, a.roll);
      const sq = clamp(a.sq, 0.6, 1.3);
      const wide = 1 + (1 - sq) * 0.5;
      a.squashG.scale.set(wide, sq, wide);
      a.holder.scale.setScalar(a.size / a.model.height);
      a.halo.position.set(0, a.size * 0.5, -a.size * a.model.depthRatio * 0.7);
      a.halo.scale.setScalar(a.size * 2.3);
      a.halo.material.opacity = 0.03 + 0.4 * a.glow;
      a.pool.position.set(0, 2, a.size * 0.25);
      a.pool.scale.set(a.width * 1.8, a.size * 0.32, 1);
      a.pool.material.opacity = (0.05 + 0.32 * a.glow) * clamp(1 - a.hopY / (a.size * 0.8), 0, 1);
      a.model.side.emissiveIntensity = 0.04 + 0.16 * a.glow;
      // On screen at all (a parked character peeking in counts; one fully past the edge does not).
      a.visible = a.sx + a.width / 2 > 0 && a.sx - a.width / 2 < stage.W && a.sy > -40 && a.sy - a.size * 1.2 < stage.H;
      a.root.visible = a.visible;
    }

    if (stage.debug) measureOverlaps();
    renderer.render(scene, camera);

    // Speech bubbles follow their character's head.
    for (let i = callouts.length - 1; i >= 0; i--) {
      const c = callouts[i];
      if (now > c.until || !c.a.visible) {
        c.el.classList.remove("is-in");
        const el = c.el;
        setTimeout(() => el.remove(), 260);
        callouts.splice(i, 1);
        continue;
      }
      head.copy(c.a.root.position);
      head.y += c.a.hopY + c.a.size * 1.06;
      head.project(camera);
      const x = (head.x * 0.5 + 0.5) * stage.W, y = (-head.y * 0.5 + 0.5) * stage.H;
      const half = c.el.offsetWidth / 2 + 10;
      c.el.style.transform = `translate(${clamp(x, half, stage.W - half).toFixed(1)}px, ${Math.max(y, 56).toFixed(1)}px) translate(-50%, -100%)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return stage;
}
