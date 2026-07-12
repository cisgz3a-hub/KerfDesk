# CNC Rest Machining Acceptance - 2026-07-13

## Verdict

This ticket adds real two-bit pocket rest machining. A larger end mill clears
the bulk first; the layer's smaller selected bit then cuts only stock that the
larger cutter could not reach.

Combined with the preceding helical-entry ticket, the CNC sector candidate
moves from **8.0 to 8.5**. This is not labeled adaptive clearing. A true
constant-engagement planner, automated inlays, and canvas-draggable tabs still
block a defensible 9+ score.

## User Workflow

1. Set a closed shape to `Pocket (clear inside)`.
2. Select the smaller finishing/rest bit in the layer's normal `Bit` field.
3. Enable `Advanced cut settings`.
4. Choose a larger end mill in `Rough first`.
5. Preview, export, or run the job normally.

Only larger end mills appear in the selector. Rest machining and helical entry
are mutually exclusive in this release; selecting either removes the other.

## Geometry Contract

1. Union the closed pocket contours into a deterministic region.
2. Inset that region by the roughing cutter radius to find legal rougher-center
   positions.
3. Dilate those center positions by a round cutter footprint to model the
   material actually swept by the rougher.
4. Subtract the swept region from the original pocket to obtain remaining
   stock.
5. Expand only that remainder by the smaller cutter radius.
6. Intersect it with the smaller cutter's legal center region.
7. Generate deterministic centerline rings over that target, innermost first.

This allows the smaller tool to overlap already-cleared space while preventing
its center from leaving the legal pocket region. Islands remain protected.

## Output And Safety

- The roughing tool section is emitted first.
- The smaller rest-tool section follows with one manual M0 tool-change pause.
- Both sections preserve depth ladder, feeds, plunge rate, spindle, coolant,
  safe Z, ramp entry, preview, estimate, origin, and tiling contracts.
- Invalid diameter order, missing tools, open contours, oversized roughers,
  geometry failures, and the temporary helix conflict block preflight.
- An invalid rest request never falls back to machining the whole pocket with
  the smaller tool.

## Verification

- TypeScript typecheck: passed.
- ESLint: passed.
- Focused suite: 60 tests passed across rest geometry, compiler/tool ordering,
  native G-code tool change, preflight, persistence, and React controls.
- Live browser: rectangle -> CNC pocket -> 1.588 mm layer bit -> 6.35 mm
  `Rough first` -> Preview and 3D result.
- Live estimate changed from about 8h 1m to 1h 59m for the acceptance fixture.
- Browser console: no warnings or errors.
- Full repository `pnpm release:check`: passed in 708 seconds, including the
  full Vitest corpus, Playwright, web build, Electron typecheck, dependency
  license/security checks, formatting, lint, and repository size policies.

## Research Basis

- Autodesk defines rest machining as limiting an operation to material a
  previous tool or operation could not remove and requires the previous tool's
  geometry:
  <https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-2D-ADAPTIVE-CMD>
- Autodesk notes that 2D rest machining is tool-diameter based rather than
  full in-process-stock simulation. This implementation makes the same bounded
  2D claim:
  <https://help.autodesk.com/view/fusion360/ENU/?caas=caas%2Fsfdcarticles%2Fsfdcarticles%2FEmpty-toolpath-warning-on-2D-Adaptive-operations-using-rest-machining-and-conventional-milling-in-Fusion-360-MFG.html>
- Vectric's pocket workflow defines multiple tools so the first removes what it
  can and subsequent tools machine previously uncut areas:
  <https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/uiPocketMachineForm/>

## Remaining CNC Tickets

1. True constant-engagement 2D adaptive clearing with bounded optimal load,
   minimum corner radius, deterministic linking, and stock-aware acceptance
   metrics.
2. Male/female inlay automation with allowance and glue-gap controls.
3. Canvas-draggable tab handles with compiled-position parity.
