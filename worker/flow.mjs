// Where a connect attempt comes back to. The playground opens One Connect in a small popup so the visitor never
// leaves the page: a popup flow returns to /connected (site/connected.html), which tells the page how it went and
// closes itself. Without a popup (blocked, or a phone that opens a tab), the flow returns to the page as before.

/** The path for an outcome, as a query string: `/connected?…` in a popup, `/?…#how` otherwise. */
export const returnPath = (popup, query) => (popup ? `/connected?${query}` : `/?${query}#how`);

/** The visitor's address from their Gmail connection's name or title, for when the profile call is refused. "" if neither has one. */
export function addressOf(connection) {
  for (const value of [connection?.name, connection?.title]) {
    const found = /[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[a-z]{2,}/i.exec(String(value || ""))?.[0];
    if (found) return found.toLowerCase();
  }
  return "";
}

/**
 * What a connection's grant reaches, against the actions the playground calls (`{ name: { actionId, method } }`):
 * `{ policy, missing }`, `missing` naming the ones it leaves out. For the logs: action IDs and names only.
 */
export function grantGaps(connection, actions) {
  const access = connection?.access || {};
  const names = Object.keys(actions);
  if (access.policy === "full") return { policy: "full", missing: [] };
  if (access.policy === "methods") {
    const methods = (access.methods || []).map((m) => String(m).toUpperCase());
    return { policy: `methods ${methods.join(",")}`, missing: names.filter((n) => !methods.includes(actions[n].method)) };
  }
  if (access.policy === "actions") {
    const ids = new Set((access.actions || []).map((a) => a.actionId));
    return { policy: `actions ${[...ids].join(",")}`, missing: names.filter((n) => !ids.has(actions[n].actionId)) };
  }
  return { policy: String(access.policy || "unknown"), missing: names };
}

/** An address the visitor typed in the chat, to pre-fill One's sign-in. Anything that isn't plainly one is dropped. */
export function loginHint(value) {
  const hint = String(value || "").trim();
  return hint.length <= 254 && /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>".]{2,}$/.test(hint) ? hint : undefined;
}
