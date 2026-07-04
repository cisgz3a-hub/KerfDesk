# LaserForge-2.0 Sector Architecture

Date: 2026-07-03
Target checkout: `C:\Users\Asus\LaserForge-2.0`
Git root verified: `C:/Users/Asus/LaserForge-2.0`
Branch at audit start: `main`
Audit mode: findings only. Product source must not be fixed during this audit.

## Evidence Baseline

The sector map was built from the live checkout with:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
git ls-files -co --exclude-standard
```

Pre-artifact inventory: 1,232 tracked plus untracked, non-ignored files. This audit adds the three files below, so the expected current inventory becomes 1,235 files unless the worktree changes while the audit is running:

- `audit/REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md`
- `audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md`
- `audit/REPOSITORY-SECTOR-PROGRESS-2026-07-03.md`

The working tree was dirty before these audit files were created. Existing modified/untracked source files are treated as user/work-in-progress state and are not reverted or fixed by this audit.

Ignored and generated folders such as `node_modules/`, `dist/`, `dist-electron/`, `.wrangler/`, `tmp/`, local log files, and `references/` are not part of the primary sector inventory unless a later pass explicitly uses them as evidence. S09 additionally references local `perceptual-artifacts/**` outputs when present, but that directory is ignored and not part of the tracked/non-ignored inventory.

Current-state refresh, 2026-07-04: after the initial audit/fix pass and later fast-forwards, `main` is at `e31a3b8` and `git ls-files -co --exclude-standard` returns 1,679 files. The sector patterns below were refreshed so current root planning docs and current `src/core/box`, `src/core/cnc`, `src/core/relief`, and `src/core/sim` files are no longer unclassified.

## High-Level Architecture

LaserForge-2.0 is a TypeScript, React, Vite, and Electron application for GRBL laser CAM workflows. The repository contracts describe it as a single codebase that ships both web and Windows desktop targets.

The main dependency flow is:

```text
User input / files
  -> UI workflows in src/ui
  -> app state and command handlers in src/ui/state and src/ui/commands
  -> pure domain transformations in src/core
  -> format and persistence boundaries in src/io
  -> platform adapters in src/platform or Electron shell code in electron
  -> generated previews, projects, G-code files, serial streaming, or desktop/web builds
```

Boundary rules from the repository contracts:

- `src/core/` is pure and platform-agnostic.
- `src/io/` owns file formats, parsing, serialization, and import/export boundaries.
- `src/platform/` owns browser platform adapter behavior.
- `src/ui/` owns React workflows and should depend on platform behavior through interfaces rather than direct platform imports.
- `electron/` owns the desktop shell, security policy, and native bridge behavior.
- `scripts/`, config files, and `.github/` own release gates and verification automation.
- `audit/`, root audit docs, `docs/`, and planning docs own historical evidence and audit memory.

## Sector Map

The sectors below cover every file returned by `git ls-files -co --exclude-standard` after including this audit set. Counts are current-state counts by path pattern, not a promise that the source will remain unchanged during later audit loops.

| Sector | Name | Files | Membership |
|---|---:|---:|---|
| S01 | Governance, audit history, and product contracts | 231 | `CLAUDE.md`, `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `AUDIT.md`, `README.md`, `CONTRIBUTING.md`, `LICENSE`, `RESEARCH_LOG.md`, `THIRD_PARTY_NOTICES.md`, `HANDOFF-*.md`, `PHASE-*.md`, `AUDIT-*.md`, `FEATURE-AUDIT-*.md`, `FIXES-*.md`, `LIGHTBURN-*.md`, `MATERIAL-*.md`, `docs/**`, `audit/**` |
| S02 | Tooling, build, release, CI, and static shell | 24 | `.editorconfig`, `.gitattributes`, `.gitignore`, `.prettierignore`, `.prettierrc`, `.github/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `eslint.electron.config.mjs`, `scripts/**`, `public/**`, `index.html` |
| S03 | Electron desktop runtime and local bridge | 14 | `electron/**`, `electron-builder.yml` |
| S04 | Core domain models, controller/device/material primitives | 290 | `src/core/app-branding.ts`, `src/core/box/**`, `src/core/camera/**`, `src/core/cnc/**`, `src/core/controllers/**`, `src/core/devices/**`, `src/core/geometry/**`, `src/core/grbl-streaming.ts`, `src/core/material-library/**`, `src/core/relief/**`, `src/core/scene/**`, `src/core/shapes/**`, `src/core/sim/**`, `src/core/text/**`, `src/core/util/**` |
| S05 | Core job compilation, preflight, raster/trace, and output | 219 | `src/core/invariants/**`, `src/core/job/**`, `src/core/output/**`, `src/core/preflight/**`, `src/core/raster/**`, `src/core/trace/**` |
| S06 | IO formats and persistence | 97 | `src/io/**` |
| S07 | Platform adapters | 15 | `src/platform/**` |
| S08 | UI application workflows | 714 | `src/ui/**`, `src/vite-env.d.ts` |
| S09 | Fixtures, perceptual harness, and test assets | 75 | `src/__fixtures__/**`; local ignored evidence may also appear under `perceptual-artifacts/**` |

Cross-sector note: the S09 real-logo trace benchmark owns the tracked fixture `src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png`, keeping normal benchmark inputs with the perceptual fixture harness instead of the audit evidence corpus.

## Audit Order

The audit proceeds sequentially. A sector is not considered complete until at least three passes are recorded and no major unchecked area remains for that sector.

1. S01 Governance, audit history, and product contracts
2. S02 Tooling, build, release, CI, and static shell
3. S03 Electron desktop runtime and local bridge
4. S04 Core domain models, controller/device/material primitives
5. S05 Core job compilation, preflight, raster/trace, and output
6. S06 IO formats and persistence
7. S07 Platform adapters
8. S08 UI application workflows
9. S09 Fixtures, perceptual harness, and test assets

## Notes For Later Passes

- Tests and source files are audited in the sector that owns their production behavior when they are co-located.
- Historical audit evidence remains in S01, but later sectors may cite specific historical reports as supporting evidence.
- A finding is only recorded when it is grounded in current files or command output.
- No fixes are made until the full repo audit is complete and the maintainer explicitly chooses a fix phase.
