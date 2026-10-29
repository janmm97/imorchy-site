// The landing page's Worker: static files, the launch video, and the live playground's API.
//
// The live playground: a visitor signs in to One (or signs up) through One Connect and grants this app four Gmail
// actions (agent.mjs / gmail.mjs). The playground then turns into a short chat with Orchy in their own inbox: a peek
// at the newest mail first (POST /api/peek, which isn't a task), then a few requests. The page opens the flow in a
// popup (?popup=1), with the address typed in the chat as One's sign-in hint (an orchy_hint cookie, so it's never in
// a logged URL; flow.mjs checks it). Sends only happen through
// POST /api/approve, with a sealed token that names the draft and is bound to the visitor's session.
//
// Nothing is stored server-side: the session (One grant reference, Gmail connection key, the visitor's address,
// runs used) lives in a sealed, HttpOnly cookie (seal.mjs). Secrets: ONE_CLIENT_ID, ONE_CLIENT_SECRET,
// ONE_CONNECT_KEY, ONE_PERMISSION_SET, OPENROUTER_API_KEY, SESSION_SECRET. Vars: ONE_REDIRECT_URI, MODEL (an OpenRouter model ID).
import { createOneConnect } from "@withone/connect/server";
import { historyOf, runAgent } from "./agent.mjs";
import { addressOf, grantGaps, loginHint, returnPath } from "./flow.mjs";
import { ACTIONS, gmailFor } from "./gmail.mjs";
import { DEFAULT_MODEL, openrouter } from "./openrouter.mjs";
import { open, seal } from "./seal.mjs";

const SESSION = "orchy_session";
const HINT = "orchy_hint";
const SESSION_TTL = 30 * 60;
const APPROVE_TTL = 15 * 60;
export const RUNS_PER_SESSION = 3;
const TASK_CHARS = 300;
const PEEK = 3;
const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const redirect = (location, cookies = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
};
function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

const readSession = (env, request) => open(env.SESSION_SECRET, "session", cookies(request)[SESSION]);
const sessionCookie = async (env, session) => cookie(SESSION, await seal(env.SESSION_SECRET, "session", session, SESSION_TTL), SESSION_TTL);
const clearSession = () => cookie(SESSION, "", 0);

/** A One Connect client whose user store is this request's sealed session. */
function connectFor(env, state) {
  return createOneConnect({
    clientId: env.ONE_CLIENT_ID,
    clientSecret: env.ONE_CLIENT_SECRET,
    connectKey: env.ONE_CONNECT_KEY,
    redirectUri: env.ONE_REDIRECT_URI,
    permissionSet: env.ONE_PERMISSION_SET || undefined,
    returnTo: "/",
    userStore: {
      saveUser: async (id, reference) => {
        if (id === state.sid) state.ref = reference;
      },
      loadUser: async (id) => (id === state.sid ? (state.ref ?? null) : null),
      clearUser: async (id) => {
        if (id === state.sid) state.ref = null;
      },
    },
  });
}
// What the visitor's grant reaches, against the four actions the playground calls: IDs and names only.
const logGrant = (where, gmail) => {
  const { policy, missing } = grantGaps(gmail, ACTIONS);
  console.log(`${where}: grant ${policy}; missing ${missing.join(",") || "nothing"}`);
};
const gmailOf = (env, session) => {
  const connect = connectFor(env, { sid: session.sid, ref: session.ref });
  return gmailFor((input) => connect.runAction(session.sid, input), session.gmailKey);
};

async function allowed(env, request) {
  if (!env.LIMIT) return true;
  const { success } = await env.LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
  return success;
}
// Changes only from this page: the cookie is SameSite=Lax already; this also refuses other origins outright.
const sameOrigin = (request, url) => request.headers.get("Origin") === url.origin;

function friendly(error) {
  if (error?.code === "reconnect_required") return "Your One connection was revoked. Connect again to keep going.";
  if (error?.grant) return "That needs more than you granted Orchy.";
  if (error?.status === 429) return "Orchy is busy right now. Try again in a minute.";
  if (error?.status === 402) return "The live playground is out of credit for now. Try again later.";
  return "Something went wrong on our side. Try again in a moment.";
}

// Until every secret is set, the page keeps its sample-only playground.
const ready = (env) =>
  ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_REDIRECT_URI", "OPENROUTER_API_KEY", "SESSION_SECRET"].every((k) => env[k]);

