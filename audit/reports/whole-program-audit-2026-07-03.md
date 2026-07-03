# Whole-program audit — 2026-07-03

**Tree:** worktree `brave-proskuriakova-b6ffc6` == `origin/main` @ `e743e11` (0 ahead / 0 behind — findings apply to main).
**Ask:** "check if we built everything we should have and if everything works as it should."
**Method:** docs-vs-code cross-check (PROJECT/DECISIONS/WORKFLOW/AUDIT/handoff vs three independent read-only exploration passes over `src/`), full local gate run on this machine, GitHub Actions history + production probe, ADR/flow inventory. Findings only — nothing auto-fixed, per CLAUDE.md collaboration rule 1.

> **RESOLUTION (same session, 2026-07-03):** on maintainer instruction, W1 was fixed (identity guard accepts both `KerfDesk` and `LaserForge-2.0`/`LaserForge` via allowlist; KerfDesk regression test added to `deploy-workflow-gate.test.ts`) and doc-drift items D1–D4, D6, D7, D11 were reconciled in PROJECT/DECISIONS/AUDIT. Changes committed and `main` redeployed to publish the stalled merges. The maintainer-decision items in §6 (write/retire ADR-054–056, PROVISIONAL list, box clearance, E2E build-vs-amend, star backfill, signedArea/laser-store tidy-first) were left untouched by design.

---

## Verdict

- **Completeness: YES with documented remainders.** Everything scoped through Phase K plus Camera Mode v1–v4 exists in the tree with tests (778 source files / 529 test files). Zero bare TODOs, zero stub implementations; every incompleteness marker found is a documented PROVISIONAL/DEFERRED. The staged remainders (F.4 A5 polish, ADR-056 operation-stack UI, G12 external-program streaming, glyph weld, geometry kernel, Phase J) are all *known and documented*, not silent gaps. One spec-vs-reality exception: **the Playwright E2E suite promised in PROJECT.md's stack/CI sections was never built** (no config, no dependency, no tests).
- **Works as it should: code gates YES; delivery pipeline NO.** CI is green on HEAD (run 28644291955, 11m46s). Locally: typecheck, both lints, license check, dependency audit, web build, electron-main build, and file-size policy all pass; **3294/3295 tests pass** (the 1 failure is a 5 s timeout flake in `deploy-workflow-gate.test.ts` under heavy load — passes in isolation in 1.6 s; green on CI). **But the deploy pipeline has been broken since this morning's GitHub repo rename**, so production does not have the last ~3 merges (details in W1).
- **The dominant open debt is unchanged: hardware verification.** Every CNC-output feature, F.1/F.2 laser burns, the Phase K box fit, and camera-on-machine use remain CLAIMED, per the house convention.

---

## 1. Broken right now

### W1 — Repo renamed `LaserForge-2.0` → `KerfDesk`; identity guard not updated → deploys down, production stale (HIGH)

- **Evidence:** `gh api repos/cisgz3a-hub/LaserForge-2.0` → `full_name: cisgz3a-hub/KerfDesk`. The three Deploy runs since the rename (28641920312 @ 06:06Z, 28644149569 @ 06:59Z, 28644837346 @ 07:14Z) all fail in ~30 s at the "Repository identity guard" step: `expected … folder named "LaserForge-2.0", got "/home/runner/work/KerfDesk/KerfDesk"`. `scripts/assert-correct-repo.mjs:5-6` pins both `expectedRepoName = 'LaserForge-2.0'` and `expectedRemote = …/LaserForge-2.0`. CI stays green because ci.yml does not run the guard.
- **Production impact:** last successful deploy (05:37Z) = commit `d839c96`. `git ls-tree d839c96` shows **no `src/core/camera`, no `src/ui/camera`, no `src/core/box`** — the live site at laserforge-2fj.pages.dev has **no Camera Mode (v1–v4), no box generator, no ADR-105 Easel-parity pack** (persistent 3D pane, pocket raster fill, design library).
- **Local impact:** `pnpm guard:repo` fails on this machine too (clone folder is `LaserForge`, and on Actions the checkout remote is the new URL) → `release:check` and `deploy:web` cannot pass anywhere until the guard is reconciled with the rename.
- **Fix path (maintainer decision, not applied):** update the two constants in `scripts/assert-correct-repo.mjs` (name `KerfDesk`, remote `https://github.com/cisgz3a-hub/KerfDesk`), update the fixtures in `src/platform/web/deploy-workflow-gate.test.ts` (they pin the old folder/remote), decide the expected local folder name(s), then `workflow_dispatch` the Deploy workflow to publish HEAD. Alternative: rename the repo back.

