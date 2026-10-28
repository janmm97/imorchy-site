// How a One Connect attempt ended, shared by the page and the popup's last screen (connected.html).
// One Connect returns ?one_connect=success, or =error with ?one_connect_error=declined|expired|failed;
// the Worker's own outcomes come as ?playground=…. Only these codes are ever shown, never text from the URL.
export const OUTCOMES = {
  success: "Connected. Pick a live task or type your own.",
  declined: "No problem. Nothing was connected.",
  expired: "That took a while, so the sign-in expired. Try connecting again.",
  failed: "That didn’t work. Try connecting again.",
  "no-gmail": "That One account has no Gmail connected. Connect Gmail in One, then try again.",
  busy: "Lots of people trying this right now. Give it a minute.",
};
/** The outcome code in a query string, or null when there isn't one. Unknown codes read as "failed". */
export function outcomeOf(search) {
  const params = new URLSearchParams(search);
  const status = params.get("one_connect");
  const code = status === "error" ? params.get("one_connect_error") || "failed" : status || params.get("playground");
  if (!code) return null;
  return Object.hasOwn(OUTCOMES, code) ? code : "failed";
}
// The popup reports back on this channel: same origin only, and it carries nothing but the code.
export const CHANNEL = "orchy-connect";
