// Demo loops (v4.1). Each [data-scene] demo is a timeline: an element with data-at="s" gets its class
// (data-cls, default "on") at that second and loses it at data-off; the loop holds 3 s after its last step. [data-type="start dur"] text appears word by
// word (letter by letter for one word). The page markup is the still end state: it shows with no JS and under
// prefers-reduced-motion. Loops play only in view, pause off-screen, in a hidden tab and on the pause button.
const RM = matchMedia("(prefers-reduced-motion: reduce)");

function setup(root) {
  let len = 0;
  const btn = root.querySelector(".pause"), ev = [], items = [];
  for (const el of root.querySelectorAll("[data-type]")) {
    const [s, d] = el.dataset.type.split(" ").map(Number), txt = el.textContent;
    const parts = txt.includes(" ") ? txt.split(/(?<= )/) : [...txt];
    el.replaceChildren(...parts.map((p, i) => {
      const sp = document.createElement("span");
      sp.textContent = p;
      sp.dataset.at = s + (d * i) / parts.length;
      return sp;
    }));
  }
  for (const el of root.querySelectorAll("[data-at]")) {
    const cls = el.dataset.cls || "on";
    items.push({ el, cls, orig: el.classList.contains(cls) });
    ev.push({ t: el.dataset.at * 1000, el, cls, on: true });
    if (el.dataset.off) ev.push({ t: el.dataset.off * 1000, el, cls, on: false });
  }
  ev.sort((a, b) => a.t - b.t);
  len = ev.at(-1).t + 3000;

  let t = 0, i = 0, t0 = 0, timer = 0, playing = false, inView = false, held = false;
  const reset = () => { items.forEach((it) => it.el.classList.remove(it.cls)); i = 0; t = 0; };
  const next = () => {
    while (i < ev.length && ev[i].t <= t) { const e = ev[i++]; e.el.classList.toggle(e.cls, e.on); }
    timer = setTimeout(() => {
      t = performance.now() - t0;
      if (t >= len) { reset(); t0 = performance.now(); }
      next();
    }, (i < ev.length ? ev[i].t : len) - t);
  };
  const play = (on) => {
    if (on === playing) return;
    playing = on;
    root.classList.toggle("paused", !on); // kit rule: freezes the CSS keyframes (dots) too
    if (on) { t0 = performance.now() - t; next(); } else { clearTimeout(timer); t = performance.now() - t0; }
  };
  const sync = () => play(inView && !held && !document.hidden && !RM.matches);
  const motion = () => {
    play(false);
    root.classList.toggle("run", !RM.matches);
    if (btn) btn.hidden = RM.matches;
    if (RM.matches) items.forEach((it) => it.el.classList.toggle(it.cls, it.orig)); // the still end state
    else reset();
    sync();
  };

  btn?.addEventListener("click", () => {
    held = !held;
    btn.setAttribute("aria-pressed", held);
    btn.setAttribute("aria-label", held ? "Play animation" : "Pause animation");
    sync();
  });
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }, { threshold: 0.25 }).observe(root);
  document.addEventListener("visibilitychange", sync);
  RM.addEventListener("change", motion);
  if (!RM.matches) motion();
}

document.querySelectorAll("[data-scene]").forEach(setup);