async function api(request, env, url, ctx) {
  const path = url.pathname;
  if (!ready(env)) return path === "/api/session" ? json({ available: false }) : json({ error: "The live playground isn't on yet." }, 503);

  if (path === "/api/session" && request.method === "GET") {
    const s = await readSession(env, request);
    return json(
      s?.ref
        ? { available: true, connected: true, email: s.me, runsLeft: Math.max(RUNS_PER_SESSION - s.runs, 0) }
        : { available: true, connected: false },
    );
  }

  if (path === "/api/one/authorize" && request.method === "GET") {
    const popup = url.searchParams.get("popup") === "1";
    if (!(await allowed(env, request))) return redirect(returnPath(popup, "playground=busy"));
    const known = await readSession(env, request);
    const sid = known?.sid || crypto.randomUUID();
    const { redirectUrl, cookie: flow } = connectFor(env, { sid }).startAuthorization({
      returnTo: popup ? "/connected" : "/",
      loginHint: loginHint(cookies(request).orchy_hint),
    });
    return redirect(redirectUrl, [
      `${HINT}=; Path=/api/one; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      `${flow.name}=${encodeURIComponent(flow.value)}; Path=${flow.options.path}; Max-Age=${flow.options.maxAge}; HttpOnly; Secure; SameSite=Lax`,
      await sessionCookie(env, { sid, runs: known?.runs || 0, popup }),
    ]);
  }

  if (path === "/api/one/callback" && request.method === "GET") {
    const s = await readSession(env, request);
    // With no session there's no telling whether this is the popup; /connected reads fine either way.
    if (!s?.sid) return redirect(returnPath(true, "one_connect=error&one_connect_error=expired"));
    const state = { sid: s.sid };
    const connect = connectFor(env, state);
    const result = await connect.completeAuthorization({ userId: s.sid, url: request.url, getCookie: (name) => cookies(request)[name] });
    const out = result.clearCookieName ? [cookie(result.clearCookieName, "", 0)] : [];
    // Logged as codes only: never the visitor's address or mail.
    console.log("callback:", result.outcome, result.code || "", state.ref ? "grant saved" : "no grant", s.popup ? "popup" : "tab");
    if (result.outcome !== "connected" || !state.ref) {
      if (result.message) console.warn("One Connect:", result.outcome, result.code, result.message);
      return redirect(result.redirectUrl, out);
    }
    // From here on, a failure lands on the page's own "not connected" card, never on a bare error.
    try {
      const gmail = (await connect.listConnections(s.sid)).find((c) => c.platform === "gmail");
      console.log("callback: connections", gmail ? "gmail found" : "no gmail");
      if (gmail) logGrant("callback", gmail);
      if (!gmail) return redirect(returnPath(s.popup, "playground=no-gmail"), [...out, clearSession()]);
      // The address only names the visitor to the agent; without it, every recipient is flagged before a send.
      const me = await gmailFor((input) => connect.runAction(s.sid, input), gmail.key)
        .address()
        .catch((error) => {
          console.warn("Gmail profile refused, using the connection's name:", error.grant ? "outside the grant" : error.status);
          return addressOf(gmail);
        });
      return redirect(result.redirectUrl, [...out, await sessionCookie(env, { sid: s.sid, ref: state.ref, gmailKey: gmail.key, me, runs: s.runs || 0 })]);
    } catch (error) {
      console.error("after One Connect:", error);
      return redirect(returnPath(s.popup, "one_connect=error&one_connect_error=failed"), [...out, await sessionCookie(env, { sid: s.sid, runs: s.runs || 0, popup: s.popup })]);
    }
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  if (!sameOrigin(request, url)) return json({ error: "Forbidden" }, 403);

  const s = await readSession(env, request);
  // Forgets the grant reference and address; the visitor revokes the grant itself in their One dashboard.
  // The run count stays, so disconnecting doesn't buy more live tasks.
  if (path === "/api/disconnect")
    return json({ ok: true }, 200, { "Set-Cookie": s?.sid ? await sessionCookie(env, { sid: s.sid, runs: s.runs || 0 }) : clearSession() });

  if (!s?.ref) return json({ error: "Connect your Gmail first." }, 401);
  const body = await request.json().catch(() => ({}));

  if (path === "/api/run") {
    if (!(await allowed(env, request))) return json({ error: "Too many tries from here. Give it a minute." }, 429);
    if (s.runs >= RUNS_PER_SESSION) return json({ error: `That's all ${RUNS_PER_SESSION} live tasks for this visit. Install Orchy to keep going.` }, 429);
    const task = String(body.task || "").trim().slice(0, TASK_CHARS);
    if (!task) return json({ error: "Type a task first." }, 400);
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const send = (event) => writer.write(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
    const run = (async () => {
      try {
        const chat = openrouter(env.OPENROUTER_API_KEY, { site: url.origin });
        const history = historyOf(body.history);
        for await (const event of runAgent({ task, me: s.me || "unknown", chat, gmail: gmailOf(env, s), model: env.MODEL || DEFAULT_MODEL, history })) {
          if (event.type === "denied" || event.type === "error") console.log("run:", event.type, event.grant ? "outside the grant" : "");
          if (event.type === "gate") {
            const { draftId, ...shown } = event;
            await send({ ...shown, token: await seal(env.SESSION_SECRET, "approve", { sid: s.sid, draftId, to: event.to }, APPROVE_TTL) });
          } else if (event.type === "draft") {
            const { draftId, ...shown } = event;
            await send(shown);
          } else await send(event);
        }
      } catch (error) {
        console.error("run failed:", error);
        await send({ type: "error", message: friendly(error) });
      } finally {
        await writer.close();
      }
    })();
    ctx.waitUntil(run);
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "Set-Cookie": await sessionCookie(env, { ...s, runs: s.runs + 1 }),
      },
    });
  }

  // Proof the connection works, right after connecting: the newest few messages, headers only. Not a task.
  if (path === "/api/peek") {
    if (!(await allowed(env, request))) return json({ error: "Too many tries from here. Give it a minute." }, 429);
    try {
      const found = await gmailOf(env, s).search("in:inbox", PEEK);
      return json({ emails: found.map(({ from, subject, date, unread }) => ({ from, subject, date, unread })) });
    } catch (error) {
      console.log("peek failed:", error.grant ? "outside the grant" : error.status || error.message);
      if (error.grant) {
        const gmail = (await connectFor(env, { sid: s.sid, ref: s.ref }).listConnections(s.sid).catch(() => [])).find((c) => c.key === s.gmailKey);
        if (gmail) logGrant("peek", gmail);
      }
      return json({ error: friendly(error), grant: Boolean(error.grant) }, error.grant ? 403 : 502);
    }
  }

  if (path === "/api/approve") {
    const approval = await open(env.SESSION_SECRET, "approve", body.token);
    if (!approval || approval.sid !== s.sid) return json({ error: "This approval expired. Run the task again." }, 400);
    try {
      await gmailOf(env, s).sendDraft(approval.draftId);
    } catch (error) {
      if (error.status === 404) return json({ error: "That draft was already sent or deleted." }, 409);
      console.error("send failed:", error);
      return json({ error: friendly(error) }, 502);
    }
    return json({ ok: true, to: approval.to });
  }

  return json({ error: "Not found" }, 404);
}

/** Static assets ignore Range, and Safari won't play an mp4 without it: videos go through the edge cache, which answers Range with 206. */
async function video(request, env, url) {
  const cache = caches.default,
    key = url.origin + url.pathname;
  const hit = await cache.match(request);
  if (hit) return hit;
  const full = await env.ASSETS.fetch(key);
  if (!full.ok) return full;
  const stored = new Response(full.body, full);
  stored.headers.set("Cache-Control", "public, max-age=86400");
  stored.headers.set("Accept-Ranges", "bytes");
  await cache.put(key, stored);
  return (await cache.match(request)) || env.ASSETS.fetch(key);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url, ctx);
      } catch (error) {
        console.error(error);
        return json({ error: friendly(error) }, 500);
      }
    }
    if (url.pathname.endsWith(".mp4") && request.method === "GET") return video(request, env, url);
    // Google Search Console's verification file must answer 200 at its .html path; static assets would redirect it to the bare name.
    if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) return env.ASSETS.fetch(url.origin + url.pathname.slice(0, -5));
    return env.ASSETS.fetch(request);
  },
};
