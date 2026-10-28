// Deploy the landing page to Cloudflare (Workers static assets on a custom domain) through One.
// It uses this repo folder's own One login (`one init --auth browser --project`, run in the repo root) and that
// login's Cloudflare connection. The CLI can't carry file bodies (they go on the command line), so the calls go
// to One's passthrough API directly, with the same key, connection and action IDs the CLI would send.
//
// The Worker (site/worker/main.mjs: the video, and the live playground's API) is bundled with esbuild from
// site/worker's own packages (`npm install` there first). Its secrets go up only with --secrets <file> (see
// site/worker/.env.example); later deploys keep them.
//
//   node site/deploy.mjs <domain> [--dry-run] [--name orchy-site] [--file assets/video.mp4=<path>] [--no-www]
//                                 [--secrets site/worker/.env] [--model <openrouter model id>]
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = fileURLToPath(new URL(".", import.meta.url));
const REPO = path.resolve(SITE, "..");
const MAX_FILE = 25 * 1024 * 1024; // Workers static assets: 25 MiB per file
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
};
// Only the page's own files go up: never this script, the preview server or the README.
const SKIP = new Set(["deploy.mjs", "serve.mjs", "README.md"]);
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
const domain = args.find((a, i) => !a.startsWith("--") && !["--name", "--file", "--secrets", "--model"].includes(args[i - 1]));
const name = opt("--name") || "orchy-site";
const dryRun = flag("--dry-run");
const hosts = flag("--no-www") ? [domain] : [domain, `www.${domain}`];
const overrides = Object.fromEntries(
  args.flatMap((a, i) => (a === "--file" ? [args[i + 1].split("=")] : [])),
);
if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error("Usage: node site/deploy.mjs <domain> [--dry-run] [--name orchy-site] [--file assets/video.mp4=<path>] [--no-www] [--secrets <file>] [--model <openrouter model id>]");
  process.exit(1);
}
const SECRET_NAMES = ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_PERMISSION_SET", "OPENROUTER_API_KEY", "SESSION_SECRET"];
const secrets = {};
if (opt("--secrets")) {
  for (const line of fs.readFileSync(path.resolve(opt("--secrets")), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] && SECRET_NAMES.includes(m[1])) secrets[m[1]] = m[2];
  }
  if ((secrets.SESSION_SECRET || "").length < 32) {
    console.error("SESSION_SECRET in the secrets file must be at least 32 characters.");
    process.exit(1);
  }
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

function siteFiles(dir = SITE) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(SITE, full).split(path.sep).join("/");
    if (entry.isDirectory()) return rel === "worker" || entry.name === "node_modules" ? [] : siteFiles(full);
    if (SKIP.has(rel) || !TYPES[path.extname(rel)]) return [];
    const source = overrides[rel] ? path.resolve(overrides[rel]) : full;
    const data = fs.readFileSync(source);
    return [{ rel, source, data, type: TYPES[path.extname(rel)] }];
  });
}

const files = siteFiles();
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
console.log(`Secrets: ${opt("--secrets") ? Object.keys(secrets).join(", ") || "none in the file" : "kept as they are"}`);
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

// 2. The Worker. Static files are served straight from assets; only the API and videos run the Worker first.
const vars = { ONE_REDIRECT_URI: `https://${domain}/api/one/callback`, ...(opt("--model") ? { MODEL: opt("--model") } : {}) };
const worker = new FormData();
worker.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        main_module: "main.js",
        compatibility_date: "2026-10-01",
        compatibility_flags: ["nodejs_compat"],
        bindings: [
          { type: "assets", name: "ASSETS" },
          // Per visitor IP: sign-ins and runs, 20 a minute.
          { type: "ratelimit", name: "LIMIT", namespace_id: "1001", simple: { limit: 20, period: 60 } },
          ...Object.entries(vars).map(([k, text]) => ({ type: "plain_text", name: k, text })),
          ...Object.entries(secrets).map(([k, text]) => ({ type: "secret_text", name: k, text })),
        ],
        keep_bindings: ["secret_text"],
        // Workers Logs: the Worker's console lines (codes only, never mail), kept by Cloudflare for a few days.
        observability: { enabled: true, head_sampling_rate: 1 },
        assets: { jwt: completion, config: { run_worker_first: ["/api/*", "/**/*.mp4"] } },
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
