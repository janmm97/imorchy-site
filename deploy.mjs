// Deploy the landing page to Cloudflare (Workers static assets on a custom domain) through One.
// It uses this repo folder's own One login (`one init --auth browser --project`, run in the repo root) and that
// login's Cloudflare connection. The CLI can't carry file bodies (they go on the command line), so the calls go
// to One's passthrough API directly, with the same key, connection and action IDs the CLI would send.
//
// The Worker (site/worker/main.mjs: the video and Google's verification file) is bundled with esbuild from
// site/worker's own packages (`npm install` there first). It has no secrets; a deploy clears any left from the
// old live playground.
//
//   node site/deploy.mjs <domain> [--dry-run] [--name orchy-site] [--file assets/video.mp4=<path>] [--no-www]
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { siteFiles } from "./worker/files.mjs";
import { RUN_WORKER_FIRST } from "./worker/routes.mjs";

const SITE = fileURLToPath(new URL(".", import.meta.url));
const REPO = path.resolve(SITE, "..");
const MAX_FILE = 25 * 1024 * 1024; // Workers static assets: 25 MiB per file
// One action IDs (One's catalogue, not secrets): sent as x-one-action-id, as the CLI does.
const ACTION = {
  zones: "conn_mod_def::GLv3XSu_aec::2hjTeSOLQCC8IlaRTpOJSQ",
  dns: "conn_mod_def::GLv2C8r6EWU::aVXUoivtSp6Kec5jPs-4MA",
  domains: "conn_mod_def::GLv2DuYkYdY::vj-Gyt-lTwOXTjYqSqzS8g",
  session: "conn_mod_def::GLv3K7opzfw::cRlsFKr2RzammzS50gDb-A",
  upload: "conn_mod_def::GLv3LjNCcT4::BaAmQjuUSPu_iQ5q-DaqLA",
  script: "conn_mod_def::GLv3Lj08WtM::3Igqny-ASDelD9hvl10Qeg",
  attach: "conn_mod_def::GLv2DvF5tE8::i2W3-lB5TBGiE3vEJFMrAw",
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const domain = args.find((a, i) => !a.startsWith("--") && !["--name", "--file"].includes(args[i - 1]));
const name = opt("--name") || "orchy-site";
const dryRun = flag("--dry-run");
const hosts = flag("--no-www") ? [domain] : [domain, `www.${domain}`];
const overrides = Object.fromEntries(
  args.flatMap((a, i) => (a === "--file" ? [args[i + 1].split("=")] : [])),
);
if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error("Usage: node site/deploy.mjs <domain> [--dry-run] [--name orchy-site] [--file assets/video.mp4=<path>] [--no-www]");
  process.exit(1);
}

