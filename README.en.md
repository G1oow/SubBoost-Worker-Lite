<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="./docs/assets/logo.svg" width="96" alt="SubBoost logo">
</p>

<h1 align="center">SubBoost Worker Lite</h1>

<p align="center">Aggregates several upstream subscriptions and hand-added nodes into one Clash/Mihomo link, running only on Cloudflare Workers and Workers KV — no server, database or container.</p>

<p align="center">
  <a href="./README.md">简体中文</a> | <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Cloudflare%20Workers%20%2B%20KV-4B5563?style=flat-square" alt="Platform: Cloudflare Workers + KV">
  <img src="https://img.shields.io/badge/version-0.14.1-F59E0B?style=flat-square" alt="Version 0.14.1">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-22C55E?style=flat-square" alt="License: AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D22.23.4-3776AB?style=flat-square" alt="Node version requirement">
</p>
<!-- markdownlint-enable MD033 MD041 -->

**SubBoost Worker Lite** is the slim deployment form of [SubBoost](https://github.com/SubBoost/subboost). Sources and hand-added nodes live in Workers KV, and the service exposes exactly one Clash/Mihomo subscription link: running it for yourself means maintaining a single URL, with no server, database or container.

## Highlights

| Highlight | Why it matters |
| --- | --- |
| One link, every node | Upstream subscriptions and hand-added nodes are merged and deduplicated (`dedupeParsedNodes` in `packages/core`), so the client only needs one subscription URL |
| No server, database or container | All logic runs inside one Worker and state lives in Workers KV; a `0 */12 * * *` Cron trigger refreshes upstreams ahead of time, so most subscription requests are served from the KV cache |
| Stored fields encrypted at rest | Subscription tokens and similar fields use AES-256-GCM, with the key derived from `ENCRYPTION_KEY` via HKDF-SHA256 |
| Guarded upstream fetching | Protocol and credential validation, private-range blocking, and per-hop redirect re-checks (3 hops, 15 s timeout, 10 MB per fetch by default) |
| Several delivery forms | Plain YAML, age ciphertext (`?format=age`, `age-armor`), client deep links (`?target=`), or an 8-character short link at `/s/<code>` |
| The admin UI ships inside the Worker | A token-protected SPA handles source and subscription management plus refresh status; proxy groups, proxy chains, rules and rule sets are editable in the UI, and the raw JSON stays editable too |

## Architecture

```text
        ┌──────────────┐                          ┌──────────────────┐
        │ Clash/Mihomo │                          │ Admin SPA        │
        │ client       │                          │ worker/dist      │
        └──────┬───────┘                          └────────┬─────────┘
               │ GET /sub/<token>                          │ /api/* + Bearer token
               │ ?format= | ?target=                       │
               ▼                                           ▼
┌──────────────┬───────────────────────────────────────────┬─────────┐
│ Cloudflare Worker · worker/src                                     │
│ ADMIN_TOKEN auth · refresh · Clash/Mihomo YAML output              │
│ API: cache-control no-store · subscription: private, no-cache      │
└──────────────┬───────────────────────────────────────────┬─────────┘
               │ read / write                              │ fetch upstream
               ▼                                           ▼
┌──────────────┬───────────┐          ┌────────────────────┬───────┐
│ Workers KV · SUBBOOST_KV │          │ Upstream subscriptions     │
│ AES-256-GCM at rest      │          │ SSRF checks · 3 redirects  │
└──────────────▲───────────┘          └────────────────────────────┘
               │ write
┌──────────────┴─────────┐
│ Cron 0 */12 * * *      │
└────────────────────────┘
```

Clients never talk to upstreams directly: the Worker fetches and merges them into KV, and `/sub/<token>` serves from that cache.

## Usage Example

One subscription has five access forms; `/sub/<token>` and the short link `/s/<code>` behave identically:

| Request | Response |
| --- | --- |
| `GET /sub/<token>` | Clash/Mihomo YAML with an ETag, supporting 304 |
| `GET /sub/<token>?format=age` | age v1 binary ciphertext |
| `GET /sub/<token>?format=age-armor` | The same ciphertext as ASCII armor text |
| `GET /sub/<token>?target=<app>` | 302 to the client deep link |
| `GET /s/<code>` | 8-character short link, identical output to the original link |

`<app>` accepts `clash`, `stash`, `shadowrocket`, `singbox`, `v2rayng` and `hiddify`:

```text
https://<your-worker>/sub/<token>?target=clash
```

The server checks the subscription once, then 302s to the matching app deep link carrying the same URL with `target` stripped. Unknown `target` values are ignored and the request returns plain YAML. In-app browsers such as WeChat and QQ usually block custom schemes — copy the link instead.

age delivery needs `AGE_RECIPIENT` (an `age1…` recipient key) configured on the Worker, and only the matching private key can decrypt the output. Full steps, key management and decryption are documented in [docs/age-encryption.md](./docs/age-encryption.md).

## Quick Install

All three routes end up as the same Worker backed by `SUBBOOST_KV`; pick one.

### Option A: Fork the repository, then connect it to Cloudflare

Use this one when you want a redeploy on every push.

1. Fork this repository into your own GitHub account.
2. In the Cloudflare dashboard: Workers & Pages → Create → Import a repository, pick your fork, and set Production branch to `main`.
3. Keep Root directory at `/` and leave Build command empty (the `prepare` script builds the admin UI during install). Set Deploy command to `npm run deploy`.
4. Add the two secrets described in Configuration below. Every push to `main` then rebuilds and redeploys.

`npm run deploy` runs `node scripts/deploy-worker.cjs`, which reuses or creates `SUBBOOST_KV` by title and injects the real id into a temporary config before deploying. Do not replace it with a bare `npx wrangler deploy`: `wrangler.jsonc` only carries the KV id placeholder, so a direct deploy fails.

### Option B: Deploy to Cloudflare button

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/G1oow/SubBoost-Worker-Lite"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" height="32"></a>

Cloudflare copies this repository into your own GitHub account and creates the Worker and KV binding described by `wrangler.jsonc`. Add the two secrets from Configuration below when the deploy finishes.

### Option C: Deploy from your machine

```bash
npx wrangler login
ADMIN_TOKEN=<random string, 32+ characters> ENCRYPTION_KEY=<random string, 32+ characters> npm run worker:deploy
```

On PowerShell, set `$env:ADMIN_TOKEN` and `$env:ENCRYPTION_KEY` first, then run `npm run worker:deploy`. The script rejects placeholder or too-short keys, reuses or creates `SUBBOOST_KV` by title, injects the real id into a temporary config, uploads both secrets and deploys; `wrangler.jsonc` in the repository always keeps the placeholder id.

The two secrets that options A and B require by hand share one generator command:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Quick Start

Running locally needs no Cloudflare account. Prerequisites: Node.js 24.22.1 (see `.nvmrc`; `engines` allows `>=22.23.4 <23 || >=24.22.1`) and npm:

```bash
npm ci
cp .dev.vars.example .dev.vars   # fill in random ADMIN_TOKEN and ENCRYPTION_KEY (32+ characters each)
npm run worker:build
npm run worker:dev               # http://127.0.0.1:8787
```

On PowerShell, replace the second line with `Copy-Item .dev.vars.example .dev.vars`.

Open `http://127.0.0.1:8787`, sign in with the `ADMIN_TOKEN` you configured, add an upstream source and create a subscription. The subscription is served as Clash/Mihomo YAML from `/sub/<token>`; put that link into your client.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run worker:dev` | Run the Worker locally (port 8787) |
| `npm run worker:build` | Build the admin UI into `worker/dist` |
| `npm run worker:deploy` | Build, create/bind KV, upload secrets, deploy |
| `npm run worker:deploy:dry-run` | Validate config and bindings without uploading |
| `npm run worker:typecheck` | Type-check the Worker and the admin UI |
| `npm run test:unit` | Full unit and regression test suite |
| `npm run lint` | ESLint, UI consistency, repository hygiene, version check |

## Configuration

Both secrets are required; add them as Secret bindings in Worker → Settings → Variables and Secrets:

| Name | Type | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | Secret | Admin UI login token, 32+ random characters |
| `ENCRYPTION_KEY` | Secret | Key for stored-field encryption (AES-256-GCM), 32+ random characters |
| `AGE_RECIPIENT` | Variable (optional) | age recipient key `age1…`; comma- or space-separated for multiple keys, empty disables encrypted output |
| `AGE_ONLY` | Variable (optional) | Set to `1` to serve age ciphertext only; plaintext subscription and one-tap import return 403 |

With either secret missing, admin endpoints fail closed with 503. Replacing `ENCRYPTION_KEY` later makes existing data undecryptable, so sources and subscriptions must be re-entered.

## Deployment and operations

Post-deploy verification steps and common errors are covered in [worker/README.md](./worker/README.md).

To host a display-only preview as well, the repository root already ships `vercel.json`: build command `node scripts/build-vercel-demo.cjs`, output `worker/dist`, with the demo flag forced on by the build script and asserted in the output. No Vercel dashboard environment variables and no keys are involved, and demo data lives only in browser memory and resets on reload.

## Documentation

| Topic | What it covers | Link |
| --- | --- | --- |
| Deployment and operations | Manual deploy steps, post-deploy verification, fork / Workers Builds flow, common errors | [worker/README.md](./worker/README.md) |
| age delivery | Key generation, `AGE_RECIPIENT` setup, local decryption, FAQ | [docs/age-encryption.md](./docs/age-encryption.md) |
| Implementation plan | Design trade-offs of the Workers-only form | [docs/implementation/cf-worker-lite-plan.md](./docs/implementation/cf-worker-lite-plan.md) |
| Build notes | Conflicts resolved during the port and acceptance notes | [docs/implementation/cf-worker-lite-build.md](./docs/implementation/cf-worker-lite-build.md) |
| Contributing | Issue / PR rules, local checks, UI color conventions | [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) |
| Frontend guidelines | Layer ownership, style tokens, component usage, motion, known pitfalls and guard tests | [docs/frontend-guidelines.md](./docs/frontend-guidelines.md) |
| Third-party notices | Dependency and ecosystem attribution | [docs/THIRD_PARTY_NOTICES.md](./docs/THIRD_PARTY_NOTICES.md) |

## Contributing

Issue and PR rules plus local check requirements are in [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md). Before submitting, run `npm run lint`, `npm run test:unit`, `npm run worker:typecheck` and `npm run worker:build`.

## Community & Support

- Questions, bugs and feature requests: open a [GitHub Issue](https://github.com/G1oow/SubBoost-Worker-Lite/issues).
- Thanks to the [linux.do](https://linux.do) community for the discussion and feedback that shaped this slim deployment form.
- This project builds on upstream [SubBoost](https://github.com/SubBoost/subboost); the parsing, cleaning and config generation logic under `packages/` comes from that project.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=G1oow%2FSubBoost-Worker-Lite&type=Date)](https://star-history.com/#G1oow/SubBoost-Worker-Lite&Date)

## License

[GNU Affero General Public License v3.0 only](./LICENSE).

If you modify this project and serve it to network users, AGPL-3.0 requires you to offer those users the corresponding source code.

## Disclaimer

This project provides no proxy service and makes no guarantee about the availability or legality of third-party subscription content.
