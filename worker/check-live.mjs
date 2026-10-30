// After a deploy: is the live site whole? The Deploy site workflow runs this last, so a bad deploy fails the run.
// - https://<domain> answers 200, and https://www.<domain> ends at 200 on https://<domain> (its 301 followed)
// - every page in site/sitemap.xml answers 200, with no redirect
// - a Range request for the launch video answers 206 with Content-Range and video/mp4 (R2 and the Worker are wired)
// Each check is retried for about a minute, while the new version reaches every edge.
//
//   node site/worker/check-live.mjs <domain>
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const domain = process.argv[2];
if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error("Usage: node site/worker/check-live.mjs <domain>");
  process.exit(1);
}
const TRIES = 7;
const WAIT = 10_000;
const UA = { "User-Agent": "orchy-site-deploy-check" };

const sitemap = fs.readFileSync(fileURLToPath(new URL("../sitemap.xml", import.meta.url)), "utf8");
const pages = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
if (!pages.length) {
  console.error("site/sitemap.xml lists no pages.");
  process.exit(1);
}

const checks = [
  {
    name: `https://${domain} answers 200`,
    run: () => fetch(`https://${domain}/`, { headers: UA, redirect: "manual" }),
    pass: (res) => res.status === 200,
  },
  {
    name: `https://www.${domain} ends at 200 on https://${domain}/`,
    run: () => fetch(`https://www.${domain}/`, { headers: UA }),
    pass: (res) => res.status === 200 && new URL(res.url).hostname === domain,
  },
  ...pages.map((url) => ({
    name: `sitemap page ${url} answers 200`,
    run: () => fetch(url, { headers: UA, redirect: "manual" }),
    pass: (res) => res.status === 200,
  })),
  {
    name: `https://${domain}/assets/video.mp4 answers a Range request with 206`,
    run: () => fetch(`https://${domain}/assets/video.mp4`, { headers: { ...UA, Range: "bytes=0-1023" }, redirect: "manual" }),
    pass: (res) => res.status === 206 && /^bytes 0-1023\/\d+$/.test(res.headers.get("Content-Range") || "") && res.headers.get("Content-Type") === "video/mp4",
  },
];

let failed = 0;
for (const check of checks) {
  let last = "";
  for (let i = 1; i <= TRIES; i++) {
    try {
      const res = await check.run();
      await res.arrayBuffer();
      if (check.pass(res)) {
        last = "";
        break;
      }
      last = `HTTP ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}${res.headers.get("content-range") ? `, Content-Range ${res.headers.get("content-range")}` : ""}, Content-Type ${res.headers.get("content-type")}`;
    } catch (e) {
      last = e.message;
    }
    if (i < TRIES) await new Promise((r) => setTimeout(r, WAIT));
  }
  if (last) {
    failed++;
    console.log(`FAIL - ${check.name}: ${last}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Live check failed::${check.name}: ${last}`);
  } else console.log(`ok - ${check.name}`);
}
if (failed) {
  console.error(`\n${failed} of ${checks.length} live checks failed. Roll back: revert the PR that caused it; merging the revert redeploys the previous version.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} live checks passed.`);