### W2 — `format:check` unusable on this machine (LOW, environment — not a repo defect)

Global `core.autocrlf=true` + `.gitattributes` that pins only binaries → CRLF checkout → `prettier --check .` flags essentially every file. CI (LF checkout) is green on the same commit. Hardening option if wanted: `* text=auto eol=lf` in `.gitattributes` (one-time normalization commit), which would make Windows clones deterministic.

---

## 2. Gate results (HEAD `e743e11`, this machine, 2026-07-03)

| Gate | Result | Note |
|---|---|---|
| `guard:repo` | ❌ | W1 — rename fallout; fails on Actions too |
| `typecheck` | ✅ | |
| `lint` / `lint:electron` | ✅ / ✅ | 0 errors |
| `format:check` | ❌ local / ✅ CI | W2 — CRLF environment artifact |
| `license-check` | ✅ | incl. three.js (MIT) + lucide-static (ISC); RESEARCH_LOG entries present |
| `audit:deps` | ✅ | 0 vulnerabilities |
| `test` | ✅* | 3294/3295; 1 load-flake timeout (`deploy-workflow-gate.test.ts`) passes isolated; CI green |
| `build:web` | ✅ | PWA precache 26 entries / 3.4 MB; `three.module` lazy chunk 704.87 kB raw / 181.20 kB gzip (ADR-102 lazy-load; AUDIT A6 bundle item stays open/non-blocking) |
| `build:electron-main` | ✅ | packaged `.exe` NOT rebuilt this session |
| `check:file-size` | ✅ | 600-line raw backstop |
| CI (GitHub, Linux) | ✅ | green on this exact commit |
| Deploy (GitHub) | ❌ | W1 |

---

## 3. Completeness — phase plan vs tree

| Phase | Docs say | Tree says | Remaining (documented) |
|---|---|---|---|
| A–C MVP | Shipped | All modules + flows present; hardware-verified inventory in AUDIT.md | — |
| D Text | Shipped | `core/text`, 4 bundled fonts, ligatures fix | Glyph weld (explicitly not shipped, post-kernel) |
| E Trace | Shipped + rework | Outline/Centerline/Edge/Sketch; perceptual harness (43 files); ADR-058/059 landed | ADR-030 formal ratification (substance shipped — see D5) |
| F.1 Fill | Shipped | fill-hatching + cross-hatch + offset-fill + overscan family (ADR-031..039) | Hardware burn (CLAIMED) |
| F.2 Image | a–e shipped | dither/emit-raster + property fuzz | **F.2.f hardware burn** |
| F.3 Origin | Code shipped | G92 + WCO caching | Hardware verification |
| F.4 Convert to Bitmap | "A3/A4/A5 pending" | **A3 Outlines + A4 Use-Cut-Settings BUILT with tests** (`ConvertToBitmapDialog`, `vector-to-bitmap.test.ts`) | A5 polish; docs stale (D4) |
| F.5 Material calibration | Staged | Material/Interval/Scan-offset test generators + ADR-093 wizard/Saved Libraries/auto-save all present | Recipe values need hardware validation |
| G Drawing tools | "In progress" | **B1–B7 all built** (shapes core, 'shape' variant, tool strip, draw-drag, pen, hotkeys) + star | P2: parametric handles, convert-to-path; docs stale (D6) |
| H Router H.0–H.11 | Built (G1–G8) | All modules present (`core/cnc`, `core/relief`, `core/sim`, `io/dxf`, `io/stl`, probing, overrides, tiling, surfacing…) | **Entire 4040 air-cut ledger** (see §4) |
| I Multi-controller | Merged | grbl/grblhal/fluidnc/marlin/smoothieware/ruida drivers + simulators | grblHAL hardware-verified ✅ (Falcon, 2026-07-02); FluidNC/Marlin/Smoothie sim-only; Ruida `.rd` not accepted by real hardware |
| K Box generator | Built S0–S6 | `core/box` + `ui/box`; benchmark 1063/1063 in suite | Physical cut + assembly |
| Camera v1–v4 (ADR-107..110) | (no phase entry) | `core/camera` (35 src) + `ui/camera` + F-CAM1–5 flows | **No AUDIT.md rows at all; no phase-plan entry; no hardware pass** (see D7) |
| — E2E | PROJECT.md stack: "Playwright (E2E smoke per platform)"; CI listed with E2E | **Never built** — no playwright config/dep/tests anywhere | Build it or amend PROJECT.md (D9) |

