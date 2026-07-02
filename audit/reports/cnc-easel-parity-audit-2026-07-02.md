# CNC/Easel Parity Audit - 2026-07-02

## Scope

Audit target:

- Worktree: `C:\Users\Asus\LaserForge-2.0\.claude\worktrees\elated-edison-157186`
- Branch: `claude/elated-edison-157186`
- CNC implementation commit: `032d476 feat: add CNC router mode`

This audit checks whether the Fable/Claude CNC work is an Easel-equivalent CNC
workflow, and whether the implementation is internally coherent enough to treat
as a real CNC MVP.

## Verdict

Fable built a real CNC/router MVP. It is not just renamed laser UI. The branch
adds CNC machine state, CNC layer settings, CNC toolpath compilation, CNC GRBL
output, CNC preflight, persistence, and UI wiring.

It is not an identical Easel copy and it cannot yet do everything Easel can do.
The largest remaining gaps are import breadth, true V-carving, 3D/STL relief
carving, simulation depth, reusable CNC libraries, tiling, and multi-machine CNC
workflow.

## Findings

### P1: Not full Easel import parity

Easel's public docs say it can import SVG, DXF, STL, fonts, and G-code `.nc`
files. This branch still opens SVG through the file picker and supports drag/drop
SVG plus raster images, but there is no DXF, STL, font-import, or `.nc` import
pipeline.

Evidence:

- `src/ui/app/file-actions.ts:41`
- `src/ui/app/use-import-drag-drop.ts:93`

Reference:

- https://support.easel.com/hc/en-us/articles/35388639766163-File-Import-Guide

### P1: V-bits exist as selectable tools, but true V-carving is not implemented

The tool list includes V-bits and ball-nose bits, but the compiler routes
toolpaths using `tool.diameterMm`. There is no V-bit angle-based variable
width/depth toolpath generation and no two-stage V-carve workflow.

Evidence:

- `src/core/scene/machine.ts:89`
- `src/core/cnc/compile-cnc-job.ts:118`

Reference:

- https://support.easel.com/hc/en-us/articles/360012848873-Easel-Pro-Feature-V-Carve-Projects

### P1: No 3D/STL relief carving

Easel advertises 3D carving and STL import. This branch has 2D polylines,
profile offsets, pocket rings, depth passes, and tabs, but no mesh/STL model
import or 3D relief toolpath generation.

Evidence:

- `src/core/cnc/compile-cnc-job.ts:42`

Reference:

- https://easel.inventables.com/

### P2: Basic Easel-style 2D CAM is present

The branch covers the most important 2D carve modes: outside, inside, on-path,
pocket, and engrave. It also adds per-layer cut depth, depth per pass, feed,
plunge, spindle RPM, stepover, and tabs.

Evidence:

- `src/core/scene/machine.ts:32`
- `src/ui/layers/CncLayerFields.tsx:18`
- `src/core/cnc/compile-cnc-job.ts:146`

References:

- https://support.easel.com/hc/en-us/articles/6380072052371-How-to-change-the-Cut-Path
- https://support.easel.com/hc/en-us/articles/360015957214-Cut-Depth-and-Depth-Per-Pass

### P2: Output path is genuinely CNC-aware

CNC jobs route to `cncGrblStrategy`, which emits spindle commands, safe-Z
retracts, plunge moves, feed moves, spindle stop, and park behavior. This is
materially different from the laser GRBL path.

Evidence:

- `src/io/gcode/emit-gcode.ts:48`
- `src/core/output/cnc-grbl-strategy.ts:70`

### P2: Safety preflight exists, but hardware validation is still missing

The CNC preflight checks depth, feed, spindle, stock, bounds, and Z-up travel.
That is good software safety scaffolding, but it does not prove the emitted
G-code is safe on a real router. This still needs an air-cut or dry run before
trusting it on hardware.

Evidence:

- `src/core/preflight/cnc-preflight.ts:35`

## Implemented Surface

Implemented:

- Laser/CNC mode switch.
- CNC setup panel.
- Bit and stock parameters.
- Per-layer CNC settings.
- Profile, pocket, and engrave CAM.
- Depth passes.
- Tabs.
- CNC GRBL emitter.
- CNC preflight.
- Project persistence.
- Preview and estimate integration.

Not implemented to Easel parity:

- DXF import.
- STL import.
- `.nc` import.
- Font import as a CNC text workflow.
- True V-carving.
- 3D relief carving.
- Two-stage carve workflow.
- Full simulation.
- Tiling.
- Multi-CNC-machine profile management.
- Richer CNC materials, bits, and saved settings.
- Machine parking parity.

## Verification

Recorded verification from the audit passed:

- Focused CNC tests.
- Impacted output and preview tests.
- Full `pnpm test`: 418 files, 2595 tests.
- `pnpm typecheck`.
- `pnpm lint`.
- `pnpm lint:electron`.
- `pnpm format:check`.
- `pnpm license-check`.
- `pnpm audit:deps`.
- `pnpm build:web`.
- `pnpm build:electron-main`.
- `pnpm check:file-size`.

`pnpm release:check` only failed because the repo guard rejects the nested
Claude worktree path, not because of the CNC code.

## Recommendation

This is mergeable as a CNC MVP after product review and hardware dry-run. Do not
market it as "Easel equivalent" yet. The honest label is:

> Basic 2D CNC router mode with profile, pocket, engrave, tabs, spindle/Z-aware
> GRBL, and preflight.
