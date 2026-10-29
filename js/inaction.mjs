// The "in action" console: one timeline for the whole loop (index.html, .agent-loop). The markup carries the
// timing: [data-at] turns an element on at that second (class is-on) and [data-until] off again, [data-type]
// text types itself in at data-cps characters a second, [data-steps] counts the times it has passed (data-n),
// and the scene follows the start times in data-scenes. The CSS says what "on" looks like. The clock only runs
// while the loop is on screen and the tab is visible, so it never plays to nobody.

export function playLoop(root, { still = null, onScene = () => {}, onBeat = () => {} } = {}) {
  const cycle = Number(root.dataset.cycle);
  const starts = root.dataset.scenes.split(",").map(Number);
  const items = [...root.querySelectorAll("[data-at]")].map((el) => ({
    el,
    at: Number(el.dataset.at),
    until: el.dataset.until ? Number(el.dataset.until) : Infinity,
    text: el.hasAttribute("data-type") ? el.textContent.replace(/\s+/g, " ").trim() : null,
    cps: Number(el.dataset.cps || 40),
    on: false,
    shown: -1,
  }));
  const counters = [...root.querySelectorAll("[data-steps]")].map((el) => ({ el, steps: el.dataset.steps.split(",").map(Number) }));
  const tabs = [...root.querySelectorAll(".al-tabs li")];

  let t = 0,
    last = 0,
    scene = -1,
    visible = false,
    frame = 0;

  function render() {
    for (const it of items) {
      const on = t >= it.at && t < it.until;
      if (on !== it.on) {
        it.on = on;
        it.el.classList.toggle("is-on", on);
        if (on && it.el.dataset.beat) onBeat(it.el.dataset.beat);
      }
      if (it.text !== null) {
        const n = on ? Math.min(it.text.length, Math.floor((t - it.at) * it.cps)) : 0;
        if (n !== it.shown) {
          it.shown = n;
          it.el.textContent = it.text.slice(0, n);
          it.el.classList.toggle("is-typing", on && n < it.text.length);
        }
      }
    }
    for (const c of counters) c.el.dataset.n = c.steps.filter((s) => t >= s).length;
    let now = 0;
    while (now + 1 < starts.length && t >= starts[now + 1]) now++;
    if (now !== scene) {
      scene = now;
      root.dataset.scene = now;
      tabs.forEach((tab, i) => tab.classList.toggle("is-current", i === now));
      onScene(now);
    }
    const end = starts[now + 1] ?? cycle;
    root.style.setProperty("--p", ((t - starts[now]) / (end - starts[now])).toFixed(3));
  }

  function tick(ms) {
    if (last) t = (t + Math.min(0.1, (ms - last) / 1000)) % cycle;
    last = ms;
    render();
    frame = requestAnimationFrame(tick);
  }
  function run() {
    const go = visible && !document.hidden;
    if (go && !frame) {
      last = 0;
      frame = requestAnimationFrame(tick);
    } else if (!go && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  // The wires are written in percent of the stage; redrawn in its real pixels, a dash of pathLength 1 stays one
  // dash (a stretched viewBox would bend the dashes and the stroke).
  const wires = [...root.querySelectorAll(".al-wires")];
  const percent = wires.map((svg) => [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d")));
  function fitWires() {
    const box = wires[0]?.getBoundingClientRect();
    if (!box?.width) return;
    const w = box.width,
      h = box.height;
    wires.forEach((svg, i) => {
      svg.setAttribute("viewBox", `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`);
      svg.querySelectorAll("path").forEach((path, j) => {
        let axis = 0;
        path.setAttribute("d", percent[i][j].replace(/-?\d*\.?\d+/g, (n) => ((Number(n) * (axis++ % 2 ? h : w)) / 100).toFixed(1)));
      });
    });
  }
  if (wires.length) new ResizeObserver(fitWires).observe(wires[0]);

  root.classList.add("is-live");
  // Reduced motion: one still frame (the agent asking for your OK), and no clock.
  if (still !== null) {
    t = still;
    render();
    return;
  }
  render();
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  }).observe(root);
  document.addEventListener("visibilitychange", run);
}
