# 8 — Invariants and verification: what is actually proven

The honest version. CLAUDE.md rule 2 requires it: *green tests are NOT proof a feature works.*

## The nine safety and correctness non-negotiables

From `PROJECT.md:301-311`, with the actual enforcement mechanism for each:

| # | Invariant | Enforced by | Kind |
|---|---|---|---|
| 1 | **Bounds check** — paths fit the configured bed | `findOutOfBoundsCoords` (`predicates.ts:88`) + arc bulge check (line 141) | Property test, 100 seeds |
| 2 | **Origin honesty** — output matches profile origin | `toMachineCoords` (`origin-transform.ts:21`) | Unit + review |
| 3 | **Laser-off on travel** | `findLaserOnTravelIssues` (`predicates.ts:54`) | Property test, 100 seeds |
| 4 | **No partial output** | `core/preflight/pre-emit.ts` — failure writes nothing, sends nothing | Unit |
| 5 | **Deterministic G-code** — byte-identical | Vitest snapshots + fuzz over 100 seeds | Snapshot + property |
| 6 | **Units honest** — mm internally | Inches converted only at the import boundary | Review |
| 7 | **Power scale honest** — `S` matches `$30` | `expectedS` (`predicates.ts:187`), tested at `$30 ∈ {100,255,1000}` | Property test |
| 8 | **No telemetry** | Two narrow desktop-only release checks permitted (ADR-024/135, ADR-249) | Review + CSP |
| 9 | **Abort reachable always** | No modal may block it | Review |

CNC adds its own, outside the numbered list: **Z up on travel**, via `findPlungedTravelIssues` and
`findSpindleStartClearanceIssues` (`core/invariants/cnc-motion.ts:20`, `:48`).

**Non-negotiable #9 carries an explicit honesty caveat** (`PROJECT.md:311`): the software Abort /
Controller Reset *is not a safety-rated E-stop*. Dangerous conditions require the machine's physical
E-stop or power isolation. ADR-200 (`:8599`) restates it.

## The critical design choice: predicates read the final text

Every invariant predicate scans the **emitted G-code string**, not intermediate structures. Two
consequences, both deliberate (`predicates.ts:1-11`):

1. A regression introduced *anywhere* upstream is caught, because the check reads what will actually be
   sent.
2. The predicates are liberal about formatting — comments stripped, blanks skipped, trailing whitespace
   tolerated — so they can validate G-code from **external tools** too, not just our own emitters. That
   is what makes the imported-`.nc` and standalone-generator checks possible (`cnc-motion.ts:44-47`).

## What the suite actually asserts

| Asserted | Not asserted |
|---|---|
| SVG prefix / path counts | That a trace resembles the source image |
| Byte-identical G-code over fuzz seeds | That the burn looks right |
| Laser-off on every travel move | That the power suits the material |
| Coordinates inside the bed | That the workpiece is where the operator thinks |
| Pass structure and ordering | That a V-carve matches the model |
| Determinism | Fidelity |

**This is the most important caveat in the document set.** Output can be geometrically wrong and still
pass everything. CLAUDE.md rule 2 forbids calling any trace/fill/engrave/raster feature "working" on the
strength of a green suite.

## The perceptual harness — and its blind spot

**ADR-025** (`DECISIONS.md:1070`) added `src/__fixtures__/perceptual/`, which renders trace output and
diffs it against analytic ground-truth masks via **IoU** (intersection over union).

It has a known, documented blind spot. `PROJECT.md:113` records it: imagetracerjs is outline-only, so a
single pen stroke becomes two parallel contours — and **closing that outline-vs-centerline gap is not
caught by the IoU harness.** Project memory puts it more bluntly: *IoU is blind to waviness → trust
rendered PNGs.* A wobbly curve and a clean curve can score nearly identically on IoU while looking
obviously different.

Practical consequence for Phase 2: **do not use IoU scores as evidence of trace parity with LightBurn.**
Render both and look.

## Hardware verification status

| Area | Status |
|---|---|
| GRBL v1.1 + grblHAL streaming | **VERIFIED** — Falcon A1 Pro, GrblHAL 1.1f, maintainer, 2026-07-02 |
| ADR-094 driver refactor byte-identity | **VERIFIED** — implied by the above (`PROJECT.md:195-200`) |
| FluidNC / Marlin / Smoothieware | Simulator only |
| Ruida `.rd` | Encode→decode round-trip proven; **never accepted by real hardware** |
| Laser F.2 raster burn | **PENDING** — never burned on the Falcon |
| Laser F.3 set-work-origin | **PENDING** |
| All CNC Phase H | **CLAIMED** — code + tests landed, no hardware pass |
| Phase K box fit | **CLAIMED** — no box has been cut and assembled |
| Desktop Preview launch/install | **CLAIMED** until real-OS verification |

`PROJECT.md:55` states the packaging equivalent explicitly: *passing builds and automated tests prove
only packaging integrity.*

## Enforcement that is mechanical vs review-only

Frequently misread, so worth tabulating. From CLAUDE.md:

| Rule | Mechanical? |
|---|---|
| File ≤ 400 counted lines | **Yes** — ESLint `max-lines`, plus a 600 raw-line CI backstop |
| Function ≤ 80 lines, complexity ≤ 12 | **Yes** — ESLint |
| Module boundaries (`core` ← nothing) | **Yes** — `eslint-plugin-boundaries` |
| No clock / randomness in `core/` | **Yes** — `no-restricted-syntax` |
| Soft 250-line tier | **No** — report-only script, always exits 0 (ADR-132) |
| React component ≤ 250 lines | **No** — review only; no component-specific lint rule exists |
| Cross-module imports via `index.ts` | **No** — folder-mode classification lets deep paths pass |
| `Result` instead of `throw` in `core/` | **No** — review only; no lint rule detects a `throw` |
| Sibling test per source file | **No** — CI does not enforce it; PR review does |
| Snapshot-change acknowledgment line | **No** — review convention, not a CI gate |

Four rules that read as enforced are not. Anyone auditing this codebase should assume those four have
drifted somewhere.

## The gates that actually run

`pnpm release:check` runs lint, typecheck, format, license, tests, builds, and file-size. Per CLAUDE.md
"Session hygiene", two traps:

- **`prettier --check .` is repo-wide and is NOT part of `pnpm lint`.** A Prettier-dirty file passes lint
  locally and fails the release gate.
- **ADR-254** (`:11873`, merged as `b3c52341`) moved the dependency audit **out** of the merge gate.
  `audit:deps` now runs nightly and files a tracking issue; it does not block PRs. Triage the open audit
  issue before cutting a `v*` desktop release.

Playwright browser smoke is a **separate** workflow, not part of the release gate (ADR-158, `:7441`).

## Cross-reference slot — Phase 2

1. **Does LightBurn publish any correctness guarantees?** Almost certainly not — likely an
   **our-advantage** row. Record what we can prove that they do not claim.
2. **Fidelity benchmark.** The real cross-reference task is not documentation but **output**: run the
   same SVG and the same PNG through both, at the same settings, and diff rendered G-code paths. That is
   the only comparison that tests fidelity rather than structure.
3. **Their failure modes.** Search LightBurn/Easel forums for recurring output bugs. Each is a test case
   we should already pass — and a cheap way to find where we don't.
4. **Material test parity.** Compare our Material/Interval Test generators (ADR-044) against
   LightBurn's. Ours is deliberately minimal; find what theirs varies that ours doesn't.
5. **Estimate accuracy.** Compare `estimate-duration.ts` predictions against LightBurn's job-time
   estimate on identical jobs, then against a stopwatch. Both may be wrong; ours is unverified.
