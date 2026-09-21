# Coordinate maths and placement audit

Audit baseline: `288ad66baf23e0c75c0a05f6216787577ddc6812` (`origin/main` at worktree creation). Worktree: `D:\LaserForge\audit-coordinates-origin-20260921`. This sub-audit changed tests and evidence only. No controller, machine, saved user profile, provider or publication state was changed.

## Result

The current five device-origin transforms and nine physical job anchors agree across laser and CNC compilation, emitted XY words and preview registration in the independent matrix. Raster orientation also agrees for the tested rotation, mirror and scale combinations. Two coordinate-model defects remain open: native negative GRBL machine coordinates are not converted to the app's bed frame for display/advisories; contour runways assume a positive bed even on the centre-origin profile.

These are software conclusions. They do not establish the user's Falcon model, installed firmware, actual homing convention, configured travel, WCO or physical movement. The centre-origin runway defect is specific to the 4040-safe contour-entry policy; ordinary Falcon profiles do not enable that policy.

## Positive checks

- Existing focused coverage: 14 files / 113 tests covering origin inverse transforms, jog directions, bed bounds, physical anchors, registration-jig placement, scan-offset-aware placement, rotated raster compilation, scene preview mapping, GRBL native envelopes and contour entries.
- Independent correctness matrix: 440 cases in `src/core/job/coordinate-origin-audit.test.ts`.
  - 180 laser cases: five origins × nine anchors × four placement modes.
  - 180 CNC cases over the same matrix, with cutter-radius-inclusive placement bounds.
  - Both sets check an asymmetric off-centre shape against an explicit physical-bed algebraic oracle, the prepared translation, actual emitted XY words and preview registration.
  - 80 raster cases: five origins × four quarter-turn rotations × two X-mirror states × two Y-mirror states. An asymmetric six-pixel image is scaled non-uniformly, and each source pixel centre is checked in the compiled machine raster grid.
- Separate defect evidence: three characterisation tests in `src/core/job/coordinate-contract-reproductions.test.ts`. Their passing assertions reproduce the two open defects. They are not counted as correctness cases or repaired regressions.

The first matrix harness used exact equality for CNC preview vertices. Its 120 failures were all the documented controller representation boundary: 0.001 mm emitted coordinates and Float32 parser representation. The corrected independent check allows 0.00055 mm per axis (half the output quantum plus Float32 error) and still requires the exact independently derived job-origin offset. The initial log is retained, rather than presenting that harness revision as a production repair.

## Open finding C-M1: native GRBL MPos and positive bed coordinates are conflated

**Scope and effect:** display and advisory calculations on controllers using native negative machine space. This evidence does not prove misplaced emitted work coordinates or a faulty Falcon installation.

Stock GRBL's homing implementation sets the machine travel into negative space regardless of switch corner unless its force-origin compile option is enabled. The app models this distinction correctly in `src/core/controllers/grbl/machine-envelope.ts:19`, including `$23` and the force-origin option. Ordinary bed bounds instead come from `src/core/devices/machine-bounds.ts:12`, which returns `[0,width] × [0,height]` for every corner origin.

`src/ui/state/canvas-motion-plan.ts:336` converts a work point to native MPos using WCO, then directly passes those numbers to the positive-bed inverse transform. Reproduction with a 358 × 268 mm front-left convention:

- Conventional physical point: 50 mm right and 30 mm back from the bed front-left.
- Work point `(50,30)`, WCO `(-358,-268)`, native MPos `(-308,-238)`.
- Expected scene point `(50,238)`; actual displayed point `(-308,506)`.

The separate preflight reproduction emits a 60 × 40 mm User Origin rectangle with WCO `(-300,-100)`. Every emitted XY destination, including parking, is inside the independently derived native travel `[-358,0] × [-268,0]`; `out-of-bed` advisories still appear because the check compares the negative native points to the positive bed. The affected laser check is `src/core/preflight/preflight.ts:358`; CNC uses the same profile bounds model.