Also confirmed built though easy to miss: kerf compensation (`core/geometry/kerf-offset.ts`), automatic tabs (`core/geometry/tabs-bridges.ts` + compile wiring), Registration Box (ADR-057), `.lbdev` import (`io/lightburn`), machine-profile IO, no-go zones, Verified Origin (ADR-053).

---

## 4. Verification honesty — what "works" currently means

- **Hardware-VERIFIED:** the AUDIT.md laser inventory (connect/home/jog/frame/stream/progress/estimates/etc.) and **GRBL v1.1 + grblHAL on the Falcon A1 Pro (2026-07-02)**, which also proves the driver-seam refactor byte-identical on real hardware.
- **Verified by isolated live pass (not hardware):** June-10 live pass (image import, trace incl. true-medial-axis centerline, material library, convert-to-bitmap); several H.11 items live-verified in isolated previews (booleans, 3D cut preview, feeds calculator, provenance banner, persistent 3D pane, design library).
- **CLAIMED — the standing hardware debt (all tests green, zero machine evidence):** every Phase H row (CNC MVP end-to-end, sim-vs-machine, V-carve caliper check, relief roughing/finishing, DXF air-pass, multi-tool M0 session ⚠ highest risk, probing wizard ⚠ plate geometry PROVISIONAL, overrides mid-job, start-from-line resume ⚠, tiling re-registration, surfacing, pocket raster fill), F.1 fill burn, F.2.f raster burn, F.3 origin, Phase K box fit, camera on-machine, Marlin/Smoothie/FluidNC community passes, Ruida real-controller acceptance.
- **Not measured at all:** PROJECT.md success-metric numbers (cold-start < 2 s/3 s, 60 fps @ 5k segments, G-code < 2 s @ 5k) have no benchmark harness; WCAG 2.2 AA claims untested beyond the R-M1 dialog fixes; packaged `.exe` not rebuilt this session.

Per CLAUDE.md rule 2 this section is the honest answer to "does everything work": the *code* passes its structural/determinism/perceptual-harness gates; the physical-output claims are explicitly unproven where marked.

---

## 5. Doc-integrity findings (docs are spec in this repo)

