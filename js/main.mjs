import { SQUAD, byId, renderSprite } from "./robots.mjs";
import { CHANNEL, OUTCOMES, outcomeOf } from "./outcomes.mjs";
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
  // The first sample run ends with the offer to do it for real, once per visit.
  if (live.available && !live.connected && !connect.offered) {
    connect.offered = true;
    output.append(offerCard());
  }
}
async function startRun(task) {
  setStage("idle");
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
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (connect.stage === "waiting" || chat.busy) return;
  if (!text) {
    input.setCustomValidity(connect.stage === "email" ? "Type your email, or press Skip." : "Type a task or choose an example.");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  if (connect.stage === "email") startConnect(text);
  else if (chat.on) chatRun(text);
  else startRun(routeTask(text));
});
input.addEventListener("input", () => input.setCustomValidity(""));

// ── The live playground: one small task in the visitor's own Gmail, through One (site/worker/). The sample
// demo above stays the default; the live parts show only when the Worker says the playground is on.
const live = { available: false, connected: false, email: "", runsLeft: 0 };
const liveBar = $("#liveBar");
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
function renderLive() {
  liveBar.hidden = !live.connected;
  liveBar.replaceChildren();
  if (live.connected) {
    const off = el("button", { type: "button", className: "live-link", textContent: "Disconnect" });
    off.addEventListener("click", disconnect);
    liveBar.append(
      el("span", { className: "live-dot", ariaHidden: "true" }),
      el("span", { className: "live-who", textContent: live.email || "Gmail connected" }),
      el("span", { textContent: `${live.runsLeft} ${live.runsLeft === 1 ? "request" : "requests"} left` }),
      off,
    );
  }
  input.placeholder = live.connected ? "Ask Orchy about your inbox…" : "Draft this week’s project update…";
  $("#demoBadge").textContent = live.connected ? "LIVE · GMAIL" : "INTERACTIVE DEMO";
  if (output.firstElementChild?.matches(".demo-placeholder, .live-cta")) output.replaceChildren(idleView());
}
// ── Connecting, all from the chat. Orchy offers, takes the address for One right in the task bar, and opens One
// Connect in a small popup (connect.html → One → Google → connected.html), so this page never goes anywhere. The
// popup reports back on a BroadcastChannel; getting focus back re-checks the session in case that never arrives.
// Then the task the visitor had in mind runs straight away: it only reads and drafts, and sending still asks.
// Stages: idle, email (the task bar takes their address), waiting (the popup is open).
const connect = { stage: "idle", offered: false, task: "", hint: "", popup: null, poll: 0 };
const consoleBox = $(".demo-console"),
  taskLabel = $('label[for="task"]'),
  taskButton = $("#taskForm > button");
