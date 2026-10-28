// The popup's first screen (connect.html): an Orchy card for a moment, then on to One Connect through the Worker.
// The address the visitor typed in the chat comes in the fragment (never sent to a server) and goes on as One's
// sign-in hint in a cookie (outcomes.mjs); the Worker checks it again. The target's fragment survives the
// redirects: One's page opens on Gmail first, dark like this one.
import { passHint } from "./outcomes.mjs";

const params = new URLSearchParams(location.search);
passHint(new URLSearchParams(location.hash.slice(1)).get("hint"));
history.replaceState(null, "", location.pathname + location.search);
const target = "/api/one/authorize?popup=1#one_connector=gmail&one_theme=dark";
document.getElementById("go").href = target;
// The first step is ticked only when the visitor did run a sample.
if (params.get("tried") !== "1") {
  const first = document.querySelector(".connect-steps li");
  first.className = "";
  first.firstElementChild.textContent = "1";
}
// ?preview keeps the card up, to look at it without a Worker.
if (!params.has("preview")) setTimeout(() => location.replace(target), 900);
