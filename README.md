# Orchy landing page

A standalone landing page built with HTML, CSS, and native JavaScript modules. The hand-written pages need no build step; `build.mjs` generates the sitemap (and, once there's content, the blog and changelog pages and `feed.xml`) from `content/`, and its output is committed. The 3D squad loads Three.js 0.169.0 from jsDelivr; everything else is in this folder.

## Preview

From the repository root:

```sh
node serve.mjs
```

Open http://127.0.0.1:4173. Stop with Ctrl+C. The preview serves only this folder and listens on loopback; it does not start or connect to the Orchy dashboard. An optional port can be passed as the first argument.

## The page

Four sections: the hero (the "Orchy AI" wordmark centred on screen with the squad standing on it, a two-line tagline, a "Join the early-access list" button, the launch-video button marked "Coming soon", and the line "Orchy AI is in early access."), How it works (the in-action loop), Your rules (approvals, separate workspaces, local-first, harnesses and apps), and Get access (the early-access list, plus "Book 30 minutes" on Calendly).

## The living squad

Orchy and his nine teammates are real 3D characters built from the supplied art in `assets/`. The page reads each SVG's embedded render and luminance mask, cuts every character out, traces its silhouette, and extrudes it into a bevelled solid with the original art on its front. Nothing is redrawn.

- **Entrance.** Orchy drops onto the wordmark. One by one, each teammate rises behind him, peeks over his left or right shoulder, looks around, crouches and jumps out into a two-row formation, each standing on the letter beneath it. Pink lands on his head. Afterwards a back-row teammate sometimes sneaks back for another peek, pairs swap sides, and the front row takes turns on his head.
- **They move around the page.** One transparent WebGL layer sits over the page, measured in CSS pixels, so characters stand on real cards and ride along as you scroll. When a new section reaches the middle of the screen they hop there in arcs; long trips break into several hops. Characters a section doesn't need peek in from the screen edges now and then.
- **Grab, toss, click.** Drag any character and it swings on a spring; let go and it flies with your throw, bounces off the screen edges and lands on whatever card it hits (any element with `data-perch`), then hops home. Click one to hear from it. They all turn toward your pointer, squash when you scroll fast, and breathe, glance and hop while idle.
- **They react to the page.** In How it works, Orchy stands beside the lit step and hops down as the demo moves through them; the routed teammate stands in the console beside its checklist, then hops onto the approval card and waits there, glowing. Inbox waits on the sample approval card. Workspace teammates get turned back from each other's rooms. Orchy stands inside his localhost window. In Get access, the squad lines up on the booking card.
- **Solid bodies.** Characters never pass through each other. Each travels in its own depth lane, a hop arcs over anyone standing in its way and changes depth only near the top, a moving character slips in front of or behind a body before touching it, and held or thrown characters move in front of everyone. Add `?squad-debug` to the URL to count overlapping frames (`squadStage.debug` in the console).
- **Motion craft.** Every jump crouches first, travels on an arc and lands with a squash that overshoots and settles. No more than about a third of the squad moves at once.
- **Fallbacks.** With reduced motion turned on in the system settings, everyone appears already in place and nothing moves on its own. Phones and narrow windows (768px or less), Save-Data and reduced motion skip the 3D squad and keep the static art; so does a browser without WebGL.

## Design and interactions

- Self-hosted JetBrains Mono regular and bold, with its OFL license in `fonts/`.
- The "in action" console: a 34s story in four scenes. Connect: Gmail, Slack, Notion, Google Calendar, Stripe and GitHub wire into One. Ask: you type a request for an inbox agent in Workspace A, and Orchy hands it to the Agent Builder. Build: the builder fills in the agent (name, role, tools, rules) until Inbox Triage is live. Run: it sorts five new emails, drafts the two urgent replies, and asks for your OK in a Slack notification. The workflow steps beside it light up with the story, and the 3D Builder and Inbox characters act out their parts. It only plays while on screen; under reduced motion or without script it holds still on the notification. Logos are the real ones, from One's connector catalogue, in `assets/logos/`.
- Sample approval controls and a mobile menu. "Get Access" in the nav and "Join the early-access list" in the hero and Get access section open the early-access signup form in a new tab; "Book 30 minutes" opens Calendly in a new tab.

## Loading

First paint never waits on the big art. `worker/test-speed.mjs` (part of `npm test`) holds these rules:

- The hero art is `assets/orchy-main-500.webp` / `-1000.webp`, preloaded ahead of the CSS (it is the LCP element). The logos use `orchy-main-128.webp`, the favicon is `orchy-icon-64.png`, and the demo avatars crop `orchy-squad-sheet.webp`. Every `<img>` has width and height and stays under 64 KB.
- The fonts are subset to the characters the site uses (Latin-1, punctuation, arrows) and use `font-display: swap`. If new copy needs another character, re-subset from the full JetBrains Mono release.
- The 3D squad (Three.js and the two big SVGs) loads only after the page's `load` event, when the browser is idle, and only on desktop.
- The character SVGs keep their embedded PNGs as `js/art.mjs` reads them: the greyscale mask first, then the colour render. Recompress them losslessly in place; never run SVGO over them.

## Files

- `index.html`: page structure, product copy, links and metadata.
- `styles.css`: typography, responsive layouts, the squad's overlay, bubbles and perches, and the frosted-glass surfaces (a floating nav bar and translucent panels over a soft colour field).
- `js/main.mjs`: page interactions, keeping the workflow steps in time with the loop, and booting the squad.
- `js/inaction.mjs`: the console loop's clock. The markup carries the timing (`data-at`, `data-until`, `data-type`, `data-steps`, `data-scenes`); the CSS says what each element looks like when it's on.
- `js/art.mjs`: cuts the characters out of the supplied SVGs and traces their silhouettes.
- `js/stage.mjs`: the WebGL layer: models, movement, physics, perching, drag and throw.
- `js/life.mjs`: the director: the entrance, where everyone stands per section, and reactions.
- `js/robots.mjs`: example character profiles and sprite coordinates for the small avatars.
- `serve.mjs`: optional local preview server.
- `deploy.mjs`: publishes the page and its Worker to Cloudflare (below).
- `worker/`: the Cloudflare Worker: 301s from `http://` and `www.` to `https://imorchy.dev`, the launch video from R2 (with byte ranges, `worker/range.mjs`), and Google's verification file at its exact `.html` path. `worker/routes.mjs` lists which paths run the Worker first (pages and videos; not CSS, JS, fonts or images), and `worker/files.mjs` lists which files `deploy.mjs` uploads and their Content-Types (a new file type needs an entry there, or it 404s live while `serve.mjs` still shows it) and which are served from R2 instead. `worker/test.mjs` checks the Worker offline (part of `npm test`), `worker/test-deploy.mjs` checks that every site file is uploaded and every static file skips the Worker, `worker/test-deploy-api.mjs` runs `deploy.mjs` end to end against a fake Cloudflare API (`worker/fake-cloudflare.mjs`), and `worker/test-pages.mjs` checks each page's FAQPage JSON-LD against its visible FAQ text. `worker/check-live.mjs` checks the live site after a deploy.
- `build.mjs` and `content/`: the content build (Node built-ins only; neither is uploaded). `content/pages.json` lists the hand-written pages with the date each last really changed; `content/blog/<YYYY-MM-DD>-<slug>.md` and `content/changelog/<YYYY-MM-DD>-<slug>.md` are front matter plus markdown. `node build.mjs` writes `sitemap.xml` and any generated pages (marked as generated in their first lines: edit the source, never the output); `node build.mjs --check` (part of `npm test`) fails on a broken source, an SEO problem on any page, or a committed output that's out of date. Generated pages load `/styles.css` and no script but JSON-LD. Dates come only from the sources, so the same content always builds the same bytes.
- `sitemap.xml` (generated), `robots.txt` (only the Sitemap line) and `assets/og-image.png` (the 1200×630 share image) are for search engines and link previews. Structured data in `<head>` must say what the page says.
- `privacy.html`, `terms.html`, `security.html`, `data-privacy.html` and `dpa.html`: the legal pages, hand-written from the approved text, word for word (legal wording changes only with legal sign-off). Their tables sit in a labelled `.table-scroll` box so they scroll sideways on a phone instead of the page; `build.mjs`'s markdown does pipe tables the same way. `worker/test-pages.mjs` checks them (one h1, no skipped heading levels, every table boxed, no placeholders).
- `.well-known/security.txt`: the RFC 9116 security contact, served as `text/plain; charset=utf-8`. It's uploaded like any file (`worker/files.mjs` doesn't skip dot-folders) and runs the Worker first like the pages (`worker/routes.mjs`), so http:// and www. still get their 301. Renew its `Expires:` line before it passes.

