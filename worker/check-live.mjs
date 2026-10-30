// After a deploy: is the live site whole? The Deploy site workflow runs this last, so a bad deploy fails the run.
// - https://<domain> answers 200, and https://www.<domain> ends at 200 on https://<domain> (its 301 followed)
// - every page in site/sitemap.xml answers 200, with no redirect
// - a Range request for the launch video answers 206 with Content-Range and video/mp4 (R2 and the Worker are wired).
//   Until index.html enables the "Watch Launch Video" button, the video may not be in R2 yet: then a 404 is only a notice.
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

// The launch video is "Coming soon" while its button is disabled; the page can't open it, so it needn't exist yet.
const button = fs.readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8").match(/<button\b[^>]*\bhero-video\b[^>]*>/)?.[0] || "";
const videoOffered = button && !/\sdisabled[\s>=]/.test(button);

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
    // Not in R2 yet, and the page doesn't offer it: say so, don't fail. Anything else (a 500 from a broken binding) still fails.
    notice: (res) => !videoOffered && res.status === 404 && "the launch video isn't in R2 yet (its button is still Coming soon)",
  },
];

let failed = 0;
for (const check of checks) {
  let last = "";
  for (let i = 1; i <= TRIES; i++) {
    try {
      const res = await check.run();
      await res.arrayBuffer();
      const notice = check.notice?.(res);
      if (check.pass(res) || notice) {
        last = "";
        if (notice) {
          console.log(`notice - ${check.name}: ${notice}`);
          if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Launch video::${notice}`);
          check.noticed = true;
        }
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
  } else if (!check.noticed) console.log(`ok - ${check.name}`);
}
if (failed) {
  console.error(`\n${failed} of ${checks.length} live checks failed. Roll back: revert the PR that caused it; merging the revert redeploys the previous version.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} live checks passed.`);
