# Painted second-pass repair record

Date: 28 September 2026. Branch: `codex/second-pass-quality-fixes-20260928`.
Implementation base: `4ba37a94d8259dce5c67723cda96aa725582c01d`.
Workspace: `D:/LaserForge/second-pass-audit-20260928`.

This follows the [baseline audit](README.md), which reproduced SP-01 through SP-05
on `be04c885b`. The intervening main updates did not change the affected second-pass
implementation. The primary checkout and its unrelated work are preserved.

## Changes

- **SP-01:** new writer 3 makes air/beam synchronisation dark, including coincident
  endpoints. Dark excursions stay on a source edge and are included in motion bounds.
- **SP-02:** new output keeps original connected motion around selected burns instead
  of transplanting short overscan beside a painted area. Feed changes, corners and
  rapid moves alone do not prove a stop. Retained unselected motion uses S0. Explicit
  synchronising boundaries are preserved even when the final beam/air state is equal.
- **SP-03:** an accepted run can retain its same-page source after archive activation
  fails as well as after staging fails. Retention observes the actual run from before
  the first write, and clean completion, interruption and replacement remain distinct.
  Persistent recovery failure is still disclosed. Scoped terminal cleanup lets the next
  framed job start after storage recovers, including ineligible rotary/CNC lifecycle
  markers that never expose a second-pass artifact. It cannot cancel a newer intent.
  Interrupted intents stop renewing and use the existing uncertain-handoff reconciliation;
  no saved stop is fabricated when storage could not persist it.
- **SP-04:** offer, fallback retention and worker share flat-laser/controller eligibility.
  A rotary run no longer offers an editor that cannot process its coordinates.
- **SP-05:** the workbench body scrolls independently of the footer, and short-screen
  notifications leave actions reachable.
- Selecting a painted or erased stroke outlines its footprint without changing mask
  pixels. Capped power is disclosed immediately after Preview and again in Job Review.
- Dense source/preview backgrounds reuse display pixels during pan/zoom and redraw
  exact paths after 150 ms of inactivity. Scene, preview, display mode, size and pixel
  ratio changes invalidate the cache. Machining geometry and selection coordinates
  never use the bitmap.
- The workflow now documents supported G17 XY I/J arcs and their stock GRBL tolerance
  assumption. [ADR-341 Amendment 9](../../decisions/ADR-341-amendment-9-second-pass-output-and-workbench-quality.md)
  records motion preservation, writer compatibility and failure handling.

## Compatibility and limits

Writers 1 and 2 still reproduce their recorded output. New stages use writer 3 and
seal that version into their recovery lineage. Historical output is not silently
rewritten or represented as having the new transition repairs.

Motion preservation can retain many unselected rows, so a small painted area can take
longer than with writer 2. This is intentional: matching commanded F/S alone does not
prove matching velocity. Initial machine approach, motor-step resolution, controller
lookahead/settings, arc settings and material response remain qualification limits.

No physical machine was operated. Software/controller-model evidence does not establish
physical alignment, material darkness or a hosted release. This record covers local
implementation verification; pull-request and deployment results are tracked separately.

## Measured display result

The local Chrome benchmark draws synthetic packed source geometry at the same view.
At one million segments, direct redraw took 70.0–83.6 ms of JavaScript and
142.5–154.6 ms including a forced raster read. Cached interaction took 0.8–1.0 ms
of JavaScript and 6.5–8.1 ms including the same raster read. Exact settled redraw
still took 168.3 ms, once after interaction stopped. These are local measurements,
not a performance promise for every GPU or design.

A browser pixel comparison checks the settled source/preview image against a fresh
direct vector draw and checks that endpoint arrays are unchanged.

## Verification

The complete frozen repository run passed: **3,160 test files and 23,706 tests**,
with 15 files / 27 tests skipped and no failures. It completed in 1,941.85 seconds.
`pnpm build:web` also passed, including notices generation, a fresh application
type check, the production bundle and service-worker generation. Vite completed its
bundle in 56.76 seconds and emitted a non-failing advisory for chunks over 750 kB.

Focused selection/output/Frame/replay coverage passed 247 tests in 25 suites.
Lifecycle fault injection and ownership coverage passed 65 tests in 9 suites,
including stale leases and transient read, artifact-write and slot-write failures.
The final repository run supersedes these focused counts.

The frozen Chrome run passed all 15 scenarios in 3.8 minutes: completion offers,
paint/erase/power adjustment, several disconnect positions, repeated recovery,
post-job interruption, reload and modal ordering, Machine-panel availability, a
150-line image interruption, writer-3 byte-exact recovery, short-screen actions,
stroke/cap feedback and dense settled pixel equality. Source hashes confirmed no
production edits during the run. The later interrupted-intent lease correction is
isolated to failed archive cleanup and has its own regression coverage.

Repository lint and formatting passed with only the local `audit-*-results/`
evidence directories excluded. Final lifecycle files also passed focused lint and
formatting after their last correction. App and end-to-end TypeScript checks passed.
ADR numbering, physical file-size limits and the public-export ratchet passed;
the soft-size report completed without a gate failure. Independent output and
lifecycle review found no remaining concrete defects in scope.

Reproduction commands and local logs (logs, benchmark samples and screenshots are kept
in the audit workspace above, rather than committed as repository artifacts):

- `pnpm test --maxWorkers=4`: `fix-full-unit-verified.log`.
- `pnpm build:web`: `fix-build-verified.log`.
- `pnpm lint --ignore-pattern 'audit-*-results/**'`: `fix-lint-verified.log`.
- `pnpm exec prettier --check . '!audit-*-results/**'`: `fix-format-verified.log`.
- `pnpm typecheck:e2e`: `fix-typecheck-e2e-final.log`.
- Chrome scenarios: `fix-browser-verified.log` and
  `test-results/second-pass-final-verified/`. Set `PLAYWRIGHT_PORT=5198`, then run
  `pnpm exec playwright test e2e/recovery-second-pass-stress.spec.ts e2e/production-workflows.spec.ts e2e/second-pass-workbench.spec.ts e2e/second-pass-replay.spec.ts --grep 'second pass|second-pass|darkening|finished job|cached' --timeout=120000 --output test-results/second-pass-final-verified`.
- Dense draw benchmark: `audit-browser-results/ui-draw-benchmark-after.json`.

Earlier exploratory wide runs were stopped while implementation was still changing.
They exposed one old mock missing the newly used repository snapshot method, and
development-server reloads invalidated browser sessions. The mock was corrected and
its five-test suite passed. Those partial runs are not counted as final verification.

## Main implementation files

- Output and source-context rules: `src/core/laser-second-pass/program-writer.ts`,
  `build-program.ts` and `source.ts`.
- Accepted-run retention and terminal ownership:
  `src/ui/laser/start-job-retained-execution.ts`, `start-job-execution-tracking.ts`,
  and `src/ui/state/recovery/recovery-start-handoff.ts`.
- Shared supported-source check:
  `src/ui/laser/second-pass/second-pass-eligibility.ts`.
- Workbench feedback, layout and display cache:
  `src/ui/laser/second-pass/SecondPassWorkbench.tsx`, `second-pass.css`,
  `second-pass-canvas-draw.ts` and `second-pass-background-cache.ts`.
- End-to-end additions: `e2e/second-pass-workbench.spec.ts` and
  `e2e/second-pass-replay.spec.ts`.

The branch named above packages the implementation, regression tests and documentation.
Physical-machine qualification remains separate from software verification and publication.
