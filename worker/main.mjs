// The landing page's Worker: static files, the launch video, and the live playground's API.
//
// The live playground: a visitor signs in to One (or signs up) through One Connect and grants this app four Gmail
// actions (agent.mjs / gmail.mjs). Orchy then does one small task in their own inbox. Sends only happen through
// POST /api/approve, with a sealed token that names the draft and is bound to the visitor's session.
//
// Nothing is stored server-side: the session (One grant reference, Gmail connection key, the visitor's address,
// runs used) lives in a sealed, HttpOnly cookie (seal.mjs). Secrets: ONE_CLIENT_ID, ONE_CLIENT_SECRET,
// ONE_CONNECT_KEY, ONE_PERMISSION_SET, ANTHROPIC_API_KEY, SESSION_SECRET. Vars: ONE_REDIRECT_URI, MODEL, EFFORT.
import Anthropic from "@anthropic-ai/sdk";
import { createOneConnect } from "@withone/connect/server";
import { runAgent } from "./agent.mjs";
import { gmailFor } from "./gmail.mjs";
import { open, seal } from "./seal.mjs";

const SESSION = "orchy_session";
const SESSION_TTL = 30 * 60;
const APPROVE_TTL = 15 * 60;
export const RUNS_PER_SESSION = 3;
const TASK_CHARS = 300;
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
  if (error instanceof Anthropic.RateLimitError) return "Orchy is busy right now. Try again in a minute.";
  return "Something went wrong on our side. Try again in a moment.";
}

// Until every secret is set, the page keeps its sample-only playground.
const ready = (env) =>
  ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_REDIRECT_URI", "ANTHROPIC_API_KEY", "SESSION_SECRET"].every((k) => env[k]);

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
    if (!(await allowed(env, request))) return redirect("/?playground=busy#how");
    const known = await readSession(env, request);
    const sid = known?.sid || crypto.randomUUID();
    const { redirectUrl, cookie: flow } = connectFor(env, { sid }).startAuthorization({ returnTo: "/" });
    return redirect(redirectUrl, [
      `${flow.name}=${encodeURIComponent(flow.value)}; Path=${flow.options.path}; Max-Age=${flow.options.maxAge}; HttpOnly; Secure; SameSite=Lax`,
      await sessionCookie(env, { sid, runs: known?.runs || 0 }),
    ]);
  }

  if (path === "/api/one/callback" && request.method === "GET") {
    const s = await readSession(env, request);
    if (!s?.sid) return redirect("/?one_connect=error&one_connect_error=expired");
    const state = { sid: s.sid };
    const connect = connectFor(env, state);
    const result = await connect.completeAuthorization({ userId: s.sid, url: request.url, getCookie: (name) => cookies(request)[name] });
    const out = result.clearCookieName ? [cookie(result.clearCookieName, "", 0)] : [];
    if (result.outcome !== "connected" || !state.ref) {
      if (result.message) console.warn("One Connect:", result.outcome, result.code, result.message);
      return redirect(result.redirectUrl, out);
    }
    const gmail = (await connect.listConnections(s.sid)).find((c) => c.platform === "gmail");
    if (!gmail) return redirect("/?playground=no-gmail#how", [...out, clearSession()]);
    const me = await gmailFor((input) => connect.runAction(s.sid, input), gmail.key).address();
    return redirect(result.redirectUrl, [...out, await sessionCookie(env, { sid: s.sid, ref: state.ref, gmailKey: gmail.key, me, runs: s.runs || 0 })]);
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
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        for await (const event of runAgent({ task, me: s.me, client, gmail: gmailOf(env, s), model: env.MODEL || "claude-opus-5-5", effort: env.EFFORT || "low" })) {
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
    return env.ASSETS.fetch(request);
  },
};
