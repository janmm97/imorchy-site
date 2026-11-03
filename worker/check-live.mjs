// After a deploy: is the live site whole? The Deploy site workflow runs this last, so a bad deploy fails the run.
// - every page in the URL regression list (urls.mjs) that has shipped answers 200 with no redirect, its type, its
//   raw-HTML markers and the security headers of its profile (headers.mjs). test-urls.mjs makes sure every page in
//   site/sitemap.xml is on that list, so this covers the sitemap too.
// - the 301s end at 200 on https://<domain>, and https://www.<domain> takes exactly one hop. (http:// may get an extra hop from Cloudflare's own https
//   redirect before the Worker, so only its end is checked live; test-urls.mjs checks the Worker's one hop offline.)
// - a Range request for the launch video answers 206 with Content-Range and video/mp4 (R2 and the Worker are wired).
//   Until index.html enables the "Watch Launch Video" button, the video may not be in R2 yet: then a 404 is only a notice.
// - the live sitemap: every <loc> answers 200 itself, no Location, with its own URL as the canonical. On another
//   domain (a staging copy) each <loc> is fetched there and must still name its https://imorchy.dev URL as canonical.
// - /approvals/, /approvals.html and /index.html take one hop (301/307/308) to the clean URL, which answers 200.
// - an unknown path answers 404 (not a redirect) with HSTS, nosniff and Referrer-Policy.
// - robots.txt shuts out no search or AI-search crawler, and OAI-SearchBot and PerplexityBot get / with its h1.
// Each check is retried for about a minute, while the new version reaches every edge.
//
//   node site/worker/check-live.mjs <domain>
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build, canonicals } from "../build.mjs";
import { CSP } from "./headers.mjs";
import { BOT_UAS, EXPECT_HEADERS, HOP_STATUS, ONE_HOP, PAGES as LISTED, REDIRECTS, headerProblems, liveUrl, locProblem, robotsProblems } from "./urls.mjs";

// The hand-written rows plus a row for every page build.mjs generates from site/content.
const PAGES = [...LISTED, ...build(fileURLToPath(new URL("..", import.meta.url))).pages];

const domain = process.argv[2];
if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
  console.error("Usage: node site/worker/check-live.mjs <domain>");
  process.exit(1);
}
const TRIES = 7;
const WAIT = 10_000;
const UA = { "User-Agent": "orchy-site-deploy-check" };

// The launch video is "Coming soon" while its button is disabled; the page can't open it, so it needn't exist yet.
const button = fs.readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8").match(/<button\b[^>]*\bhero-video\b[^>]*>/)?.[0] || "";
const videoOffered = button && !/\sdisabled[\s>=]/.test(button);

