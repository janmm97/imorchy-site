// A stand-in for Cloudflare's API (and One's passthrough to it), loaded with `node --import` by test-deploy-api.mjs
// so deploy.mjs runs end to end with no network. It answers like a zone where imorchy.dev is already on the Worker
// and www. is free, and writes every call it saw to FAKE_CF_LOG when the process exits.
import fs from "node:fs";

const calls = [];
const ok = (result) => new Response(JSON.stringify({ success: true, errors: [], result }), { headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input.url ?? input));
  const method = init.method || "GET";
  const call = { method, url: url.href, headers: Object.fromEntries(new Headers(init.headers)) };
  calls.push(call);
  const p = url.pathname.replace(/^.*\/client\/v4/, "");
  if (method === "GET" && p === "/zones") return ok([{ id: "zone1", account: { id: "acct1" } }]);
  if (method === "GET" && p === "/zones/zone1/dns_records") return ok([]);
  if (method === "GET" && p === "/accounts/acct1/workers/domains") return ok([{ hostname: "imorchy.dev", service: "orchy-site" }]);
  if (method === "POST" && p.endsWith("/assets-upload-session")) {
    const { manifest } = JSON.parse(init.body);
    call.manifest = Object.keys(manifest);
    return ok({ jwt: "session-jwt", buckets: [Object.values(manifest).slice(0, 2).map((m) => m.hash)] });
  }
  if (method === "POST" && p === "/accounts/acct1/workers/assets/upload") return ok({ jwt: "completion-jwt" });
  if (method === "PUT" && p === "/accounts/acct1/workers/scripts/orchy-site") {
    call.metadata = JSON.parse(await init.body.get("metadata").text());
    return ok({ id: "orchy-site" });
  }
  if (method === "PUT" && p === "/accounts/acct1/workers/domains") return ok({ hostname: JSON.parse(init.body).hostname });
  return new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: `fake: no route ${method} ${p}` }] }), { status: 404 });
};

process.on("exit", () => fs.writeFileSync(process.env.FAKE_CF_LOG, JSON.stringify(calls)));
