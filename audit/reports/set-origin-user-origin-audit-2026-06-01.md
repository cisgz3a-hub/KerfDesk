# Set Origin / Imported Image Origin Audit - 2026-06-01

## Executive Summary

The user's suspicion is correct, but the root cause is more precise than "G92 is wrong."

LaserForge correctly sends `G92 X0 Y0` when the operator clicks Set origin here. The bug is that LaserForge has no job-origin anchoring layer. Imported images are auto-centered on the canvas/bed, and the compiler continues to emit absolute `G90` work coordinates for that centered placement. After Set Origin, the controller's work zero changes, but the job still starts at the image's centered bed coordinates.

In LightBurn terms, LaserForge has the controller part of User Origin but not the paired Start From mode plus 9-dot Job Origin behavior. That mismatch explains the user-visible symptom: a newly imported/traced image feels like it is running from the canvas placement rather than from the imported image at the current head position.

No production code was changed in this audit.

Implementation follow-up: later on 2026-06-01, LF2-SO-H1 was fixed by adding a shared job-origin translation helper and wiring Start/Frame to the adjusted geometry when custom origin is active. LF2-SO-M1 was partially fixed for the known-WCO path by checking physical bounds as `adjusted job bounds + WCO`.

## Scope

Question audited:

- If the operator imports/traces an image, jogs the laser head to the intended workpiece origin, and presses Set origin here, does Frame/Start use the imported image's origin or the canvas/bed placement?

Files and modules inspected:

- `src/core/controllers/grbl/commands.ts`
- `src/ui/state/origin-actions.ts`
- `src/ui/common/image-import.ts`
- `src/ui/state/scene-mutations.ts`
- `src/core/scene/fit-to-bed.ts`
- `src/core/job/compile-job.ts`
- `src/core/output/grbl-strategy.ts`
- `src/ui/laser/JobControls.tsx`
- `src/ui/state/laser-store.ts`
- `WORKFLOW.md`
- `PROJECT.md`
- `DECISIONS.md`
- `LIGHTBURN-STUDY.md`

## References Used

- LightBurn Coordinates and Job Origin: https://docs.lightburnsoftware.com/legacy/CoordinatesOrigin
- GRBL v1.1 Commands: https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Commands
- GRBL v1.1 Interface: https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Interface
- LinuxCNC Coordinate Systems manual: https://linuxcnc.org/docs/stable/html/gcode/coordinates.html
- CNCjs axis UI source sample: https://github.com/cncjs/cncjs/blob/48550474bd6b0bf375997f2d779f1f440b16aa4d/src/app/widgets/Axes/DisplayPanel.jsx

Repo-local context:

- `LIGHTBURN-STUDY.md:843-852` documents LightBurn's Start From modes and Job Origin anchor.
- `LIGHTBURN-STUDY.md:1211-1215` already flags LaserForge's origin model as a divergence.
- `DECISIONS.md:773-821` records ADR-021: G92-only, no compile-pipeline change, origin-aware preflight deferred.
- `WORKFLOW.md:810-873` describes the intended operator flow and claims Frame/Start should run around the workpiece corner.

## Root-cause Trace

### 1. Set Origin only writes G92

`src/core/controllers/grbl/commands.ts:52`:

- `CMD_SET_ORIGIN_HERE = 'G92 X0 Y0'`

`src/ui/state/origin-actions.ts:40-41`:

- `setOriginHere()` writes `G92 X0 Y0\n`.

This is correct GRBL usage for setting the current head position as work coordinate 0,0. GRBL and LinuxCNC references agree that G92 changes the coordinate offset using the current position; it does not move the machine and does not rewrite a program's geometry.

### 2. Fresh imports are centered on the bed

`src/ui/common/image-import.ts:20-28` creates raster bounds at object-local 0,0.

`src/ui/state/scene-mutations.ts:201-208` passes fresh imports through `fitObjectToBed`.

`src/core/scene/fit-to-bed.ts:23-34` keeps small imports at scale 1 and centers their bounds:

- `x = bedWidth / 2 - scale * cx`
- `y = bedHeight / 2 - scale * cy`

Example on the default 400 mm by 400 mm front-left device:

- Imported 50 mm by 30 mm image.
- Object-local bounds: X0..50, Y0..30.
- Centered transform: X +175, Y +185.
- Compiled machine/work bounds: approximately X175..225 and Y185..215.

### 3. Compile keeps absolute bed/work coordinates

`src/core/job/compile-job.ts:138-147` applies object transform plus device origin transform to raster bounds.

`src/core/job/compile-job.ts:231-233` applies the same transform path to vector polylines.