| # | Finding | Evidence |
|---|---|---|
| D1 | PROJECT.md cites **ADR-054/055/056** as scoping ADRs but they were never written; cross-hatch (built), offset-fill (built), operation stack (core partial, no UI) ship without decision artifacts. DECISIONS.md "Future ADRs" reserves 054–091 for build-plan tickets | PROJECT.md out-of-scope §; no `## ADR-054/055/056` headings |
| D2 | PROJECT.md mis-describes **ADR-052** (actual: scanning-offset zipper compensation, not Line-mode kerf) and **ADR-053** (actual: Verified Origin, not hard-skip tabs). Tabs are built (`tabs-bridges.ts`) with **no governing ADR**; kerf-offset's governing ADR is unclear | DECISIONS.md:2780, 2894 vs PROJECT.md out-of-scope § |
| D3 | ADR-092 status "wizard implementation pending" — `DeviceSetupWizard.tsx` + tests shipped | DECISIONS.md:3296 |
| D4 | ADR-029 + PROJECT.md F.4 say "A3 Outlines / A4 Use Cut Settings pending" — both built with tests | DECISIONS.md:1149; `src/ui/raster/` |
| D5 | ADR-030 still "Proposed… pending ratification" and PROJECT.md future-note "pending maintainer decision" — the control model shipped in substance (Cutoff band, Sketch, Transparency, Smoothness) via ADR-043/058/059/100 | DECISIONS.md:1197 |
| D6 | Phase G marked "[In progress]" though B1–B7 are complete | PROJECT.md:104 |
| D7 | **AUDIT.md has zero Camera Mode rows** (ADR-107..110, the newest feature surface) and camera has no phase-plan entry — it exists only as an un-struck out-of-scope note. The ledger convention (VERIFIED/CLAIMED per feature) is broken for camera | grep AUDIT.md 'camera' → 0 hits |
| D8 | Star shape in `core/shapes` + ToolStrip but absent from ADR-051 (known drift, backfill is maintainer's call) | HANDOFF §8 |
| D9 | PROJECT.md stack + CI description promise Playwright E2E — none exists | no playwright anywhere |
| D10 | `signedArea` exists ×5 (1 exported canonical + 4 private copies in box/dogbone/offset-fill/edge-trace) — the handoff's tidy-first candidate, now quantified | agent pass, file list |
| D11 | AUDIT.md A8 stale rows: "Cloudflare secrets not yet set" (deploys ran for weeks), zoom-controls row still CLAIMED | AUDIT.md:269 |
| D12 | `laser-store.ts` back at 419 physical lines after the split-out of line-handler/motion/setup actions — under limits, but the growth trend the handoff flagged continues | wc -l |

---

## 6. Maintainer decision queue (accumulated, not for silent adoption)

1. **W1 identity:** guard update vs repo re-rename; expected local folder names; then redeploy.
2. Camera governance: add AUDIT.md rows + a phase-plan entry (or explicitly exempt it).
3. Write or retire ADR-054/055/056; correct PROJECT.md's ADR-052/053 descriptions; ADR for tabs.
4. The PROVISIONAL list from HANDOFF §9: ADR-101 hide-list extras, Auto-focus hidden in CNC, H.6c text defaults, H.9 v1 lead-in, H.10 3 mm registration holes, drill/peck at plunge feed, sim active-bit-only, dogbone style, feeds-chart starter values, probe-plate geometry, design-library curation.
5. Box clearance derivation: −c/4 offset (play = c) vs the plan's −c/2 (play = 2c) — flag stands from the Phase K session.
6. Easel comparison's un-adopted item: guided "Carve" checklist (home→zero/probe→confirm→start).
7. E2E: build the promised Playwright smoke or amend PROJECT.md.
8. `.gitattributes` eol pinning (W2 hardening).
9. Tidy-first: signedArea consolidation; laser-store growth watch.

---

## 7. What this audit did NOT verify

No hardware was driven. No fresh live-app pass was made this session (house rule 4: the dev server shares the maintainer's real scene; prior isolated-preview evidence is cited as-is from the ledger). Perceptual fidelity beyond the in-suite harnesses (trace IoU, V-carve pyramid, box sheet, sim≡emitter) was not re-rendered. The packaged Windows `.exe` was not rebuilt. The production site was probed only for reachability/title. Success-metric performance numbers were not measured (no harness exists — see §4).