## Going live

**Merging a PR into main deploys it.** The merge starts the **Deploy site** workflow (`.github/workflows/deploy-site.yml`): it runs the Worker tests, deploys to imorchy.dev, then checks the live site. Watch that run and its live checks in the repo's Actions tab. A red run means the deploy or a check failed; the step log says which.

- **Live checks** (`worker/check-live.mjs`): every page in the URL list (`worker/urls.mjs` plus the generated pages) answers 200 with its markers and security headers; https://www.imorchy.dev and http:// end at https://imorchy.dev; every `<loc>` in the live sitemap answers 200 with its own canonical; `/approvals/`, `/approvals.html` and `/index.html` take one hop to the clean URL; an unknown path is a 404 with the security headers; robots.txt blocks no search crawler and OAI-SearchBot and PerplexityBot get the home page; and a Range request for `/assets/video.mp4` answers 206. While the "Watch Launch Video" button is still disabled (Coming soon), a video missing from R2 is only a notice; once the button is enabled, it fails the run. **A new hand-written page** goes in `content/pages.json` (then run `node build.mjs`) and in `PAGES` in `worker/urls.mjs` with its markers; `npm test` fails if the sitemap and that list disagree. Generated pages are added to both on their own.
- **Roll back** by reverting the PR (GitHub's "Revert" button on the merged PR, or `git revert -m 1 <merge sha>` on a branch) and merging the revert. That merge is a push to main too, so it redeploys the previous version.
- **Redeploy** without a change: Actions → Deploy site → Run workflow, on `main`. Other branches never deploy.
- **One deploy at a time.** Merges deploy in order; if several queue up, only the newest runs, and it deploys the latest main.

The site runs as a Cloudflare Worker with static assets on its domain. In the workflow, `deploy.mjs` signs in with the `CLOUDFLARE_API_TOKEN` secret of the `production` environment (deployment branches: `main` only). The Worker itself has no secrets, and the script won't touch existing DNS records.

**The launch video** (`assets/video.mp4`) is kept out of git and isn't uploaded with the site: the Worker serves it from the R2 bucket `orchy-site-media` (bound as `MEDIA`) under the same key, `assets/video.mp4`, with byte ranges. There's no launch video yet: when there is, the owner uploads it to that bucket (Content-Type `video/mp4`), then a PR enables the button. Replacing it later is an upload, not a deploy. `serve.mjs` plays your local copy, if you have one.

### By hand (owner)

`deploy.mjs` also runs on a computer, for checking a token or the plan before a merge:

```sh
npm install --prefix worker                 # once: the Worker's packages
node deploy.mjs <domain> --dry-run          # what would change: reads only, nothing uploaded
```

With `CLOUDFLARE_API_TOKEN` set it uses that token. Without it, it goes through this repo folder's own One login and its Cloudflare connection (`one init --auth browser --project` in the repo root, then connect Cloudflare in that One organization). Dropping `--dry-run` publishes.

The core page, artwork and booking button work without JavaScript. External links point to the project repository, documentation, Calendly and the One website. Nothing here modifies the orchestrator, and the page sends nothing anywhere.