`src/core/output/grbl-strategy.ts:30-37` emits `G90`, so the job is absolute in the active work coordinate system.

There is no step that says "subtract this job's lower-left/center/etc. anchor so the imported image starts at work coordinate 0,0."

### 4. Frame uses the same unanchored bounds

`src/ui/laser/JobControls.tsx:223-249` compiles the job, computes bounds, runs `framePreflight`, then calls `frame(bounds, feed)`.

`src/ui/state/laser-store.ts:332-343` sends frame corners as:

- `$J=G90 G21 X... Y... F...`

GRBL's jog command uses the work coordinate frame unless `G53` is used. Therefore after `G92 X0 Y0`, framing a centered import still asks GRBL to jog to X175/Y185 relative to the user-set origin, not around X0/Y0.

## Findings

### LF2-SO-H1 - Set Origin does not anchor imported or traced job bounds to the user-set origin

Severity: High

Confidence: High

Trigger path:

Import an image or trace an imported image, leave it at its auto-centered bed placement, jog the head to a workpiece corner, press Set origin here, then press Frame or Start.

Failure mode:

LaserForge sends `G92 X0 Y0`, but still compiles and frames the job at the object's absolute canvas/bed coordinates. For a centered 50 mm by 30 mm import on a 400 mm by 400 mm bed, the emitted work-coordinate bounds are around X175..225 and Y185..215 instead of X0..50 and Y0..30 relative to the user-set origin.

Consequence:

The frame/burn is offset from the physical point the operator selected. The job can miss the material, appear to use the canvas origin rather than the imported image origin, and move unexpectedly far from the current head position.

Concrete fix:

Add explicit Start From and Job Origin semantics matching LightBurn:

- Absolute Coordinates: preserve current behavior.
- User Origin: use the stored/controller origin as the physical placement point.
- Current Position: use current head position as the physical placement point.
- Job Origin: 9-point anchor on job or selection bounds.

Implementation shape:

- Compile the job once.
- Compute the job/selection bounds anchor in machine/work coordinates.
- For User Origin and Current Position modes, translate all emitted job geometry and frame geometry by the negative anchor point.
- Make preview, Frame, Start, duration, and preflight consume the same origin-adjusted job.
- Add a regression test proving a centered imported raster under User Origin lower-left produces output bounds near X0..width and Y0..height, not centered bed coordinates.

### LF2-SO-M1 - Frame and preflight are not origin-aware when a G92 work offset is active

Severity: Medium

Confidence: High

Trigger path:

Set a custom origin near a machine edge, then frame or start a job whose compiled scene bounds fit within the nominal bed.

Failure mode:

`framePreflight` checks only compiled job bounds against device bed size. It does not include the active WCO/G92 offset, while frame jogs are sent in work coordinates with `$J=G90`.

Consequence:

A job can pass the app's bounds check while the physical machine path is shifted by the active work offset. The documented mitigation that Frame reveals post-WCS risk is incomplete unless frame/preflight compute the same physical path the controller will execute.

Concrete fix:

Thread active WCO/origin state into Frame/Start preflight, or require/query a fresh WCO before origin-sensitive actions. Compute physical machine extents for active User Origin mode and block or warn before sending jog/job lines. Share the origin-adjusted geometry helper introduced for LF2-SO-H1 so preview, frame, start, and safety checks cannot diverge.

## Rejected Findings / Non-findings

- `G92 X0 Y0` itself is not the bug. It is a valid transient work-coordinate origin command for GRBL.
- The WCO cache strategy is not the main cause of this symptom. GRBL reports WCO intermittently; caching is expected.
- The trace algorithm is not involved in this specific Set Origin symptom. Traced vectors inherit the source raster placement, so they expose the same placement model problem as imported rasters.

## Recommended Fix Order

1. Add an origin-placement model in core, not just UI state:
   - `startFrom: 'absolute' | 'current-position' | 'user-origin'`
   - `jobOriginAnchor: 9-point anchor`
2. Add a pure helper that takes a compiled job plus origin mode and returns origin-adjusted geometry.
3. Move Frame, Start, preview, duration, and preflight onto that shared helper.
4. Add regression tests before UI polish:
   - centered imported raster + User Origin lower-left
   - traced vector over raster + User Origin lower-left
   - center anchor
   - Absolute Coordinates unchanged
   - WCO-shifted physical preflight near bed edge
5. Update `WORKFLOW.md`, `DECISIONS.md`, and `LIGHTBURN-STUDY.md` after code is fixed.

This is a real behavior bug, not a documentation-only mismatch. The smallest safe fix is not to change `G92`; it is to add the missing job-origin anchoring layer and make all emitted/previewed/framed geometry pass through it.