**Recommended design:** represent native controller machine coordinates, work coordinates and physical bed coordinates separately. Establish a native-to-bed mapping from verified controller convention and setup evidence before drawing a trusted bed overlay or applying bed/no-go advisories. Reuse the existing native-envelope derivation where applicable. Do not infer axis signs or force-origin firmware from the physical homing corner. Keep ordinary Start policy unchanged. This requires a shared mapping for display, advisory bounds and any controller-to-canvas capture workflow, rather than a local sign flip.

Primary evidence checked during this audit:

- [GRBL limits.c](https://github.com/gnea/grbl/blob/master/grbl/limits.c#L344-L363): native position assignment after homing.
- [GRBL config.h](https://github.com/gnea/grbl/blob/master/grbl/config.h#L112-L115): default negative machine space and the force-origin option.
- [GRBL interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface#real-time-status-reports): `WPos = MPos - WCO`; position and WCO report units follow `$13`.

## Open finding C-M2: contour-entry clipping uses the wrong bed origin

**Scope and effect:** 4040-safe Line and Follow Shape contour entries on centre-origin devices. The burn path can fit the bed while its generated laser-off entry exceeds the bed edge. Frame includes the actual added motion and preflight warns about it; the reproduction does not establish a hidden discrepancy between Frame and Start.

`src/core/job/contour-entry.ts:39` defines a bed by width/height with an implicit zero minimum. `bedBoundedLeadMm` clips against those implicit bounds. The emitter supplies only width and height at `src/core/output/grbl-strategy.ts:168`; Frame bounds, preview and planner share the same assumption.

Reproduction on a 400 × 400 mm centre-origin bed:

- Actual allowed X is `[-200,200]`.
- A burn segment from `(198,30)` to `(188,30)` is inside that bed.
- Its requested 5 mm tangential entry starts at `(203,30)`, which the `[0,400]` clamp incorrectly accepts.
- The emitted program contains `X203.000 Y30.000`; the motion bounds have maxX 203 while artwork bounds have maxX 198.

**Recommended design:** carry explicit entry bounds in the same coordinate frame as the prepared program, shared by emission, Frame bounds, preview and timing. Absolute centre-origin output can use `machineBoundsForDevice`; translated User/Current/Verified placements need the corresponding placement/WCO context, or an explicitly unknown physical envelope. The current Job + Device-only consumer API cannot distinguish Absolute from a translated job. A global centre-origin clamp change would also change relative-placement output, so no partial production fix was made during this audit. This seam should be resolved once for all consumers, preserving Frame policy.

Governing contract: ADR-239 requires contour entries bounded by available bed space, and requires emitter/Frame/preview/planner parity. ADR-327 requires anchor names to denote physical corners. The positive anchor matrix agrees with ADR-327; the centre-origin entry reproduction violates the ADR-239 bed-space requirement.

## Evidence and commands

- `evidence/coordinate-baseline-tests.txt`: first 11 existing files, 70 tests.
- `evidence/coordinate-independent-matrix-initial-exact-comparison.txt`: initial over-strict CNC vertex equality harness.
- `evidence/coordinate-independent-matrix.txt`: corrected 440-case matrix plus the then-colocated two characterisations, 442 tests.
- `evidence/coordinate-independent-matrix-final.txt`: intermediate 443-case file plus 43 existing native-envelope/contour-entry tests, 486 tests.
- `evidence/coordinate-final-separated-tests.txt`: final separate correctness matrix, explicit reproductions and the 43 relevant existing tests.
- `evidence/coordinate-lint.txt`: scoped ESLint result.

Final focused command:

```powershell
node node_modules/vitest/vitest.mjs run src/core/job/coordinate-origin-audit.test.ts src/core/job/coordinate-contract-reproductions.test.ts src/core/job/contour-entry.test.ts src/core/job/compile-job-contour-entry.test.ts src/core/controllers/grbl/machine-envelope.test.ts --maxWorkers=1
```

No hardware, air cut or material test was performed. No release or deployment claim is made.