const checks = [
  ...PAGES.filter((page) => !page.ships).map((page) => {
    let problems = [];
    return {
      name: `https://${domain}${page.path} answers 200 with its type, markers and security headers`,
      run: () => fetch(`https://${domain}${page.path}`, { headers: UA, redirect: "manual" }),
      pass: async (res) => {
        const body = await res.text();
        problems = [...headerProblems(res.headers, page, CSP), ...page.markers.filter((m) => !body.includes(m)).map((m) => `missing ${JSON.stringify(m)}`)];
        return res.status === 200 && !problems.length;
      },
      why: () => problems.join("; "),
    };
  }),
  ...REDIRECTS.map(({ from, to }) => {
    [from, to] = [from, to].map((u) => u.replace("imorchy.dev", domain));
    const oneHop = from.startsWith("https:");
    return {
      name: oneHop ? `${from} answers 301 to ${to}` : `${from} ends at 200 on ${to}`,
      run: () => fetch(from, { headers: UA, redirect: oneHop ? "manual" : "follow" }),
      pass: (res) => (oneHop ? res.status === 301 && res.headers.get("location") === to : res.status === 200 && res.url === to),
    };
  }),
  {
    name: `https://${domain}/assets/video.mp4 answers a Range request with 206`,
    run: () => fetch(`https://${domain}/assets/video.mp4`, { headers: { ...UA, Range: "bytes=0-1023" }, redirect: "manual" }),
    pass: (res) => res.status === 206 && /^bytes 0-1023\/\d+$/.test(res.headers.get("Content-Range") || "") && res.headers.get("Content-Type") === "video/mp4",
    // Not in R2 yet, and the page doesn't offer it: say so, don't fail. Anything else (a 500 from a broken binding) still fails.
    notice: (res) => !videoOffered && res.status === 404 && "the launch video isn't in R2 yet (its button is still Coming soon)",
  },
  ...ONE_HOP.map(({ from, to }) => {
    const target = `https://${domain}${to}`;
    let problem = "";
    return {
      name: `https://${domain}${from} takes one hop (${HOP_STATUS.join("/")}) to ${target}, which answers 200`,
      run: () => fetch(`https://${domain}${from}`, { headers: UA, redirect: "manual" }),
      pass: async (res) => {
        const loc = res.headers.get("location") && new URL(res.headers.get("location"), `https://${domain}${from}`).href;
        if (!HOP_STATUS.includes(res.status) || loc !== target) return !(problem = `want a hop to ${target}`);
        const next = await fetch(target, { headers: UA, redirect: "manual" });
        await next.arrayBuffer();
        problem = next.status === 200 && !next.headers.get("location") ? "" : `${target} answers ${next.status} (a second hop)`;
        return !problem;
      },
      why: () => problem,
    };
  }),
  (() => {
    let problems = [];
    return {
      name: `https://${domain}/no-such-page-… answers 404 with HSTS, nosniff and Referrer-Policy, not a redirect`,
      run: () => fetch(`https://${domain}/no-such-page-${Math.random().toString(36).slice(2, 10)}`, { headers: UA, redirect: "manual" }),
      pass: (res) => {
        problems = Object.entries(EXPECT_HEADERS.all).filter(([name, value]) => res.headers.get(name) !== value).map(([name]) => `missing ${name}`);
        return res.status === 404 && !res.headers.get("location") && !problems.length;
      },
      why: () => problems.join("; "),
    };
  })(),
  (() => {
    let problems = [];
    return {
      name: `https://${domain}/robots.txt shuts out no search or AI-search crawler`,
      run: () => fetch(`https://${domain}/robots.txt`, { headers: UA, redirect: "manual" }),
      pass: async (res) => res.status === 200 && !(problems = robotsProblems(await res.text())).length,
      why: () => problems.join("; "),
    };
  })(),
  ...Object.entries(BOT_UAS).map(([bot, ua]) => ({
    name: `${bot} gets https://${domain}/ with 200 and its h1`,
    run: () => fetch(`https://${domain}/`, { headers: { "User-Agent": ua }, redirect: "manual" }),
    pass: async (res) => res.status === 200 && (await res.text()).includes('<h1 id="heroTitle"'),
    why: () => "a challenge or a different page? bring it to the reviewer, don't turn the check off",
  })),
  (() => {
    let problems = [];
    return {
      name: `HEAD on every shipped page answers 200 with no redirect`,
      run: () => fetch(`https://${domain}/`, { method: "HEAD", headers: UA, redirect: "manual" }),
      pass: async (res) => {
        problems = [];
        for (const page of PAGES.filter((p) => !p.ships && p.type === "text/html")) {
          const r = page.path === "/" ? res : await fetch(`https://${domain}${page.path}`, { method: "HEAD", headers: UA, redirect: "manual" });
          if (r.status !== 200 || r.headers.get("location")) problems.push(`${page.path}: HTTP ${r.status}`);
        }
        return !problems.length;
      },
      why: () => problems.join("; "),
    };
  })(),
  (() => {
    let problems = [];
    return {
      name: `every <loc> in the live https://${domain}/sitemap.xml answers 200 itself, with its imorchy.dev URL as the canonical`,
      run: () => fetch(`https://${domain}/sitemap.xml`, { headers: UA, redirect: "manual" }),
      pass: async (res) => {
        // The sitemap names https://imorchy.dev; on another domain (a staging zone) each <loc> is read on that domain,
        // and its canonical must still be the imorchy.dev loc.
        const locs = [...(await res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
        problems = locs.length ? [] : ["no <loc>"];
        for (const loc of locs) {
          const url = liveUrl(loc, domain);
          if (!url.startsWith(`https://${domain}/`)) {
            problems.push(`${loc} isn't on https://${domain}`);
            continue;
          }
          const r = await fetch(url, { headers: UA, redirect: "manual" });
          const problem = locProblem(loc, { status: r.status, location: r.headers.get("location"), canon: canonicals(await r.text()) });
          if (problem) problems.push(problem);
        }
        return res.status === 200 && !problems.length;
      },
      why: () => problems.join("; "),
    };
  })(),
];

let failed = 0;
for (const check of checks) {
  let last = "";
  for (let i = 1; i <= TRIES; i++) {
    try {
      const res = await check.run();
      const passed = await check.pass(res);
      if (!res.bodyUsed) await res.arrayBuffer();
      const notice = check.notice?.(res);
      if (passed || notice) {
        last = "";
        if (notice) {
          console.log(`notice - ${check.name}: ${notice}`);
          if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Launch video::${notice}`);
          check.noticed = true;
        }
        break;
      }
      last = `HTTP ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}${res.headers.get("content-range") ? `, Content-Range ${res.headers.get("content-range")}` : ""}, Content-Type ${res.headers.get("content-type")}${check.why?.(res) ? `, ${check.why(res)}` : ""}`;
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
