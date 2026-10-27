// Directs the squad: the hero entrance on the "Orchy AI" wordmark, where
// everyone stands in each section, and how they react to the page.
//
// Bodies never pass through each other. Each character is a solid slab with a
// depth, so every move keeps them apart: in depth (separate lanes, front row,
// back row, behind Orchy) or in height (an arc over whoever is in the way).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

const CREW = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"];
// Entrance order: alternate shoulders, Pink last and onto Orchy's head.
const ENTRANCE = ["red", "orange", "cyan", "blue", "yellow", "green", "purple", "gray", "pink"];
// Hero spots: offset across the formation (fraction of its width), depth, and
// how far the back row stands raised (fraction of Orchy's height). Mirror
// pairs share a depth, so swaps happen within a row.
const SPOTS = {
  red: [-0.23, 150, 0], orange: [0.23, 150, 0],
  yellow: [-0.44, 90, 0], green: [0.44, 90, 0],
  cyan: [-0.335, -220, 0.2], blue: [0.335, -220, 0.2],
  purple: [-0.5, -320, 0.26], gray: [0.5, -320, 0.26],
};

export function startLife(stage, { squad, isReduced }) {
  const $ = (s) => document.querySelector(s);
  const narrow = () => innerWidth < 760;
  const S = () => (narrow() ? 0.72 : 1);
  const info = Object.fromEntries(squad.map((s) => [s.id, s]));
  const A = stage.actors;
  const thick = (a, size = a.size) => size * a.model.depthRatio;

  // ---- Hero geometry: the squad stands on top of the wordmark --------------------

  // Each letter is its own perch, with the top of its ink measured, so a
  // teammate stands on the tallest letter beneath it rather than floating.
  const glyphs = [];
  (function wrapLetters() {
    const word = $("#heroFloor");
    if (!word) return;
    word.removeAttribute("data-perch");
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 1) { walk(child); continue; }
        if (child.nodeType !== 3) continue;
        const frag = document.createDocumentFragment();
        for (const ch of child.textContent) {
          if (ch.trim() === "") { frag.append(ch); continue; }
          const g = document.createElement("span");
          g.className = "glyph";
          g.dataset.perch = "";
          g.textContent = ch;
          frag.append(g);
          glyphs.push(g);
        }
        child.replaceWith(frag);
      }
    };
    walk(word);
  })();
  function measureInk() {
    const word = $("#heroFloor");
    if (!word || !glyphs.length) return;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    word.append(probe);
    const baseline = probe.getBoundingClientRect().top;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d");
    for (const g of glyphs) {
      ctx.font = getComputedStyle(g).font;
      const ascent = ctx.measureText(g.textContent).actualBoundingBoxAscent;
      g.dataset.inkTop = String(baseline - ascent - g.getBoundingClientRect().top);
    }
  }
  measureInk();
  document.fonts?.ready.then(measureInk);
  addEventListener("resize", measureInk);
  // The highest ink under a footprint [x0, x1]; the baseline where there is none.
  function floorAt(x0, x1, fallback) {
    let top = Infinity;
    for (const g of glyphs) {
      const r = stage.rectOf(g);
      if (!r || r.right < x0 || r.left > x1) continue;
      top = Math.min(top, r.top + Number(g.dataset.inkTop || 0));
    }
    return top < Infinity ? top : fallback;
  }

  function hero() {
    const floor = stage.rectOf($("#heroFloor"));
    const box = stage.rectOf($(".hero-visual"));
    if (!floor || !box) return null;
    const orchy = clamp(Math.min(box.height * 0.52, box.width * (narrow() ? 0.36 : 0.3)), 120, 330);
    const cx = floor.left + floor.width / 2;
    const fy = floorAt(cx - orchy * 0.3, cx + orchy * 0.3, floor.top);
    return { cx, fy, w: Math.min(orchy * 2.1, box.width * 0.96), orchy, sub: orchy * 0.4, floor };
  }
  const standY = (g, sx, size) => floorAt(sx - size * 0.32, sx + size * 0.32, g.fy);
  let headSitter = "pink";
  const spotOf = { ...SPOTS };
  const headSpot = (id, g) => {
    // In front of Orchy's face plane, so the sitter never sinks into his ears.
    const o = A.orchy, a = A[id], size = g.sub * 0.78;
    return { sx: o.sx, sy: o.sy - o.size * 0.76 * o.sq - o.hopY, z: o.z + thick(o) / 2 + thick(a, size) / 2 + 6, size, stick: true, rideOn: "orchy" };
  };
  const heroAnchor = (id) => {
    if (id === "orchy") return { fn: () => { const g = hero(); return g && { sx: g.cx, sy: g.fy, z: 0, size: g.orchy }; } };
    if (id === headSitter) return { fn: () => { const g = hero(); return g && headSpot(id, g); } };
    const [fx, z, lift] = spotOf[id];
    return { fn: () => {
      const g = hero();
      if (!g) return null;
      const sx = g.cx + fx * g.w;
      return { sx, sy: standY(g, sx, g.sub) - lift * g.orchy, z, size: g.sub };
    } };
  };

  // ---- The entrance ---------------------------------------------------------------

  let introRunning = false;
  let introToken = 0;

  function orchyDrop(t) {
    const g = hero();
    if (!g) return { done: true };
    const fall = easeIn(seg(t, 0, 0.5));
    if (t < 0.5) return { sx: g.cx, sy: lerp(-60, g.fy, fall), z: 0, size: g.orchy, yaw: 0, roll: 0, glow: 0.4 };
    if (t < 0.52) return { sx: g.cx, sy: g.fy, sq: 0.72, glow: 1 };
    return { sx: g.cx, sy: g.fy, done: true };
  }

  // Rise behind Orchy, peek over a shoulder, look around, crouch, jump out.
  // `lane` keeps teammates who are behind him at the same moment at different depths.
  // `from` (optional) sneaks in from a current spot first, for an encore peek.
  function peekAndJump(id, start, lane = 0, from = null) {
    const side = id === headSitter ? 0 : Math.sign(spotOf[id][0]);
    const spin = ENTRANCE.indexOf(id) % 2 ? 1 : 0;
    const sneak = from ? 0.45 : 0;
    return (t) => {
      const g = hero(), o = A.orchy, a = A[id];
      if (!g) return { done: true };
      const local = t - start - sneak;
      const wo = o.size * o.model.aspect;
      const sub = g.sub;
      const behind = -(thick(o) / 2 + thick(a, sub) / 2 + 8 + lane * 24);
      const hideX = o.sx + side * wo * 0.16;
      const peekX = o.sx + side * wo * 0.33;
      const hideY = o.sy - o.size * 0.24;
      const peekY = o.sy - o.size * (side ? 0.52 : 0.6);
      if (from && local < 0) {
        // Shuffle in behind Orchy at the back, in small hops.
        const q = easeInOut(seg(t - start, 0, sneak));
        const z = lerp(from.z, behind, easeOut(seg(t - start, 0, sneak * 0.5)));
        return { sx: lerp(from.sx, hideX, q), sy: lerp(from.sy, hideY, q) - Math.abs(Math.sin(q * Math.PI * 2)) * sub * 0.12, z, size: sub, yaw: 0, roll: 0 };
      }
      if (local < 0) return { sx: hideX, sy: -4000, z: behind, size: sub, yaw: 0, roll: 0, hopY: 0 };
      if (local < 0.32) {
        const q = easeOut(seg(local, 0, 0.32));
        return { sx: lerp(hideX, peekX, q), sy: lerp(hideY, peekY, q), z: behind, size: sub, roll: -side * 0.24 * q, yaw: side * 0.5 * q, glow: 0.6 };
      }
      if (local < 0.8) {
        // Look out, at you, then back at Orchy.
        const q = seg(local, 0.32, 0.8);
        const yaw = q < 0.4 ? side * 0.5 : q < 0.7 ? lerp(side * 0.5, 0, easeInOut(seg(q, 0.4, 0.7))) : lerp(0, -side * 0.3, easeInOut(seg(q, 0.7, 1)));
        return { sx: peekX, sy: peekY - Math.sin(q * Math.PI * 2) * sub * 0.03, z: behind, size: sub, roll: -side * 0.24, yaw };
      }
      if (local < 0.92) {
        const q = seg(local, 0.8, 0.92);
        return { sx: peekX, sy: peekY + sub * 0.05 * q, z: behind, size: sub, roll: -side * 0.24 * (1 - q), yaw: -side * 0.3 * (1 - q), sq: 1 - 0.16 * q };
      }
      const end = stage.resolve(heroAnchor(id), a) || { sx: peekX, sy: g.fy, z: behind, size: sub };
      const q = seg(local, 0.92, 1.52);
      if (q < 1) {
        // To the front: cross Orchy's depth only at the top of a high arc, above his ears.
        // To the back: step back in depth while still hidden behind him, then slide out.
        const toFront = end.z > behind;
        const xe = toFront ? easeInOut(q) : easeInOut(seg(q, 0.25, 1));
        const ze = toFront ? easeInOut(seg(q, 0.32, 0.58)) : easeOut(seg(q, 0, 0.28));
        const arc = o.size * (toFront ? 0.82 : 0.3);
        return {
          sx: lerp(peekX, end.sx, xe),
          sy: lerp(peekY, end.sy, q) - arc * 4 * q * (1 - q),
          z: lerp(behind, end.z, ze), size: lerp(sub, end.size, q),
          roll: 0, yaw: 0, spin: spin * easeOut(q) * Math.PI * 2, sq: 1.06,
        };
      }
      return { sx: end.sx, sy: end.sy, z: end.z, size: end.size, spin: 0, sq: 0.76, glow: 0.3, done: true };
    };
  }

  async function intro() {
    const token = ++introToken;
    introRunning = true;
    clearTimeout(lifeTimer);
    const all = ["orchy", ...ENTRANCE];
    for (const id of all) stage.setHome(id, heroAnchor(id), { travel: false });
    const jobs = [stage.runScript("orchy", orchyDrop)];
    ENTRANCE.forEach((id, i) => jobs.push(stage.runScript(id, peekAndJump(id, 0.75 + i * 0.5, i % 3))));
    setTimeout(() => token === introToken && stage.say("orchy", "Squad, assemble!", 1600), 650);
    await Promise.all(jobs);
    if (token !== introToken) return;
    introRunning = false;
    stage.say("orchy", "Hi! We're your squad.", 2600);
    for (const id of all) stage.setHome(id, heroAnchor(id), { travel: false });
    scheduleLife();
  }

  function skipIntro() {
    introToken++;
    introRunning = false;
    for (const id of ["orchy", ...ENTRANCE]) {
      stage.stopScript(id);
      stage.place(id, heroAnchor(id));
    }
  }

  // ---- Hero life after the entrance ---------------------------------------------------

  let lifeTimer = 0;
  function scheduleLife() {
    clearTimeout(lifeTimer);
    if (isReduced()) return;
    lifeTimer = setTimeout(heroBeat, 3500 + Math.random() * 3000);
  }
  const busy = () => ["orchy", ...CREW].some((id) => A[id].mode !== "rest");
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  function heroBeat() {
    if (section !== "hero" || introRunning || isReduced() || busy()) return scheduleLife();
    const r = Math.random();
    const floorCrew = CREW.filter((id) => id !== headSitter);
    if (r < 0.35) {
      // A back-row teammate sneaks behind Orchy and peeks over a shoulder again.
      const id = pick(floorCrew.filter((c) => spotOf[c][1] < 0));
      if (id) {
        const a = A[id];
        stage.runScript(id, peekAndJump(id, 0, 0, { sx: a.sx, sy: a.sy, z: a.z })).then(() => {
          if (section === "hero") stage.setHome(id, heroAnchor(id), { travel: false });
        });
      }
    } else if (r < 0.6) {
      // A mirror pair swaps sides, passing each other in separate depth lanes.
      const pairs = [["red", "orange"], ["yellow", "green"], ["cyan", "blue"], ["purple", "gray"]]
        .filter(([a, b]) => a !== headSitter && b !== headSitter && spotOf[a][1] === spotOf[b][1]);
      const pair = pick(pairs);
      if (pair) {
        const [a, b] = pair;
        [spotOf[a], spotOf[b]] = [spotOf[b], spotOf[a]];
        stage.setHome(a, heroAnchor(a));
        stage.setHome(b, heroAnchor(b));
      }
    } else if (r < 0.8) {
      // A front-row teammate takes a turn on Orchy's head (front row only: it
      // never has to pass through him to get there).
      const next = pick(floorCrew.filter((c) => spotOf[c][1] > 0));
      if (next) {
        const prev = headSitter;
        spotOf[prev] = spotOf[next];
        headSitter = next;
        stage.setHome(next, heroAnchor(next));
        setTimeout(() => stage.setHome(prev, heroAnchor(prev)), 180);
        stage.say(next, "My turn!", 1400);
      }
    } else {
      const id = pick(floorCrew);
      if (id) stage.hop(id, { height: 0.6, dur: 0.5, spin: 1 });
    }
    scheduleLife();
  }

  // ---- Where everyone stands in each section ---------------------------------------
  // Spots on a card are spaced wider than the characters, so nobody overlaps at rest.

  let section = "hero";
  let runAgent = null;

  // How it works: Orchy stands in the free space beside the lit step and hops
  // down as the demo moves through them, below the sticky nav rather than on the
  // console's top edge. The teammate on the task stands in the run output beside
  // its checklist, then on the approval card while it waits for your OK.
  let howStep = 0;
  let runSpot = "work";
  // The free space runs from the end of a step's text to the console.
  const stepRoom = () => {
    const text = $(".workflow-step p"), con = $(".demo-console");
    return text && con ? con.getBoundingClientRect().left - text.getBoundingClientRect().right : 0;
  };
  const stepAnchor = () => ({ fn: () => {
    const step = $(`.workflow-step[data-step="${howStep}"]`);
    const r = stage.rectOf(step), t = stage.rectOf(step?.querySelector("p")), c = stage.rectOf($(".demo-console"));
    if (!r || !t || !c) return null;
    const size = Math.min(84, ((c.left - t.right) * 0.7) / A.orchy.model.aspect);
    return { sx: (t.right + c.left) / 2, sy: r.bottom - 8, z: 0, size };
  } });
  const runAnchor = () => (runSpot === "gate"
    ? on(".run-gate", 0.86, 60)
    : on(".run-steps", 0.8, 60, { fy: 1 }));

  // Parked characters wait just off the screen edges, one per slot, and peek in.
  const park = (id, i) => (narrow()
    ? { park: i % 2 ? "right" : "left", fy: 0.5, hide: true, size: 64 }
    : { park: i % 2 ? "right" : "left", fy: 0.22 + (Math.floor(i / 2) % 5) * 0.14, size: 78 });
  const on = (el, fx, size, extra = {}) => ({ el, fx, size: size * S(), ...extra });

  function layout(name) {
    const L = {};
    const n = narrow();
    if (name === "hero") {
      for (const id of ["orchy", ...CREW]) L[id] = heroAnchor(id);
    } else if (name === "how") {
      // Where the steps leave no room beside their text, Orchy keeps the console's edge.
      L.orchy = !n && stepRoom() >= 70 ? stepAnchor() : on(".demo-console", n ? 0.84 : 0.1, 96);
      if (runAgent) L[runAgent] = runAnchor();
    } else if (name === "rules") {
      L.blue = on(".approval-card", 0.86, 70);
      L.red = on(".workspace-stack > div:nth-child(1)", 0.92, 40);
      L.yellow = on(".workspace-stack > div:nth-child(2)", 0.92, 40);
      L.purple = on(".workspace-stack > div:nth-child(3)", 0.92, 40);
      // Orchy stands inside the localhost window, at home on your machine.
      L.orchy = on(".local-window", 0.5, n ? 64 : 82, { fy: 0.9 });
      if (!n) {
        L.green = on(".connections", 0.42, 62);
        L.gray = on(".connections", 0.52, 62);
      }
    } else if (name === "install") {
      const line = n ? ["orange", "cyan", "orchy", "blue", "pink"] : ["red", "orange", "yellow", "orchy", "cyan", "blue", "pink"];
      line.forEach((id, i) => (L[id] = on(".setup-panel", 0.1 + (0.8 * i) / (line.length - 1), id === "orchy" ? 72 : 56)));
    } else if (name === "footer") {
      L.orchy = on(".footer-top", n ? 0.86 : 0.5, 72);
      L.green = on(".footer-top", n ? 0.66 : 0.58, 50);
    }
    ["orchy", ...CREW].forEach((id, i) => { if (!L[id]) L[id] = park(id, i); });
    return L;
  }

  // Set off in a stagger, so only a few move at once and arrivals don't pile up.
  let applyToken = 0;
  function apply({ travel = true } = {}) {
    const token = ++applyToken;
    const moveNow = travel && !isReduced();
    Object.entries(layout(section)).forEach(([id, anchor], i) => {
      if (!moveNow || i === 0) return stage.setHome(id, anchor, { travel: moveNow });
      setTimeout(() => token === applyToken && stage.setHome(id, anchor), i * 80);
    });
  }

  function enter(name) {
    if (name === section) return;
    const was = section;
    section = name;
    if (was === "hero" && introRunning) skipIntro();
    for (const id of ["orchy", ...CREW]) { stage.setPulse(id, false); stage.setGlow(id, 0.25); }
    apply();
    if (name === "rules") setTimeout(() => { stage.setPulse("blue", true); stage.say("blue", "Waiting for your OK.", 2600); }, 900);
    if (name === "install") setTimeout(() => stage.say("orchy", "Three lines and we're yours.", 2600), 900);
    if (name === "footer") setTimeout(() => stage.say("orchy", "See you on localhost!", 2400), 700);
    scheduleRules();
  }

  const sections = [["#top", "hero"], ["#how", "how"], ["#your-rules", "rules"], ["#install", "install"], [".footer", "footer"]];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) enter(e.target.dataset.life);
  }, { rootMargin: "-50% 0px -50% 0px" });
  for (const [sel, name] of sections) {
    const el = $(sel);
    if (el) { el.dataset.life = name; io.observe(el); }
  }

  // Workspaces: now and then a teammate tries another client's room and is turned back.
  let rulesTimer = 0;
  function scheduleRules() {
    clearTimeout(rulesTimer);
    if (section !== "rules" || isReduced()) return;
    rulesTimer = setTimeout(() => {
      const rows = ["red", "yellow", "purple"];
      const i = Math.floor(Math.random() * 3);
      const id = rows[i];
      const row = (k) => `.workspace-stack > div:nth-child(${k + 1})`;
      stage.setHome(id, on(row((i + 1) % 3), 0.72, 40));
      setTimeout(() => {
        stage.say(id, "Wrong login. Refused.", 1800, "refused");
        stage.setHome(id, on(row(i), 0.92, 40));
      }, 560);
      scheduleRules();
    }, 4200 + Math.random() * 2500);
  }

  // ---- Reacting to the page ------------------------------------------------------------

  stage.on("pick", (id) => stage.say(id, info[id]?.tag || "Hi!", 2400));

  document.addEventListener("orchy:run", ({ detail }) => {
    const { phase, agent } = detail;
    if (phase === "start") {
      if (runAgent && runAgent !== agent) stage.setPulse(runAgent, false);
      runAgent = agent;
      runSpot = "work";
      if (section === "how") apply();
      stage.hop("orchy", { height: 0.3, dur: 0.36 });
      stage.say("orchy", `This one's for ${info[agent]?.name || "the squad"}.`, 1800);
      stage.setGlow(agent, 0.9);
    } else if (phase === "gate") {
      runSpot = "gate";
      // The approval card is added right after this event.
      requestAnimationFrame(() => section === "how" && runAgent === agent && stage.setHome(agent, runAnchor()));
      stage.setPulse(agent, true);
      stage.say(agent, "Ready. This part needs your OK.", 3200);
    } else if (phase === "done") {
      // Celebrate where the card was, then hop back beside the checklist.
      if (runSpot === "gate") {
        runSpot = "work";
        setTimeout(() => section === "how" && runAgent === agent && stage.setHome(agent, runAnchor()), 700);
      }
      stage.setPulse(agent, false);
      if (detail.ok === false) { stage.slump(agent); stage.say(agent, "Holding. Nothing sent.", 2000); }
      else { stage.hop(agent, { height: 0.7, dur: 0.5, spin: 1 }); stage.say(agent, "Done!", 1600); stage.setGlow(agent, 0.5); }
    }
  });

  document.addEventListener("orchy:step", ({ detail }) => {
    if (detail.step === howStep) return;
    howStep = detail.step;
    if (section === "how" && A.orchy.home?.fn && !narrow()) stage.setHome("orchy", stepAnchor());
  });

  document.addEventListener("orchy:approve", ({ detail }) => {
    stage.setPulse("blue", false);
    if (detail.ok) { stage.hop("blue", { height: 0.8, dur: 0.52, spin: 1 }); stage.say("blue", "Thanks! (Sample: nothing sent.)", 2200); }
    else { stage.slump("blue"); stage.say("blue", "OK, holding it.", 1800); }
  });

  document.addEventListener("orchy:copied", () => {
    if (section !== "install") return;
    const line = Object.entries(layout("install")).filter(([, a]) => a.el).map(([id]) => id);
    line.forEach((id, i) => setTimeout(() => stage.hop(id, { height: 0.75, dur: 0.46, spin: id === "orchy" ? 1 : 0 }), i * 60));
    setTimeout(() => stage.say("orchy", "Copied! Paste them in a terminal.", 2400), 300);
  });

  // ---- Start ---------------------------------------------------------------------------

  const heroBox = $("#top");
  const startAtTop = heroBox && heroBox.getBoundingClientRect().bottom > innerHeight * 0.5;
  if (startAtTop && !isReduced()) intro();
  else {
    section = startAtTop ? "hero" : "";
    if (startAtTop) skipIntro();
  }
  addEventListener("resize", () => apply({ travel: false }));

  return {
    replay() {
      if (section !== "hero") return;
      skipIntro();
      if (!isReduced()) intro();
    },
    setReduced(v) {
      stage.setReduced(v);
      if (v) { if (introRunning) skipIntro(); apply({ travel: false }); clearTimeout(lifeTimer); }
      else scheduleLife();
    },
  };
}