// This folder's One login, never another folder's.
const slug = REPO.replace(/[:\\/]/g, "-");
const configFile = path.join(os.homedir(), ".one", "projects", slug, "config.json");
if (!fs.existsSync(configFile)) {
  console.error(`This folder isn't signed in to One. Run in ${REPO}:\n  one init --auth browser --project`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
const base = (config.whoamiApiBase || "https://api.withone.ai/v1").replace(/\/$/, "");
const list = JSON.parse(execSync("one --agent list", { cwd: REPO, encoding: "utf8" }));
const connection = list.connections?.find((c) => c.platform === "cloudflare" && c.state === "operational");
if (!connection) {
  console.error("No working Cloudflare connection on this folder's One login. Add one with: one add cloudflare");
  process.exit(1);
}

async function cf(action, method, apiPath, { query, json, form, headers = {} } = {}) {
  const url = new URL(`${base}/passthrough/client/v4${apiPath}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      "x-one-secret": config.apiKey,
      "x-one-connection-key": connection.key,
      "x-one-action-id": ACTION[action],
      Accept: "application/json",
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : form,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${apiPath}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  if (!res.ok || body.success === false) {
    const why = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || text.slice(0, 300);
    throw new Error(`${method} ${apiPath}: HTTP ${res.status} ${why}`);
  }
  return body.result;
}

const files = siteFiles(SITE, overrides);
const tooBig = files.filter((f) => f.data.length > MAX_FILE);
if (tooBig.length) {
  for (const f of tooBig) console.error(`${f.rel} is ${(f.data.length / 1048576).toFixed(1)} MB; Cloudflare takes 25 MiB per file. Pass a smaller copy with --file ${f.rel}=<path>.`);
  process.exit(1);
}
const manifest = {};
const byHash = new Map();
for (const f of files) {
  f.hash = createHash("sha256").update(f.data).digest("hex").slice(0, 32);
  manifest[`/${f.rel}`] = { hash: f.hash, size: f.data.length };
  byHash.set(f.hash, f);
}

const [zone] = await cf("zones", "GET", "/zones", { query: { name: domain.split(".").slice(-2).join(".") } });
if (!zone) throw new Error(`${domain} isn't a zone in this Cloudflare account.`);
const account = zone.account.id;
const records = await cf("dns", "GET", `/zones/${zone.id}/dns_records`, { query: { per_page: "500" } });
const attached = await cf("domains", "GET", `/accounts/${account}/workers/domains`);

console.log(`Worker:  ${name}`);
console.log(`Domains: ${hosts.join(", ")}`);
for (const host of hosts) {
  const clash = records.filter((r) => r.name === host);
  const mine = attached.find((d) => d.hostname === host);
  console.log(`  ${host}: ${mine ? `already on Worker ${mine.service}` : clash.length ? `existing record(s) ${clash.map((r) => `${r.type} ${r.content}`).join(", ")}` : "free"}`);
}
console.log(`Files (${files.length}, ${(files.reduce((n, f) => n + f.data.length, 0) / 1048576).toFixed(1)} MB):`);
for (const f of files) console.log(`  /${f.rel}  ${(f.data.length / 1024).toFixed(0)} KB${f.source.startsWith(SITE) ? "" : `  (from ${f.source})`}`);
// The Worker, bundled into one module. node:* stays external: nodejs_compat provides it.
const WORKER = path.join(SITE, "worker");
let esbuild;
try {
  esbuild = await import(pathToFileURL(path.join(WORKER, "node_modules", "esbuild", "lib", "main.js")).href);
} catch {
  console.error(`The Worker's packages aren't installed. Run: npm install --prefix "${WORKER}"`);
  process.exit(1);
}
const built = await esbuild.build({
  entryPoints: [path.join(WORKER, "main.mjs")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["module", "main"],
  external: ["node:*"],
  minify: true,
  write: false,
  logLevel: "warning",
});
const bundle = built.outputFiles[0].text;
console.log(`Worker bundle: ${(bundle.length / 1024).toFixed(0)} KB`);
console.log(`run_worker_first: ${JSON.stringify(RUN_WORKER_FIRST)}`);
if (dryRun) {
  console.log("\nDry run: nothing was uploaded or changed.");
  process.exit(0);
}
const blocked = hosts.filter((h) => records.some((r) => r.name === h) && !attached.some((d) => d.hostname === h));
if (blocked.length) throw new Error(`Not touching existing DNS records on ${blocked.join(", ")}. Remove them first or use --no-www.`);

// 1. Upload session: Cloudflare answers with the hashes it doesn't have yet, in buckets.
const session = await cf("session", "POST", `/accounts/${account}/workers/scripts/${name}/assets-upload-session`, { json: { manifest } });
let completion = session.jwt;
for (const [i, bucket] of (session.buckets || []).entries()) {
  const form = new FormData();
  for (const hash of bucket) {
    const f = byHash.get(hash);
    form.append(hash, new Blob([f.data.toString("base64")], { type: f.type }), hash);
  }
  process.stdout.write(`Uploading bucket ${i + 1}/${session.buckets.length} (${bucket.length} files)… `);
  const result = await cf("upload", "POST", `/accounts/${account}/workers/assets/upload`, {
    query: { base64: "true" },
    form,
    headers: { Authorization: `Bearer ${session.jwt}` },
  });
  if (result?.jwt) completion = result.jwt;
  console.log("done");
}

// 2. The Worker. Pages, videos and Google's verification file run the Worker first; static files are served straight from assets.
const worker = new FormData();
worker.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        main_module: "main.js",
        compatibility_date: "2026-10-01",
        compatibility_flags: ["nodejs_compat"],
        // Only the assets binding: the old playground's secrets, vars and rate limit go with this upload.
        bindings: [{ type: "assets", name: "ASSETS" }],
        // Workers Logs: the Worker's console lines, kept by Cloudflare for a few days.
        observability: { enabled: true, head_sampling_rate: 1 },
        assets: { jwt: completion, config: { run_worker_first: RUN_WORKER_FIRST } },
      }),
    ],
    { type: "application/json" },
  ),
);
worker.append("main.js", new Blob([bundle], { type: "application/javascript+module" }), "main.js");
await cf("script", "PUT", `/accounts/${account}/workers/scripts/${name}`, { form: worker });
console.log(`Worker ${name} deployed.`);

// 3. Custom domains (Cloudflare adds the DNS record and certificate).
for (const host of hosts) {
  if (attached.some((d) => d.hostname === host && d.service === name)) continue;
  await cf("attach", "PUT", `/accounts/${account}/workers/domains`, {
    json: { environment: "production", hostname: host, service: name, zone_id: zone.id },
  });
  console.log(`Attached ${host}.`);
}
console.log(`\nLive: ${hosts.map((h) => `https://${h}`).join("  ")}`);
