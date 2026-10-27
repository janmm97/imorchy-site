import { SQUAD, byId, renderSprite } from "./robots.mjs";
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
bootSquad();

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

const TASKS = {
  update: {
    text: "Draft this week’s project update",
    agent: "orange",
    workspace: "Your studio",
    steps: [
      "Read the project notes",
      "Gathered this week’s progress",
      "Prepared a project update draft",
    ],
    gate: "Ready to share the update with your team?",
    yes: "Approve sharing",
    done: "Sharing approved in this demo. Nothing was sent.",
  },
  research: {
    text: "Research a new idea for my website",
    agent: "cyan",
    workspace: "Personal projects",
    steps: [
      "Read the example project brief",
      "Compared three possible approaches",
      "Saved a sample research brief",
    ],
    done: "Sample brief ready. No external action needed.",
  },
  invoice: {
    text: "Reply to the latest invoice email",
    agent: "blue",
    workspace: "Client project",
    steps: [
      "Read the sample email thread",
      "Checked the invoice details",
      "Prepared a clear reply",
    ],
    gate: "The reply is drafted. Ready to send?",
    yes: "Approve reply",
    done: "Reply approved in this demo. Nothing was sent.",
  },
};
function routeTask(text) {
  const preset = Object.values(TASKS).find(
    (t) => t.text.toLowerCase() === text.toLowerCase(),
  );
  if (preset) return preset;
  const match = [
    [/\b(email|inbox|reply|mail)\b/i, "blue"],
    [/\b(post|social|publish)\b/i, "pink"],
    [/\b(pay|bill|invoice|spend|charge|refund)\b/i, "yellow"],
    [/\b(calendar|schedule|meeting|book)\b/i, "purple"],
    [/\b(delete|remove|organize|clean)\b/i, "gray"],
    [/\b(code|build|bug|website|fix)\b/i, "green"],
    [/\b(write|draft|brief|update)\b/i, "orange"],
  ].find(([re]) => re.test(text));
  const agent = match?.[1] || "cyan";
  const needsApproval =
    /\b(send|reply|email|post|publish|share|pay|buy|spend|charge|refund|delete|remove|schedule|book|calendar|invite)\b/i.test(
      text,
    );
  return {
    text,
    agent,
    workspace: "Your studio",
    steps: [
      "Read the example workspace instructions",
      `Matched the task with ${byId[agent].name}`,
      "Prepared a sample result for your review",
    ],
    gate: needsApproval
      ? "This task includes an action that needs your OK."
      : null,
    yes: "Approve sample",
    done: needsApproval
      ? "Approved in this demo. No real action was taken."
      : "Sample result ready. No real work was performed.",
  };
}
let runId = 0,
  lastTask = null;
const output = $("#demoOutput"),
  form = $("#taskForm"),
  input = $("#task");
const pause = (ms) =>
  new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 80 : ms));
