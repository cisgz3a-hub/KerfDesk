# LaserForge 2.0

> A focused CAM application for **GRBL** laser cutters and engravers. Web app and Windows desktop from one codebase. Proprietary source (ADR-018).

**Status:** Phases A–E shipped (the MVP plus the two post-MVP rounds: text + raster trace), plus Phase F.1 (Fill hatching, shipped 2026-05-28), Phase F.2 (raster image engrave — code shipped through F.2.e, hardware burn F.2.f pending), and Phase F.3 (set work origin — code shipped, hardware verification pending). **Trace pipeline hardened 2026-05-29:** transparent-PNG decode fix, a perceptual-fidelity test harness (ADR-025), and a trace-keeps-source overlay (ADR-026). **Known open gap (next frontier):** imagetracerjs is outline-only, so the outline-vs-centerline limitation remains; see ADR-025 'Scope'. Hardware-verified on a Creality Falcon A1 Pro running GrblHAL 1.1f. Live web build at <https://laserforge-2fj.pages.dev> (published by GitHub Actions after CI succeeds). Spec files (`PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `CLAUDE.md`, `RESEARCH_LOG.md`) plus the rolling `AUDIT.md` describe what's built and why; this README is the entry index.

---

## What it is

LaserForge 2.0 takes a 2D vector design (SVG), assigns cut/engrave operations per color layer, previews the toolpath, generates correct G-code, and streams it to your machine. The UX follows the laser-CAM conventions users already know — color-as-layer, a Cuts/Layers window, a Laser window. The scope is deliberately narrow: GRBL only in MVP, Line mode only in MVP, no raster engrave or camera or rotary or text in MVP.

It will be delivered as:

- A **web app** that runs in any Chromium browser (Chrome, Edge, Brave, Arc), uses WebSerial to talk to your laser, and works on macOS, Windows, and Linux.
- A **Windows desktop app** (Electron) for users who want a real native install.

Both ship from one codebase.

## What it isn't (and won't be in MVP)

- Not a design tool. Use Inkscape or Illustrator.
- Not a generic G-code sender. Use gSender or LaserGRBL for that.
- Not a do-everything laser suite. We keep the familiar workflow, not the full feature breadth.
- Not for Marlin, Smoothie, Ruida, Trocen, or TopWisdom controllers in MVP.
- Not for raster image engraving in MVP.
- Not for text in MVP (Phase D adds it).
- Not for raster-to-vector tracing in MVP (Phase E adds it).

See [`PROJECT.md`](./PROJECT.md) for the full scope and phase plan.

## Project documents

Read in this order:

| Document | What's in it |
|---|---|
| **[`PROJECT.md`](./PROJECT.md)** | Product scope, non-negotiables, phase plan A → F. The "what." |
| **[`WORKFLOW.md`](./WORKFLOW.md)** | Every user flow with success / error / empty / edge states. The "what should happen." |
| **[`DECISIONS.md`](./DECISIONS.md)** | All architectural decisions with rationale, alternatives, and consequences. 26 ADRs (ADR-001..026; ADR-022–024 are reserved placeholders, not yet written). The "why." |
| **[`CLAUDE.md`](./CLAUDE.md)** | Operating manual for Claude Code: file-size limits, naming, anti-patterns, checklists. The "how." |
| **[`RESEARCH_LOG.md`](./RESEARCH_LOG.md)** | Every dependency and external claim with license, version, source, evaluator. The "where it came from." |
| **[`AUDIT.md`](./AUDIT.md)** | Rolling professional audit. Re-run after each phase; archived snapshots in `AUDIT-YYYY-MM-DD-phase-*.md`. |

## Build status

Phases A–E shipped, plus Phase F.1 / F.2 / F.3 (see **Status** above). 796 tests across 101 files pass; `pnpm audit` is 0/0/0/0. See `AUDIT.md` for current findings.

```bash
pnpm install
pnpm test               # Vitest unit + property + snapshot
pnpm lint               # ESLint with boundary, react-hooks, file-size rules
pnpm lint:fix           # autofix lint
pnpm typecheck          # tsc --noEmit
pnpm format             # prettier --write .
pnpm format:check       # prettier --check . (CI gate)
pnpm license-check      # license allow-list audit (CI gate)
pnpm dev:web            # Vite dev server, browser build
pnpm dev:desktop        # Vite + Electron, desktop build
pnpm build:web          # Static bundle to dist/web (no sourcemaps in prod)
pnpm build:desktop      # Signed .exe to dist/desktop
pnpm deploy:web         # Manual deploy of dist/web to Cloudflare Pages (production)
pnpm deploy:web:preview # Same, but to a per-deploy preview URL
```

### Cloudflare Pages — auto-deploy on push

The `.github/workflows/deploy.yml` workflow publishes the bundle to
`https://laserforge-2fj.pages.dev` after every successful CI run on `main`. It needs two
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

**Current status (2026-06-24): push-to-deploy is active.** The Cloudflare Pages
API project name used by Wrangler is `laserforge`, but its canonical production
release URL is `https://laserforge-2fj.pages.dev`. The older
`https://laserforge.pages.dev` address belongs to a stale Pages URL and must not
be used for release verification.

## License

**Proprietary — All Rights Reserved** ([`LICENSE`](./LICENSE)). No permission is granted to use, copy, modify, or redistribute this source code. Viewing it does not grant any rights to use it.

Runtime dependencies remain governed by their own open-source licenses (MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD); GPL-family dependencies are rejected at PR time. See [ADR-018](./DECISIONS.md#adr-018--proprietary-license-private-repo-supersedes-adr-008) (current posture) and [ADR-017](./DECISIONS.md#adr-017--third-party-library-evaluation-policy-dompurify-pinned-for-phase-a) (dep policy). ADR-008 (the prior MIT/public posture) is superseded.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Architectural changes are gated by the ADR process — see [`DECISIONS.md`](./DECISIONS.md) for the format. Scope changes require a [`PROJECT.md`](./PROJECT.md) revision. The four operating-manual principles from [`CLAUDE.md`](./CLAUDE.md) (think before coding, simplicity first, surgical changes, goal-driven) gate every PR.

## Acknowledgements

- **CNCjs** — for being the canonical open-source GRBL implementation. Used as a Phase B protocol reference, not as a dependency.
- **GRBL active forks** — grblHAL, FluidNC, µCNC keep the 1.1h wire protocol alive after `gnea/grbl` was archived (Aug 2019).
- **DOMPurify** (MPL-2.0 / Apache-2.0), **opentype.js** (MIT), **imagetracerjs** (Unlicense) — the MIT-compatible libraries that let LaserForge 2.0 stand on proven security and parsing work rather than reinventing it.