const STEPS = ["Tried it", "Connect Gmail", "Your first task"];
// Google won't sign in inside these apps' built-in browsers.
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|TikTok|musical_ly|BytedanceWebview|\bLine\/|; wv\)/i;
const button = (label, kind, onClick) => {
  const node = el("button", { type: "button", className: `button button-small ${kind}`, textContent: label });
  node.addEventListener("click", onClick);
  return node;
};
function steps(current) {
  return el(
    "ol",
    { className: "connect-steps", ariaLabel: "Progress" },
    ...STEPS.map((label, i) => {
      const done = i === 0 ? Boolean(lastTask) || live.connected : i < current;
      const item = el("li", { className: done ? "is-done" : i === current ? "is-active" : "" }, el("span", { ariaHidden: "true", textContent: done ? "✓" : String(i + 1) }), label);
      if (i === current && !done) item.ariaCurrent = "step";
      return item;
    }),
  );
}
function connectCard({ step, title, text, actions = [], more = null }) {
  return el(
    "div",
    { className: "connect-card" },
    el("div", { className: "connect-head" }, el("img", { src: "assets/orchy-main.svg", width: 26, height: 26, alt: "" }), el("span", { className: "message-name", textContent: "ORCHY" })),
    el("p", { className: "live-title", textContent: title }),
    text ? el("p", { textContent: text }) : null,
    steps(step),
    actions.length ? el("div", { className: "live-actions" }, ...actions) : null,
    more,
  );
}
function setStage(stage) {
  if (connect.stage === stage) return;
  connect.stage = stage;
  consoleBox.classList.toggle("is-connecting", stage !== "idle");
  consoleBox.classList.toggle("is-waiting", stage === "waiting");
  const email = stage === "email";
  Object.assign(input, { type: email ? "email" : "text", autocomplete: email ? "email" : "off", inputMode: email ? "email" : "text", value: "" });
  if (email) input.placeholder = "you@example.com";
  taskLabel.textContent = email ? "Your email for One" : "Give Orchy a sample task";
  taskButton.ariaLabel = email ? "Continue to One" : "Run sample task";
  input.disabled = taskButton.disabled = stage === "waiting";
  clearInterval(connect.poll);
  if (stage === "waiting") connect.poll = setInterval(checkConnected, 2500);
  if (!email) renderLive();
}
// The task to run once connected: theirs if it's about mail, else the closest live one.
function liveTaskFor(text) {
  const preset = Object.values(TASKS).find((t) => t.text === text);
  if (text && !preset && /\b(e-?mails?|inbox|repl(y|ies)|mail|drafts?|digest|messages?|send)\b/i.test(text)) return text;
  return preset === TASKS.invoice ? LIVE_TASKS[2][1] : LIVE_TASKS[0][1];
}
function offerCard() {
  return connectCard({
    step: 1,
    title: lastTask ? "That was a pretend inbox." : "Your inbox, for real.",
    text: "Want me to do it on yours? About 30 seconds, right here. Nothing sends without your OK.",
    actions: [button("Try it on my Gmail ↗", "button-mint", () => askEmail(true)), button("Keep playing", "button-outline", leaveConnect)],
    more: el(
      "details",
      { className: "connect-more" },
      el("summary", { textContent: "What Orchy can and can’t do" }),
      el(
        "ul",
        {},
        el("li", { textContent: "You sign in to One, or make a free account. One connects your Gmail." }),
        el("li", { textContent: "Orchy can read your mail and save drafts. It sends only when you press Send." }),
        el("li", { textContent: `It runs on ${location.host}, not your computer. Mail it reads goes to Claude, through OpenRouter, to do the task, and nothing is kept after your visit.` }),
        el("li", { textContent: "Three requests per visit. Remove Orchy’s access any time from your One dashboard." }),
      ),
    ),
  });
}
// `carry`: the visitor said yes to doing the sample they just ran on their own inbox, so it runs once connected.
function askEmail(carry = false) {
  ++runId;
  connect.task = carry ? liveTaskFor(lastTask?.text || "") : "";
  setStage("email");
  output.replaceChildren(
    connectCard({
      step: 1,
      title: "Which email should One use?",
      text: "Type it in the box above. Sign in with it, or make a free account. Then One connects your Gmail.",
      actions: [button("Skip, I’ll type it there", "button-outline", () => startConnect("")), button("Cancel", "button-outline", leaveConnect)],
    }),
  );
  input.focus();
}
function leaveConnect() {
  try {
    connect.popup?.close();
  } catch {
    /* already gone */
  }
  connect.popup = null;
  setStage("idle");
  ++runId;
  output.replaceChildren(idleView());
}
// Runs inside the click or submit, so the browser lets the popup open.
function startConnect(hint) {
  if (IN_APP.test(navigator.userAgent)) {
    setStage("idle");
    const copy = button("Copy the link", "button-mint", async () => {
      try {
        await navigator.clipboard.writeText(`${location.origin}/#how`);
        toast("Link copied. Paste it into Safari or Chrome.");
      } catch {
        toast(`Open ${location.host} in Safari or Chrome.`);
      }
    });
    output.replaceChildren(
      connectCard({ step: 1, title: "Google won’t sign in here.", text: `This app’s built-in browser can’t sign in to Google. Open ${location.host} in Safari or Chrome and I’ll be right there.`, actions: [copy] }),
    );
    return;
  }
  connect.hint = hint;
  const query = hint ? `?hint=${encodeURIComponent(hint)}` : "";
  const w = 480,
    h = 720;
  const left = Math.round(screenX + Math.max(outerWidth - w, 0) / 2),
    top = Math.round(screenY + Math.max(outerHeight - h, 0) / 3);
  const card = new URLSearchParams({ ...(hint ? { hint } : {}), ...(lastTask ? { tried: "1" } : {}) });
  connect.popup = window.open(`/connect?${card}`, "orchy-connect", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!connect.popup) {
    // No popup allowed: the same flow in this tab, and the task picks up when the visitor comes back.
    try {
      sessionStorage.setItem("orchy:pending", connect.task);
    } catch {
      /* private mode: they'll pick a task again */
    }
    location.assign(`/api/one/authorize${query}#one_connector=gmail&one_theme=dark`);
    return;
  }
  setStage("waiting");
  ++runId;
  output.replaceChildren(
    connectCard({
      step: 1,
      title: "A One window opened.",
      text: "Sign in or make a free account there, then pick Gmail. I’ll wait right here.",
      actions: [
        button("Show the window", "button-mint", () => (connect.popup && !connect.popup.closed ? connect.popup.focus() : startConnect(connect.hint))),
        button("Cancel", "button-outline", leaveConnect),
      ],
    }),
  );
}
async function refreshSession() {
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    if (res.ok) Object.assign(live, await res.json());
  } catch {
    /* the local preview has no Worker: sample mode only */
  }
}
// How the popup ended. Only a code comes in; the words are the page's own.
async function settle(code) {
  if (connect.stage !== "waiting") return;
  setStage("idle");
  try {
    connect.popup?.close();
  } catch {
    /* already gone, or cut off from this page */
  }
  connect.popup = null;
  if (code === "success") {
    await refreshSession();
    if (!live.connected) code = "failed";
  }
  renderLive();
  if (code === "success") return openChat(connect.task, true);
  ++runId;
  output.replaceChildren(
    connectCard({
      step: 1,
      title: code === "declined" ? "No problem." : "Not connected yet.",
      text: OUTCOMES[code],
      actions: [button("Try again ↗", "button-mint", () => startConnect(connect.hint)), button("Keep playing", "button-outline", leaveConnect)],
    }),
  );
}
try {
  new BroadcastChannel(CHANNEL).addEventListener("message", (e) => {
    const code = e.data?.outcome;
    if (typeof code === "string" && Object.hasOwn(OUTCOMES, code)) settle(code);
  });
} catch {
  /* no BroadcastChannel: the checks below cover it */
}
// Backups for when the popup's message never arrives: getting focus back, and a slow check while the popup is open.
async function checkConnected() {
  if (connect.stage !== "waiting") return;
  await refreshSession();
  if (live.connected) settle("success");
}
addEventListener("focus", checkConnected);
const placeholder = $(".demo-placeholder");
// With the live playground on, the empty output is the way in: one button, and a reminder to clean up after.
const connectButton = el("button", { type: "button", className: "button button-mint", textContent: "Connect Gmail ↗" });
connectButton.addEventListener("click", () => askEmail());
const liveCta = el(
  "div",
  { className: "live-cta" },
  el("p", { className: "live-cta-title", textContent: "Try it out for free" }),
  connectButton,
  el("p", { className: "live-cta-note", textContent: "Make sure to delete it once you’re done." }),
  el("p", { className: "live-cta-fine", textContent: "Remove Orchy’s access in your One dashboard. Nothing is kept after your visit." }),
);
const idleView = () => (live.available && !live.connected ? liveCta : placeholder);
async function disconnect() {
  ++runId;
  await fetch("/api/disconnect", { method: "POST" }).catch(() => {});
  Object.assign(live, { connected: false, email: "", runsLeft: 0 });
  chatMode(false);
  renderLive();
  output.replaceChildren(idleView());
  toast("Disconnected. To remove Orchy’s access too, revoke it in your One dashboard.");
}