function highlightStep(step) {
  $$("[data-step]").forEach((el) =>
    el.classList.toggle("is-active", Number(el.dataset.step) === step),
  );
  tell("orchy:step", { step });
}
function paragraph(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}
function finishDemo(message) {
  const status = $(".run-status", output);
  status.classList.remove("is-loading");
  status.textContent = message;
  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "run-replay";
  replay.textContent = "Run another example ↺";
  replay.addEventListener("click", () => startRun(lastTask));
  output.append(replay);
}
async function startRun(task) {
  const id = ++runId;
  lastTask = task;
  input.value = task.text;
  highlightStep(0);
  output.replaceChildren();
  const route = document.createElement("div");
  route.className = "run-route";
  const avatar = document.createElement("span");
  renderSprite(avatar, task.agent);
  route.append(avatar);
  const agent = document.createElement("span");
  agent.textContent = `${byId[task.agent].name} / ${task.workspace}`;
  route.append(agent);
  const mode = document.createElement("span");
  mode.textContent = "SAMPLE RUN";
  route.append(mode);
  output.append(route);
  const list = document.createElement("ol");
  list.className = "run-steps";
  output.append(list);
  const status = paragraph(
    "run-status is-loading",
    "Finding the right teammate",
  );
  output.append(status);
  tell("orchy:run", { phase: "start", agent: task.agent });
  await pause(650);
  if (id !== runId) return;
  highlightStep(1);
  status.textContent = `${byId[task.agent].name} is working`;
  for (const text of task.steps) {
    await pause(600);
    if (id !== runId) return;
    const li = document.createElement("li");
    const check = document.createElement("span");
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    li.append(check, document.createTextNode(text));
    list.append(li);
  }
  await pause(350);
  if (id !== runId) return;
  status.classList.remove("is-loading");
  if (!task.gate) {
    highlightStep(2);
    finishDemo(task.done);
    tell("orchy:run", { phase: "done", agent: task.agent, ok: true });
    return;
  }
  highlightStep(2);
  status.textContent = "Routine work done. This next part is your call.";
  tell("orchy:run", { phase: "gate", agent: task.agent });
  const gate = document.createElement("div");
  gate.className = "run-gate";
  gate.append(paragraph("", task.gate));
  const actions = document.createElement("div");
  for (const [label, approved] of [
    [task.yes, true],
    ["Hold for now", false],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button-small ${approved ? "button-mint" : "button-outline"}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      if (id !== runId) return;
      gate.remove();
      finishDemo(
        approved ? task.done : "Held for your review. No action was taken.",
      );
      tell("orchy:run", { phase: "done", agent: task.agent, ok: approved });
      $(".run-replay", output).focus({ preventScroll: true });
    });
    actions.append(button);
  }
  gate.append(actions);
  output.append(gate);
}
$$("[data-task]").forEach((button) =>
  button.addEventListener("click", () => startRun(TASKS[button.dataset.task])),
);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.setCustomValidity("Type a task or choose an example.");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  if (live.connected) liveRun(text);
  else startRun(routeTask(text));
});
input.addEventListener("input", () => input.setCustomValidity(""));

// ── The live playground: one small task in the visitor's own Gmail, through One (site/worker/). The sample
// demo above stays the default; the live parts show only when the Worker says the playground is on.
const live = { available: false, connected: false, email: "", runsLeft: 0 };
const chips = $(".task-chips"),
  sampleChips = [...chips.children],
  liveBar = $("#liveBar");
