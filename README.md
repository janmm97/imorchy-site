# Orchy landing page

A standalone landing page built with HTML, CSS, and native JavaScript modules. No build step. The 3D squad loads Three.js 0.169.0 from jsDelivr; everything else is in this folder.

## Preview

From the repository root:

```sh
node site/serve.mjs
```

Open http://127.0.0.1:4173. Stop with Ctrl+C. The preview serves only this folder and listens on loopback; it does not start or connect to the Orchy dashboard. An optional port can be passed as the first argument.

## The page

Four sections: the hero (the "Orchy AI" wordmark centred on screen with the squad standing on it, and a one-line tagline beneath), How it works (the interactive demo), Your rules (approvals, separate workspaces, local-first, harnesses and apps), and Install.

## The living squad

Orchy and his nine teammates are real 3D characters built from the supplied art in `assets/`. The page reads each SVG's embedded render and luminance mask, cuts every character out, traces its silhouette, and extrudes it into a bevelled solid with the original art on its front. Nothing is redrawn.

- **Entrance.** Orchy drops onto the wordmark. One by one, each teammate rises behind him, peeks over his left or right shoulder, looks around, crouches and jumps out into a two-row formation, each standing on the letter beneath it. Pink lands on his head. Afterwards a back-row teammate sometimes sneaks back for another peek, pairs swap sides, and the front row takes turns on his head.
- **They move around the page.** One transparent WebGL layer sits over the page, measured in CSS pixels, so characters stand on real cards and ride along as you scroll. When a new section reaches the middle of the screen they hop there in arcs; long trips break into several hops. Characters a section doesn't need peek in from the screen edges now and then.
- **Grab, toss, click.** Drag any character and it swings on a spring; let go and it flies with your throw, bounces off the screen edges and lands on whatever card it hits (any element with `data-perch`), then hops home. Click one to hear from it. They all turn toward your pointer, squash when you scroll fast, and breathe, glance and hop while idle.
- **They react to the page.** In How it works, Orchy stands beside the lit step and hops down as the demo moves through them; the routed teammate stands in the console beside its checklist, then hops onto the approval card and waits there, glowing. Inbox waits on the sample approval card. Workspace teammates get turned back from each other's rooms. Orchy stands inside his localhost window. Copying the setup lines sets off a wave of jumps.
- **Solid bodies.** Characters never pass through each other. Each travels in its own depth lane, a hop arcs over anyone standing in its way and changes depth only near the top, a moving character slips in front of or behind a body before touching it, and held or thrown characters move in front of everyone. Add `?squad-debug` to the URL to count overlapping frames (`squadStage.debug` in the console).
- **Motion craft.** Every jump crouches first, travels on an arc and lands with a squash that overshoots and settles. No more than about a third of the squad moves at once.
- **Fallbacks.** With reduced motion turned on in the system settings, everyone appears already in place and nothing moves on its own. Without WebGL the page shows the static art instead.

## Design and interactions

- Self-hosted JetBrains Mono regular and bold, with its OFL license in `fonts/`.
- An entirely local task simulation with approval, hold, research and custom-task paths. No task is sent to a model, app or backend.
- Sample approval controls, a mobile menu, and setup-command copying with a selectable fallback.

## Files

- `index.html`: page structure, product copy, links and metadata.
- `styles.css`: typography, responsive layouts, the squad's overlay, bubbles and perches, and the frosted-glass surfaces (a floating nav bar and translucent panels over a soft colour field).
- `js/main.mjs`: page interactions, the local task simulation, and booting the squad.
- `js/art.mjs`: cuts the characters out of the supplied SVGs and traces their silhouettes.
- `js/stage.mjs`: the WebGL layer: models, movement, physics, perching, drag and throw.
- `js/life.mjs`: the director: the entrance, where everyone stands per section, and reactions.
- `js/robots.mjs`: example character profiles and sprite coordinates for the small avatars.
- `serve.mjs`: optional local preview server.
- `deploy.mjs`: publishes the page and its Worker to Cloudflare through One (below).
- `worker/`: the Cloudflare Worker: static files, the launch video (with byte ranges), and the live playground's API.

## The live playground

Next to the sample demo, a visitor can try Orchy on their own Gmail. They sign in to One (or sign up) through One Connect and grant four Gmail actions: read their address, list emails, create a draft, send a draft. Orchy (Claude) then does one small task: read, draft, and ask before sending. Sending happens only when the visitor presses Send on the draft it shows them, and a draft to anyone other than the visitor says so first. Three tasks per visit; 20 requests a minute per IP.

Nothing is stored on the server. The visitor's grant reference and address live in a sealed, HttpOnly cookie (`worker/seal.mjs`), and they can revoke the grant from their One dashboard. The page shows the live mode only when the Worker has all its secrets; the local preview (`serve.mjs`) has no Worker and stays sample-only.

- `worker/main.mjs`: routes: `/api/session`, `/api/one/authorize` and `/api/one/callback` (One Connect), `/api/run` (streams the run), `/api/approve` (the only send), `/api/disconnect`.
- `worker/agent.mjs`: the task loop and its three tools. `request_send` ends the run; it never sends.
- `worker/gmail.mjs`: the four granted One actions. One refuses anything outside the grant.
- `worker/test.mjs`: offline tests (part of `npm test`).

## Deploying

The site runs as a Cloudflare Worker with static assets on its domain. `deploy.mjs` works through this repo folder's own One login and its Cloudflare connection (`one init --auth browser --project` in the repo root, then connect Cloudflare in that One organization).

```sh
npm install --prefix site/worker                 # once: the Worker's packages
node site/deploy.mjs <domain> --dry-run          # what would change, nothing uploaded
node site/deploy.mjs <domain> --secrets site/worker/.env   # first time, or when a secret changes
node site/deploy.mjs <domain>                    # later deploys keep the secrets
```

Secrets are listed in `worker/.env.example`. The launch video (`assets/video.mp4`) is kept out of git, and Cloudflare takes at most 25 MiB per file, so pass a web-sized copy with `--file assets/video.mp4=<path>`. The script won't touch existing DNS records. `--model` and `--effort` set the playground's Claude model and effort (default `claude-opus-5-5`, `low`).

The core page, artwork and install commands remain readable without JavaScript. External links point to the existing project repository, documentation, download and One website. Nothing here modifies the orchestrator; the live playground (above) acts only in a visitor's own Gmail, and sends only when they press Send.
