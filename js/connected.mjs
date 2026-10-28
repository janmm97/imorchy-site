// The popup's last screen (connected.html): One Connect, or the Worker, sends the popup here with the outcome.
// It tells the page on a same-origin channel, then closes. The page doesn't rely on window.opener: Google's and
// One's pages can cut the popup off from it. If the browser won't close the window, the card says what to do.
import { CHANNEL, OUTCOMES, outcomeOf } from "./outcomes.mjs";

const code = outcomeOf(location.search);
const ok = code === "success";
const $ = (id) => document.getElementById(id);
document.body.classList.toggle("is-error", Boolean(code) && !ok);
$("mark").textContent = ok ? "✓" : "!";
$("popupTitle").textContent = ok ? "Connected" : code ? "Not connected" : "Nothing to do here";
$("message").textContent = ok
  ? "Heading back to Orchy. Your first task starts there."
  : code
    ? `${OUTCOMES[code]} Head back to Orchy to try again.`
    : "This window is for connecting Gmail to Orchy’s playground.";
history.replaceState(null, "", location.pathname);

if (code) {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ outcome: code });
    channel.close();
  } catch {
    /* no BroadcastChannel: the page checks the session when it gets focus back */
  }
}
const actions = $("actions");
$("close").addEventListener("click", () => window.close());
// A tab the visitor opened themselves won't close from script: offer the way back instead.
setTimeout(
  () => {
    if (code) window.close();
    setTimeout(() => (actions.hidden = false), 300);
  },
  ok ? 700 : 2600,
);
