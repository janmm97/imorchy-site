// The popup's first screen (connect.html): an Orchy card for a moment, then on to One Connect through the Worker.
// The address the visitor typed in the chat rides along as One's sign-in hint; the Worker checks it again.
// The fragment survives the redirects: One's page opens on Gmail first, dark like this one.
const params = new URLSearchParams(location.search);
const hint = params.get("hint");
const target = `/api/one/authorize?popup=1${hint ? `&hint=${encodeURIComponent(hint)}` : ""}#one_connector=gmail&one_theme=dark`;
document.getElementById("go").href = target;
// The first step is ticked only when the visitor did run a sample.
if (params.get("tried") !== "1") {
  const first = document.querySelector(".connect-steps li");
  first.className = "";
  first.firstElementChild.textContent = "1";
}
// ?preview keeps the card up, to look at it without a Worker.
if (!params.has("preview")) setTimeout(() => location.replace(target), 900);