// ── The chat: once connected, the playground is a short conversation with Orchy in the visitor's own inbox. It opens
// with a peek at the newest mail (proof the connection is real, and not a task), then takes requests. Each request is
// one run on the Worker, with the chat so far for follow-ups; what Orchy can't do here it turns down as such.
const chat = { on: false, busy: false, history: [] };
const thread = el("div", { className: "chat-thread", role: "log", ariaLabel: "Your chat with Orchy" });
const greeting = $(".console-body > .chat-message");
function chatMode(on) {
  chat.on = on;
  consoleBox.classList.toggle("is-chat", on);
  output.ariaLive = on ? "off" : "polite";
  if (on) output.after(form);
  else {
    greeting.after(form);
    chat.history = [];
  }
  taskLabel.textContent = on ? "Ask Orchy about your inbox" : "Give Orchy a sample task";
  taskButton.ariaLabel = on ? "Send to Orchy" : "Run sample task";
  setBusy(false);
}
// The input stays open for typing while Orchy works; only sending waits. With no requests left, it closes.
function setBusy(busy) {
  chat.busy = busy;
  const spent = chat.on && live.runsLeft <= 0;
  taskButton.disabled = busy || spent;
  input.disabled = spent;
  if (spent) input.placeholder = "That’s all for this visit";
}
const down = () => requestAnimationFrame(() => (thread.scrollTop = thread.scrollHeight));
function orchySays(...children) {
  const body = el("div", { className: "chat-body" }, ...children);
  thread.append(el("div", { className: "chat-turn from-orchy" }, el("img", { src: "assets/orchy-main.svg", width: 26, height: 26, alt: "" }), body));
  down();
  return body;
}
const deniedCard = (text) =>
  el("div", { className: "chat-denied" }, el("p", { className: "chat-denied-title", textContent: "Not something I can do here" }), el("p", { textContent: text }));
