import { SQUAD, renderSprite } from "./robots.mjs";
import { playLoop } from "./inaction.mjs";
const $ = (selector, root = document) => root.querySelector(selector);
// The 3D squad listens for these page events.
const tell = (name, detail = {}) => document.dispatchEvent(new CustomEvent(name, { detail }));
let life = null;
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const root = document.documentElement;
// Motion follows the system's reduced-motion setting.
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = () => motionQuery.matches;
function applyMotion() {
  root.classList.toggle("motion-paused", reducedMotion());
  life?.setReduced(reducedMotion());
}
applyMotion();
motionQuery.addEventListener("change", applyMotion);

$$("[data-bot]").forEach((el) => renderSprite(el, el.dataset.bot));

// The living squad: the supplied art, extruded into real 3D characters that
// move around the page. Without WebGL the page keeps its static artwork.
async function bootSquad() {
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("WebGL is unavailable");
    const [{ loadSquadArt }, { createStage }, { startLife }] = await Promise.all([
      import("./art.mjs"), import("./stage.mjs"), import("./life.mjs"),
    ]);
    const art = await loadSquadArt();
    const stage = await createStage({ canvas: $("#squadStage"), overlay: $("#squadCallouts"), art, squad: SQUAD });
    stage.setReduced(reducedMotion());
    root.classList.add("has-stage");
    life = startLife(stage, { squad: SQUAD, isReduced: reducedMotion });
  } catch (error) {
    root.classList.add("no-stage");
    console.warn("The 3D squad could not start:", error);
  }
}
// The squad is a desktop extra: it pulls Three.js and traces the art on the main thread, so it waits until the
// page has loaded and the browser is idle. Small screens, Save-Data and reduced motion keep the static art.
function squadAllowed({ narrow, saveData, reduced }) {
  return !narrow && !saveData && !reduced;
}
function whenIdle(task) {
  const idle = () =>
    "requestIdleCallback" in window ? requestIdleCallback(task, { timeout: 4000 }) : setTimeout(task, 1);
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}
if (squadAllowed({
  narrow: matchMedia("(max-width: 768px)").matches,
  saveData: Boolean(navigator.connection?.saveData),
  reduced: reducedMotion(),
})) whenIdle(bootSquad);
else root.classList.add("no-stage");

// Progressive enhancement: page content remains visible if JavaScript is unavailable.
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08 },
);
$$(".reveal").forEach((el) => revealObserver.observe(el));
root.classList.add("js-motion");
let scrollFrame = 0;
function progress() {
  scrollFrame = 0;
  const max = document.documentElement.scrollHeight - innerHeight;
  $(".scroll-progress").style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
}
addEventListener(
  "scroll",
  () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(progress);
  },
  { passive: true },
);
addEventListener("resize", progress);
progress();

const menuButton = $(".menu-toggle"),
  nav = $("#navLinks");
function setMenu(open) {
  nav.classList.toggle("is-open", open);
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
}
menuButton.addEventListener("click", () =>
  setMenu(menuButton.getAttribute("aria-expanded") !== "true"),
);
nav.addEventListener("click", (e) => {
  if (e.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    menuButton.getAttribute("aria-expanded") === "true"
  ) {
    setMenu(false);
    menuButton.focus();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".nav")) setMenu(false);
});
matchMedia("(min-width:651px)").addEventListener("change", (e) => {
  if (e.matches) setMenu(false);
});

function highlightStep(step) {
  $$("[data-step]").forEach((el) =>
    el.classList.toggle("is-active", Number(el.dataset.step) === step),
  );
  tell("orchy:step", { step });
}
// The steps follow the loop beside them: asking lights the first, building the second, and the agent's
// request for your OK the third; Orchy hops down beside them. The squad acts out the build and the run.
const STEP_OF_SCENE = [0, 0, 1, 2];
playLoop($(".agent-loop"), {
  still: reducedMotion() ? 29 : null,
  onScene: (scene) => {
    highlightStep(STEP_OF_SCENE[scene]);
    tell("orchy:loop", { scene });
  },
  onBeat: (beat) => tell("orchy:beat", { beat }),
});
$$("[data-approve]").forEach((button) =>
  button.addEventListener("click", () => {
    $("#approvalStatus").textContent =
      button.dataset.approve === "yes"
        ? "Approved in this demo. Nothing was sent."
        : "Held for your review. Nothing was sent.";
    $$("[data-approve]").forEach((el) =>
      el.setAttribute("aria-pressed", String(el === button)),
    );
    tell("orchy:approve", { ok: button.dataset.approve === "yes" });
  }),
);

// The launch video opens in a glass window over the page; closing it stops playback.
const videoDialog = $("#launchVideo"),
  launchVideo = $("video", videoDialog);
$(".hero-video").addEventListener("click", () => {
  videoDialog.showModal();
  launchVideo.play().catch(() => {});
});
videoDialog.addEventListener("click", (e) => {
  if (e.target === videoDialog) videoDialog.close();
});
videoDialog.addEventListener("close", () => {
  launchVideo.pause();
  $(".hero-video").focus({ preventScroll: true });
});
