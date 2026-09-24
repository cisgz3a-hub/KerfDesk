## ADR-363 - Delete three superseded modules that no app entry reaches (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Resolves, for `DeviceSettings.tsx` and `MachineSetupProfiles.tsx`, the deletion that ADR-240
deferred ("folding or deleting them stays a separate refactor decision") and ADR-347 repeated.

### Context

The 2026-09-24 audit of PRs #817-#866 (`docs/audits/2026-09-24-last-50-pr-audit.md`) built a
production import graph from `src/ui/app/main.tsx`: static and dynamic imports plus
`new URL(..., import.meta.url)` worker targets, without `import type` edges. Three modules are
imported only by tests, so fixes kept landing in them without reaching anyone:

1. `src/core/job/planner.ts` (`estimateWithPlanner`). #799 moved the job estimate onto the emitted
   G-code (`core/gcode-time`) and removed its last production caller. #832 still edited its
   contour-entry bounds.
2. `src/ui/laser/MachineSetupProfiles.tsx` -> `DeviceSettings.tsx` -> `HomingEditor` in
   `DeviceProfileFields.tsx`. The live Machine Setup is `src/ui/laser/device-setup/*`. #832's
   homing wording changes landed in both `HomingEditor`, which never shipped, and
   `DeviceSetupConfirmStep`, which did.
3. `src/ui/import/paged-asset-worker-client.ts` (`stageAssetOffThread`) with its worker and
   protocol. Slice 1 of the memory-bounded import program built it as shared infrastructure "not
   connected to a picker/import route yet". Its e2e flaked on main (Browser smoke run
   35725409062 on `dff35227e`: `cancellationName` was `""`, not `"AbortError"`). Aborting the
   active request only posted `cancel`, so a `complete` the worker had already queued still
   resolved the promise.

### Decision

Delete all three with their tests. None is rewired.

- **Planner: superseded.** Since #799 the estimate is priced from the emitted program, so emitter
  changes such as contour entries reach it without a second model. `planner-laser-transitions.ts`
  and `raster-duration-motion.ts` had no other importer and go too. The unit tests for the live
  motion-planner primitives (`junctionVelocity`, `blockTime`, `planVelocities`) move unchanged to
  `core/motion-planner/motion-planner.test.ts`; only the `estimateWithPlanner` cases are deleted.
  `contour-entry-placement.test.ts` keeps its check that `estimateJobDuration` matches the
  emitted-program clock.
- **Legacy Machine Setup panels: superseded by `device-setup/*`.** Removing them leaves
  `HomingEditor`, `BasicRows`, `ProfileRows`, the `PlannerAdvanced` `<details>` wrapper and two
  style tokens with no production user, so those go as well. Exports the live setup steps mount
  stay: `NameRow`, `BedRows`, `OriginCornerRow`, `FeedRows`, `HomingCornerSelect`, `ZRows`,
  `PlannerFields` and the power and air-assist rows. The live homing checkbox keeps its own audit
  test in `DeviceSetupControls.audit.test.tsx`.
- **Paged-asset worker: not wired, and no decision plans to wire it.** ADR-283's page-backed route
  is `importPngOffThread` -> `png-import-worker`. Slice 3 of the same program replaced this
  worker's whole-`Blob` handoff with a transferred `File.stream()` staged by
  `paged-asset-stream-stager.ts`, because the `Blob` handoff had no backpressure contract. Nothing
  names `stageAssetOffThread` as a future route. `paged-asset-stager.ts` and the IndexedDB
  repository stay; the PNG route uses both.

### Consequences

- Users see no change. The deleted modules were never in the production bundle.
- The flaky `e2e/paged-asset-worker.e2e.ts` is deleted with the code it tested. The live PNG client
  does not share the race: an abort of the active request retires the worker synchronously, so a
  late `complete` is dropped, and `png-incremental-worker.e2e.ts` asserts the `AbortError`.
- Other test-only Machine Setup siblings under ADR-240's deferral stay for a separate change:
  `MachineSetupDialog.tsx`, `MachineSetupController.tsx`, `GrblLaserSetupPanel.tsx`,
  `SafetyZonesPanel.tsx` and `device-setup/DeviceSetupProbeStep.tsx`.
- No refusal, guard, Start or Frame path changes. Rule 7 / ADR-228 are untouched.

### Verification

- `pnpm build:web` passes. Its `dist/web` is byte-identical to origin/main's `b34289b4c` build:
  `diff -rq` reports no difference across all 237 files, service worker included. The deleted
  code was never shipped.
- The import graph (a TypeScript AST walk of the edges listed in Context) reaches 2,728 modules
  before and after. The unreachable production modules go from 113 to 105, exactly the eight
  deleted here, and none becomes newly unreachable.
- `tsc --noEmit` and `tsc -p e2e/tsconfig.json` pass. Scoped ESLint (`--max-warnings=0`) and
  Prettier pass on every touched file. `check:index-exports`, `check:file-size`,
  `check:adr-numbers` and `check:e2e-discovery` (59 browser suites) pass.
- Vitest over `src/core/job`, `src/core/motion-planner`, `src/io/gcode`, `src/ui/laser` and
  `src/ui/import`: 3,665 of 3,672 tests passed. The machine was CPU-saturated by other sessions,
  and all seven failures were time limits in files this change does not touch: six "Test timed
  out" and one 30 s wall-clock bound in `prepare-output-connected-script.test.ts`, whose
  byte-exact snapshot passed. Those four files pass in isolation (18 of 18). The 12 moved
  motion-planner tests pass.
- NOT verified: nothing ran on hardware, and no e2e suite ran beyond discovery. No surviving
  browser behaviour changed, so the only e2e affected is the deleted one.
