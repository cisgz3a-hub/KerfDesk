# LaserForge 2.0

> A focused CAM application for **GRBL** laser cutters and engravers. Web app and Windows desktop from one codebase. Proprietary source (ADR-018).

**Status:** Pre-development planning. No code yet. Five spec files (`PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `CLAUDE.md`, `RESEARCH_LOG.md`) define what gets built, in what order, by what rules; this README is the entry index.

---

## What it is

LaserForge 2.0 takes a 2D vector design (SVG), assigns cut/engrave operations per color layer, previews the toolpath, generates correct G-code, and streams it to your machine. The UX follows LightBurn's mental model — color-as-layer, Cuts/Layers window, Laser window, the workflow laser users already know. The scope is deliberately narrower than LightBurn: GRBL only in MVP, Line mode only in MVP, no raster engrave or camera or rotary or text in MVP.

It will be delivered as:

- A **web app** that runs in any Chromium browser (Chrome, Edge, Brave, Arc), uses WebSerial to talk to your laser, and works on macOS, Windows, and Linux.
- A **Windows desktop app** (Electron) for users who want a real native install.

Both ship from one codebase.

## What it isn't (and won't be in MVP)

- Not a design tool. Use Inkscape or Illustrator.
- Not a generic G-code sender. Use gSender or LaserGRBL for that.
- Not a LightBurn clone. We borrow the workflow, not the feature breadth.
- Not for Marlin, Smoothie, Ruida, Trocen, or TopWisdom controllers in MVP.
- Not for raster image engraving in MVP.
- Not for text in MVP (Phase D adds it).
- Not for raster-to-vector tracing in MVP (Phase E adds it).

See [`PROJECT.md`](./PROJECT.md) for the full scope and phase plan.

## Project documents

Read in this order:

| Document | What's in it |
|---|---|
| **[`PROJECT.md`](./PROJECT.md)** | Product scope, non-negotiables, phase plan A → E. The "what." |
| **[`WORKFLOW.md`](./WORKFLOW.md)** | Every user flow in Phase A, with success / error / empty / edge states. The "what should happen." |
| **[`DECISIONS.md`](./DECISIONS.md)** | All architectural decisions with rationale, alternatives, and consequences. 17 ADRs. The "why." |
| **[`CLAUDE.md`](./CLAUDE.md)** | Operating manual for Claude Code: file-size limits, naming, anti-patterns, checklists. The "how." |
| **[`RESEARCH_LOG.md`](./RESEARCH_LOG.md)** | Every dependency and external claim with license, version, source, evaluator. The "where it came from." |

## Build status

Pre-development. Phase A acceptance criteria are written ([`PROJECT.md`](./PROJECT.md) "Vertical slice — Phase A acceptance"); the first PR will set up the repo skeleton and the test/lint scaffolding.

Once code starts landing:

```bash
pnpm install
pnpm test           # Vitest unit + property + snapshot
pnpm lint           # ESLint with boundary + file-size rules
pnpm typecheck      # tsc --noEmit
pnpm dev:web        # Vite dev server, browser build
pnpm dev:desktop    # Vite + Electron, desktop build
pnpm build:web      # Static bundle to dist/web
pnpm build:desktop  # Signed .exe to dist/desktop
pnpm deploy:web     # Manual deploy of dist/web to Cloudflare Pages
```

### Cloudflare Pages — auto-deploy on push

The `.github/workflows/deploy.yml` workflow publishes the bundle to
`https://laserforge.pages.dev` after every push to `main`. It needs two
repository secrets to authenticate:

1. **`CLOUDFLARE_API_TOKEN`** — create at
   <https://dash.cloudflare.com/profile/api-tokens> using the
   **Cloudflare Pages — Edit** template. Scope to the Pages project.
2. **`CLOUDFLARE_ACCOUNT_ID`** — visible in the URL when you're inside
   any Cloudflare dashboard page (the long hex string after
   `dash.cloudflare.com/`).

Add both at **Settings → Secrets and variables → Actions → New
repository secret**. Until both are set the workflow will fail at the
"Publish to Cloudflare Pages" step (CI itself stays green).

## License

**Proprietary — All Rights Reserved** ([`LICENSE`](./LICENSE)). No permission is granted to use, copy, modify, or redistribute this source code. Viewing it does not grant any rights to use it.

Runtime dependencies remain governed by their own open-source licenses (MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD); GPL-family dependencies are rejected at PR time. See [ADR-018](./DECISIONS.md#adr-018--proprietary-license-private-repo-supersedes-adr-008) (current posture) and [ADR-017](./DECISIONS.md#adr-017--third-party-library-evaluation-policy-dompurify-pinned-for-phase-a) (dep policy). ADR-008 (the prior MIT/public posture) is superseded.

## Contributing

Pre-development; contribution guidelines arrive with the first code PR.

Architectural changes are gated by the ADR process — see [`DECISIONS.md`](./DECISIONS.md) for the format. Scope changes require a [`PROJECT.md`](./PROJECT.md) revision.

## Acknowledgements

- **LightBurn** — for setting the UX convention this project follows. We are not affiliated with LightBurn; we use it as a reference, not a code source.
- **CNCjs** — for being the canonical open-source GRBL implementation. Used as a Phase B protocol reference, not as a dependency.
- **DOMPurify, opentype.js, imagetracer.js** — for the MIT-compatible libraries that let LaserForge 2.0 stand on proven security and parsing work rather than reinventing it.