const LIVE_TASKS = [
  ["What needs my reply?", "Find the emails from the last three days that still need a reply from me, and tell me which matter most."],
  ["Email me a digest", "Email me a short digest of what came into my inbox today."],
  ["Draft a reply", "Draft a reply to the latest email in my inbox that needs one."],
];
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}
const liveChips = LIVE_TASKS.map(([label, task]) => {
  const button = el("button", { type: "button" }, label, " ", el("span", { textContent: "↗" }));
  button.addEventListener("click", () => liveRun(task));
  return button;
});
function renderLive() {
  liveBar.hidden = !live.available;
  liveBar.replaceChildren();
  if (live.connected) {
    const off = el("button", { type: "button", className: "live-link", textContent: "Disconnect" });
    off.addEventListener("click", disconnect);
    liveBar.append(
      el("span", { className: "live-dot", ariaHidden: "true" }),
      el("span", { className: "live-who", textContent: live.email }),
      el("span", { textContent: `${live.runsLeft} ${live.runsLeft === 1 ? "task" : "tasks"} left` }),
      off,
    );
  } else if (live.available) {
    const go = el("button", { type: "button", className: "live-link", textContent: "Use my real inbox ↗" });
    go.addEventListener("click", explainLive);
    liveBar.append(el("span", { textContent: "Want to see it on your own Gmail?" }), go);
  }
  chips.replaceChildren(...(live.connected ? liveChips : sampleChips));
  chips.setAttribute("aria-label", live.connected ? "Try a live task" : "Try a sample task");
  input.placeholder = live.connected ? "Ask Orchy to do something in your inbox…" : "Draft this week’s project update…";
  $("#demoBadge").textContent = live.connected ? "LIVE · GMAIL" : "INTERACTIVE DEMO";
  $("#footNote").replaceChildren(
    el("span", { ariaHidden: "true", textContent: "◇" }),
    live.connected ? " Your Gmail, through One. Sending waits for your OK." : " All sample data. Nothing is sent.",
  );
  $("#footWhere").textContent = live.connected ? `RUNS ON ${location.host.toUpperCase()}` : "100% IN YOUR BROWSER";
}
// What the live mode does and doesn't do, before the visitor leaves for One's sign-in.
function explainLive() {
  ++runId;
  const later = el("button", { type: "button", className: "button button-outline button-small", textContent: "Not now" });
  later.addEventListener("click", () => output.replaceChildren(placeholder));
  output.replaceChildren(
    el(
      "div",
      { className: "live-explain" },
      el("p", { className: "live-title", textContent: "Your inbox, for real." }),
      el(
        "ul",
        {},
        el("li", { textContent: "You sign in to One, or make a free account. One connects your Gmail." }),
        el("li", { textContent: "Orchy can read your mail and save drafts. It sends only when you press Send." }),
        el("li", { textContent: `It runs on ${location.host}, not your computer. Mail it reads goes to Claude (Anthropic) to do the task, and nothing is kept after your visit.` }),
        el("li", { textContent: "Three tasks per visit. Remove Orchy’s access any time from your One dashboard." }),
      ),
      el("div", { className: "live-actions" }, // The fragment survives the redirect: One's page opens on Gmail first, dark like this one.
      el("a", { className: "button button-mint button-small", href: "/api/one/authorize#one_connector=gmail&one_theme=dark", textContent: "Continue with One ↗" }), later),
    ),
  );
}
const placeholder = $(".demo-placeholder");
async function disconnect() {
  await fetch("/api/disconnect", { method: "POST" }).catch(() => {});
  Object.assign(live, { connected: false, email: "", runsLeft: 0 });
  renderLive();
  output.replaceChildren(placeholder);
  toast("Disconnected. To remove Orchy’s access too, revoke it in your One dashboard.");
}
async function liveRun(text) {
  const id = ++runId;
  input.value = text;
  highlightStep(0);
  output.replaceChildren();
  const avatar = el("span");
  renderSprite(avatar, "blue");
  output.append(el("div", { className: "run-route" }, avatar, el("span", { textContent: `${byId.blue.name} / Your Gmail` }), el("span", { textContent: "LIVE RUN" })));
  const list = el("ol", { className: "run-steps" });
  const status = paragraph("run-status is-loading", "Finding the right teammate");
  output.append(list, status);
  tell("orchy:run", { phase: "start", agent: "blue" });
  let finished = false;
  const finish = (message, ok = true) => {
    finished = true;
    status.classList.remove("is-loading");
    status.textContent = message;
    tell("orchy:run", { phase: "done", agent: "blue", ok });
  };
  let res;
  try {
    res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: text }) });
  } catch {
    return finish("Couldn’t reach Orchy. Check your connection and try again.", false);
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    if (res.status === 401) Object.assign(live, { connected: false });
    if (res.status === 429 && /live tasks/.test(error || "")) live.runsLeft = 0;
    renderLive();
    return finish(error || "Something went wrong. Try again in a moment.", false);
  }
  live.runsLeft = Math.max(live.runsLeft - 1, 0);
  renderLive();
  highlightStep(1);
  status.textContent = `${byId.blue.name} is working`;
  const handle = (event) => {
    if (id !== runId) return;
    if (event.type === "step") {
      list.append(el("li", {}, el("span", { ariaHidden: "true", textContent: "✓" }), event.text));
    } else if (event.type === "draft") {
      $(".run-draft", output)?.remove();
      output.insertBefore(
        el(
          "div",
          { className: "run-draft" },
          el("p", {}, el("b", { textContent: "To " }), event.to.join(", ")),
          el("p", {}, el("b", { textContent: "Subject " }), event.subject),
          el("pre", { textContent: event.body }),
        ),
        status,
      );
    } else if (event.type === "gate") {
      finished = true;
      highlightStep(2);
      status.classList.remove("is-loading");
      status.textContent = "Routine work done. This next part is your call.";
      if (event.summary) output.insertBefore(paragraph("run-summary", event.summary), status);
      tell("orchy:run", { phase: "gate", agent: "blue" });
      const gate = el(
        "div",
        { className: "run-gate" },
        el("p", { textContent: "Send this email from your Gmail?" }),
        event.outsiders.length ? el("p", { className: "run-warn", textContent: `It goes to someone other than you: ${event.outsiders.join(", ")}.` }) : null,
      );
      const send = el("button", { type: "button", className: "button button-small button-mint", textContent: "Send it" });
      const keep = el("button", { type: "button", className: "button button-small button-outline", textContent: "Keep as draft" });
      send.addEventListener("click", async () => {
        send.disabled = keep.disabled = true;
        send.textContent = "Sending…";
        const r = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: event.token }) }).catch(() => null);
        const answer = await r?.json().catch(() => ({}));
        gate.remove();
        if (r?.ok) finish(`Sent to ${answer.to.join(", ")}. It’s in your Sent folder.`);
        else finish(answer?.error || "Couldn’t send it. The draft is still in your Gmail.", false);
      });
      keep.addEventListener("click", () => {
        gate.remove();
        finish("Kept as a draft in your Gmail. Nothing was sent.", false);
      });
      gate.append(el("div", {}, send, keep));
      output.append(gate);
    } else if (event.type === "done") {
      highlightStep(2);
      if (event.summary) output.insertBefore(paragraph("run-summary", event.summary), status);
      finish("Done. Nothing was sent.");
    } else if (event.type === "error") {
      finish(event.message, false);
    }
  };
  try {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      for (let cut; (cut = buffer.indexOf("\n\n")) >= 0; buffer = buffer.slice(cut + 2)) {
        const chunk = buffer.slice(0, cut);
        if (chunk.startsWith("data: ")) handle(JSON.parse(chunk.slice(6)));
      }
    }
  } catch {
    if (!finished && id === runId) finish("The connection dropped. Try again.", false);
  }
  if (!finished && id === runId) finish("Orchy stopped early. Try again.", false);
}
// Back from One's sign-in: say how it went, then tidy the address bar.
// One Connect returns ?one_connect=success, or =error with ?one_connect_error=declined|expired|failed;
// the Worker's own outcomes come as ?playground=….
const MESSAGES = {
  success: "Connected. Pick a live task or type your own.",
  declined: "No problem. Nothing was connected.",
  expired: "That took a while, so the sign-in expired. Try connecting again.",
  "no-gmail": "That One account has no Gmail connected. Connect Gmail in One, then try again.",
  busy: "Lots of people trying this right now. Give it a minute.",
};
async function initLive() {
  const params = new URLSearchParams(location.search);
  const status = params.get("one_connect");
  const back = status === "error" ? params.get("one_connect_error") || "failed" : status || params.get("playground");
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    if (res.ok) Object.assign(live, await res.json());
  } catch {
    /* the local preview has no Worker: sample mode only */
  }
  renderLive();
  if (back) {
    toast(MESSAGES[back] || "That didn’t work. Try connecting again.");
    history.replaceState(null, "", location.pathname + "#how");
    $("#how")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
  }
}
initLive();
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

let toastTimer, copyTimer;
function toast(message) {
  clearTimeout(toastTimer);
  const element = $(".toast");
  element.textContent = message;
  element.classList.add("is-visible");
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3500);
}
const SETUP =
  "git clone https://github.com/janmm97/orchy-ai\ncd orchy-ai\nnpm run setup";
$("#copySetup").addEventListener("click", async () => {
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(SETUP);
    $(".copy-fallback")?.remove();
    $("#copyLabel").textContent = "Copied";
    toast("Three lines copied. Paste them into your terminal.");
    tell("orchy:copied");
  } catch {
    let field = $(".copy-fallback");
    if (!field) {
      field = document.createElement("textarea");
      field.className = "copy-fallback";
      field.readOnly = true;
      field.rows = 4;
      field.setAttribute(
        "aria-label",
        "Setup commands. Copy these selected lines.",
      );
      $("#setupLines").after(field);
    }
    field.value = SETUP;
    field.focus();
    field.select();
    toast("Commands selected. Press Ctrl+C or ⌘C to copy.");
  }
  copyTimer = setTimeout(() => ($("#copyLabel").textContent = "Copy"), 2500);
});

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