// "Alex Doe <alex@example.com>" → "Alex Doe"; a bare address stays as it is.
const senderName = (from) => String(from || "").replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "").trim() || String(from || "Someone");
function when(date) {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const peekList = (emails) =>
  el(
    "ul",
    { className: "chat-peek" },
    ...emails.map((m) =>
      el(
        "li",
        { className: m.unread ? "is-unread" : "" },
        el("b", { textContent: senderName(m.from) }),
        el("span", { textContent: m.subject || "(no subject)" }),
        el("time", { textContent: when(m.date) }),
      ),
    ),
  );
async function openChat(task = "", focus = false) {
  const id = ++runId;
  chatMode(true);
  thread.replaceChildren();
  output.replaceChildren(thread);
  const status = paragraph("run-status is-loading", "Opening your inbox");
  const body = orchySays(el("p", { className: "live-title", textContent: live.email ? `Connected to ${live.email} ✓` : "Gmail connected ✓" }), status);
  if (focus) input.focus({ preventScroll: true });
  const peek = await fetch("/api/peek", { method: "POST" })
    .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }))
    .catch(() => ({ ok: false }));
  if (id !== runId && !chat.on) return;
  status.remove();
  if (peek.ok) body.append(el("p", { textContent: peek.emails?.length ? "I can see your inbox. The newest:" : "I can see your inbox. It’s empty right now." }), peek.emails?.length ? peekList(peek.emails) : null);
  else if (peek.grant) body.append(deniedCard("Your One grant doesn’t let me read your mail, so there’s not much I can do. Disconnect and connect again, and allow reading email."));
  else body.append(el("p", { className: "run-warn", textContent: peek.error || "I couldn’t open your inbox just now. Try a request anyway." }));
  body.append(
    el("p", { textContent: "Ask me to find or summarize mail, draft a reply, or send something. Nothing sends until you press Send." }),
    el("p", { className: "chat-fine", textContent: `${live.runsLeft} ${live.runsLeft === 1 ? "request" : "requests"} this visit. I can’t delete, archive, label or touch other apps here.` }),
  );
  setBusy(false);
  down();
  if (task && live.runsLeft > 0 && id === runId) chatRun(task);
}
async function chatRun(text) {
  if (chat.busy || live.runsLeft <= 0) return;
  const id = ++runId;
  setBusy(true);
  input.value = "";
  highlightStep(0);
  thread.append(el("div", { className: "chat-turn from-you" }, el("p", { textContent: text })));
  const list = el("ol", { className: "run-steps" });
  const status = paragraph("run-status is-loading", "Working on it");
  const body = orchySays(list, status);
  tell("orchy:run", { phase: "start", agent: "blue" });
  let finished = false,
    entry = null;
  // `reply` is what Orchy said, kept for follow-ups; `note` replaces the working line (none: the line goes).
  const finish = ({ reply = "", note = "", ok = true } = {}) => {
    if (finished) return;
    finished = true;
    if (note) {
      status.classList.remove("is-loading");
      status.classList.toggle("is-error", !ok);
      status.textContent = note;
    } else status.remove();
    if (!list.childElementCount) list.remove();
    if (reply) chat.history.push((entry = { task: text, reply }));
    tell("orchy:run", { phase: "done", agent: "blue", ok });
    if (id !== runId) return;
    setBusy(false);
    if (live.runsLeft <= 0)
      orchySays(
        el("p", { textContent: "That’s all the live requests for this visit. Want this every day, on your own computer?" }),
        el("a", { className: "live-link", href: "#install", textContent: "Get Orchy ↗" }),
      );
    down();
    if (!input.disabled) input.focus({ preventScroll: true });
  };
  let res;
  try {
    res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: text, history: chat.history }) });
  } catch {
    return finish({ note: "Couldn’t reach Orchy. Check your connection and try again.", ok: false });
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    if (res.status === 401) {
      Object.assign(live, { connected: false });
      chatMode(false);
      renderLive();
      output.replaceChildren(idleView());
      return toast(error || "Connect your Gmail again.");
    }
    if (res.status === 429 && /live tasks/.test(error || "")) live.runsLeft = 0;
    renderLive();
    return finish({ note: error || "Something went wrong. Try again in a moment.", ok: false });
  }
  live.runsLeft = Math.max(live.runsLeft - 1, 0);
  renderLive();
  highlightStep(1);
  // A draft waiting on Send/Keep: what the visitor picks updates what Orchy remembers of this turn.
  const settleDraft = (summary, what) => {
    if (entry) entry.reply = `${summary || "I drafted it."} (${what})`;
    down();
  };
  const handle = (event) => {
    if (id !== runId) return;
    if (event.type === "step") {
      list.append(el("li", {}, el("span", { ariaHidden: "true", textContent: "✓" }), event.text));
    } else if (event.type === "draft") {
      $(".run-draft", body)?.remove();
      body.insertBefore(
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
      highlightStep(2);
      if (event.summary) body.insertBefore(paragraph("run-summary", event.summary), status);
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
        body.append(paragraph(`run-status${r?.ok ? "" : " is-error"}`, r?.ok ? `Sent to ${answer.to.join(", ")}. It’s in your Sent folder.` : answer?.error || "Couldn’t send it. The draft is still in your Gmail."));
        settleDraft(event.summary, r?.ok ? "The visitor sent it." : "Not sent; it's still a draft.");
      });
      keep.addEventListener("click", () => {
        gate.remove();
        body.append(paragraph("run-status", "Kept as a draft in your Gmail. Nothing was sent."));
        settleDraft(event.summary, "Kept as a draft; not sent.");
      });
      gate.append(el("div", {}, send, keep));
      body.insertBefore(gate, status);
      finish({ reply: `${event.summary || "I drafted it."} (Draft “${event.subject}” to ${event.to.join(", ")}, waiting for the visitor to press Send.)` });
    } else if (event.type === "denied") {
      body.insertBefore(deniedCard(event.text), status);
      finish({ reply: event.text, ok: false });
    } else if (event.type === "done") {
      highlightStep(2);
      if (event.summary) body.insertBefore(paragraph("run-summary", event.summary), status);
      finish({ reply: event.summary || "Done." });
    } else if (event.type === "error") {
      finish({ note: event.message, ok: false });
    }
    down();
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
    if (id === runId) finish({ note: "The connection dropped. Try again.", ok: false });
  }
  if (id === runId) finish({ note: "Orchy stopped early. Try again.", ok: false });
}
// Back from One's sign-in in this same tab (no popup was allowed): open the chat, or say how it went, then tidy the
// address bar. Already connected (a reload): straight back to the chat.
async function initLive() {
  const back = outcomeOf(location.search);
  let pending = "";
  try {
    pending = sessionStorage.getItem("orchy:pending") || "";
    sessionStorage.removeItem("orchy:pending");
  } catch {
    /* private mode */
  }
  await refreshSession();
  renderLive();
  if (back) {
    history.replaceState(null, "", location.pathname + "#how");
    $("#how")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
    if (back !== "success" || !live.connected) toast(OUTCOMES[back]);
  }
  if (live.connected) openChat(back === "success" ? pending : "", back === "success");
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
