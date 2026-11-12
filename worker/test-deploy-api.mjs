// Offline checks for how deploy.mjs talks to Cloudflare, run end to end against fake-cloudflare.mjs (no network):
// with CLOUDFLARE_API_TOKEN it calls api.cloudflare.com with that token and nothing from One, except the assets
// upload, which signs with its upload-session JWT; without it, it goes through this folder's One login as before.
// Both modes bind the R2 video bucket and upload no video. Needs esbuild (`npm ci --prefix worker`), which the
// Deploy site workflow installs; without it this file says so and skips. Run by test.mjs (part of `npm test`).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER = fileURLToPath(new URL(".", import.meta.url));
const SITE = path.resolve(WORKER, "..");
const REPO = SITE; // the repo root is the site folder
const ok = (name) => console.log(`ok - ${name}`);

if (!fs.existsSync(path.join(WORKER, "node_modules", "esbuild"))) {
  console.log("skip - deploy.mjs against a fake Cloudflare API: esbuild isn't installed (npm ci --prefix worker)");
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchy-deploy-"));
  try {
    // A home with this folder's One login, and a `one` CLI on PATH that lists one Cloudflare connection.
    const slug = REPO.replace(/[:\\/]/g, "-");
    fs.mkdirSync(path.join(tmp, ".one", "projects", slug), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".one", "projects", slug, "config.json"), JSON.stringify({ apiKey: "one-test-key", whoamiApiBase: "https://api.withone.test/v1" }));
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "one.mjs"), `console.log(JSON.stringify({ connections: [{ platform: "cloudflare", state: "operational", key: "live::cloudflare::test" }] }));`);
    fs.writeFileSync(path.join(bin, "one.cmd"), `@node "%~dp0one.mjs" %*\r\n`);
    fs.writeFileSync(path.join(bin, "one"), `#!/bin/sh\nexec node "$(dirname "$0")/one.mjs" "$@"\n`, { mode: 0o755 });

    const deploy = (args, extra = {}) => {
      const env = { ...process.env, HOME: tmp, USERPROFILE: tmp, FAKE_CF_LOG: path.join(tmp, "calls.json"), ...extra };
      delete env.CLOUDFLARE_API_TOKEN;
      if (extra.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = extra.CLOUDFLARE_API_TOKEN;
      const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
      env[pathKey] = bin + path.delimiter + env[pathKey];
      fs.rmSync(env.FAKE_CF_LOG, { force: true });
      const run = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(WORKER, "fake-cloudflare.mjs")).href, path.join(SITE, "deploy.mjs"), ...args], { env, encoding: "utf8" });
      const calls = fs.existsSync(env.FAKE_CF_LOG) ? JSON.parse(fs.readFileSync(env.FAKE_CF_LOG, "utf8")) : [];
      return { ...run, calls };
    };
    const route = (c) => `${c.method} ${new URL(c.url).pathname.replace(/^.*\/client\/v4/, "")}`;
    const isUpload = (c) => route(c) === "POST /accounts/acct1/workers/assets/upload";
    const R2 = { type: "r2_bucket", name: "MEDIA", bucket_name: "orchy-site-media" };
    const FULL = [
      "GET /zones",
      "GET /zones/zone1/dns_records",
      "GET /accounts/acct1/workers/domains",
      "POST /accounts/acct1/workers/scripts/orchy-site/assets-upload-session",
      "POST /accounts/acct1/workers/assets/upload",
      "PUT /accounts/acct1/workers/scripts/orchy-site",
      "PUT /accounts/acct1/workers/domains",
    ];
    const checkDeploy = (run) => {
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(run.calls.map(route), FULL);
      const session = run.calls.find((c) => c.manifest);
      assert.ok(session.manifest.includes("/index.html") && !session.manifest.some((f) => f.endsWith(".mp4")), "the manifest has the pages and no video");
      const { metadata } = run.calls.find((c) => c.metadata);
      assert.deepEqual(metadata.bindings, [{ type: "assets", name: "ASSETS" }, R2]);
      assert.equal(metadata.assets.jwt, "completion-jwt");
      assert.equal(run.calls.find(isUpload).headers.authorization, "Bearer session-jwt");
    };

    // ── token mode ──
    let run = deploy(["imorchy.dev"], { CLOUDFLARE_API_TOKEN: "cf-test-token" });
    checkDeploy(run);
    assert.match(run.stdout, /Signed in with: CLOUDFLARE_API_TOKEN/);
    for (const c of run.calls) {
      assert.ok(c.url.startsWith("https://api.cloudflare.com/client/v4/"), c.url);
      assert.ok(!Object.keys(c.headers).some((h) => h.startsWith("x-one-")), `${route(c)} sends no x-one-* header`);
      if (!isUpload(c)) assert.equal(c.headers.authorization, "Bearer cf-test-token", route(c));
    }
    ok("token mode: every call goes to api.cloudflare.com with the token as Bearer, none carries x-one-*, the assets upload uses the session JWT");
    ok("both Worker bindings go up (ASSETS and MEDIA → R2 bucket orchy-site-media), no video in the manifest, the new www. host is attached");

    // ── One mode, unchanged ──
    run = deploy(["imorchy.dev"]);
    checkDeploy(run);
    assert.match(run.stdout, /Signed in with: this folder's One login/);
    for (const c of run.calls) {
      assert.ok(c.url.startsWith("https://api.withone.test/v1/passthrough/client/v4/"), c.url);
      assert.equal(c.headers["x-one-secret"], "one-test-key");
      assert.equal(c.headers["x-one-connection-key"], "live::cloudflare::test");
      assert.match(c.headers["x-one-action-id"], /^conn_mod_def::/);
      if (!isUpload(c)) assert.equal(c.headers.authorization, undefined, route(c));
    }
    ok("One mode (no token): One's passthrough with the folder's key, connection and action IDs, as before");

    // ── dry run and the old flag ──
    run = deploy(["imorchy.dev", "--dry-run"], { CLOUDFLARE_API_TOKEN: "cf-test-token" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.calls.map(route), FULL.slice(0, 3));
    assert.match(run.stdout, /Videos: from R2 bucket orchy-site-media/);
    run = deploy(["imorchy.dev", "--file", "assets/video.mp4=x.mp4"], { CLOUDFLARE_API_TOKEN: "cf-test-token" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /--file is gone/);
    assert.equal(run.calls.length, 0);
    ok("--dry-run only reads (zone, DNS, custom domains); --file is refused before any call");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
