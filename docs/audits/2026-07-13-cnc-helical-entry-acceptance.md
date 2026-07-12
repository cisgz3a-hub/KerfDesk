# CNC Helical Entry Acceptance - 2026-07-13

## Verdict

This ticket closes the straight-plunge gap for supported offset pockets with a
first-class, native G2/G3 helical entry. It is accepted as a CNC foundation
upgrade, but it does **not** raise the full CNC sector above 9.0 by itself.

Candidate sector movement: **7.5 -> 8.0**. The remaining score blockers are
adaptive/rest clearing, automated inlays, and canvas-draggable tabs.

## User Workflow

1. Switch the project to CNC.
2. Set a closed shape to `Pocket (clear inside)`.
3. Enable `Advanced cut settings`.
4. Keep `Fill method` on `Offset rings`.
5. Enable `Helical entry` and set maximum diameter, minimum fit diameter, and
   ramp angle.

Helical entry and the older along-path ramp are mutually exclusive. Enabling
one removes the other.

## Motion Contract

- The compiler selects a deterministic entry circle inside the supported
  pocket boundary.
- Ramp angle controls the minimum whole-circle revolution count.
- The emitter retracts to safe Z, rapids to the helix start, descends with
  native full-circle G2/G3 moves at plunge feed, links at the reached depth,
  and cuts the pocket contour at cutting feed.
- Preview and estimates include true three-dimensional helix length and its Z
  span.
- Job-origin transforms preserve the start, center, and contour geometry.
- Tiled output converts the helix to clipped XYZ motion with interpolated Z,
  avoiding invalid partial controller arcs at tile boundaries.

## Safety Refusals

The request is blocked before output instead of silently reverting to a
straight plunge when:

- minimum diameter exceeds maximum diameter;
- the requested minimum diameter does not fit;
- the pocket uses raster X/Y clearing;
- a toolpath is open;
- the layer contains disconnected pockets or islands;
- geometry or numeric settings are invalid.

The last two limitations are deliberate in this first ticket. Supporting them
requires component-aware entry-region planning rather than an unsafe guess.

## Verification

- TypeScript typecheck: passed.
- ESLint: passed.
- Focused automated suite: 92 tests passed across planner, compiler, emitter,
  simulator, tiling, preflight, project round-trip, and React controls.
- Live browser acceptance at `127.0.0.1`: created a rectangle, changed it to an
  offset pocket, enabled helical entry, verified the 8 mm maximum / 2 mm
  minimum / 3 degree controls, and opened route plus 3D preview.
- Browser console: no warnings or errors.
- Full repository `pnpm release:check`: passed in 742.3 seconds, including the
  full Vitest corpus, Playwright, web build, Electron typecheck, dependency
  license/security checks, formatting, lint, and repository size policies.

## Research Basis

- Autodesk Fusion 2D Pocket documents helix ramp angle, maximum stepdown per
  revolution, clearance, and maximum/minimum ramp diameters, and requires the
  helix to fit the available cavity:
  <https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-2D-POCKET-CMD>
- Autodesk's empty-toolpath guidance confirms that the helical diameter must
  fit the available slot after cutter diameter is considered:
  <https://help.autodesk.com/view/fusion360/ENU/?caas=caas%2Fsfdcarticles%2Fsfdcarticles%2FTroubleshooting-Empty-Toolpath-and-No-Passes-to-Link-warnings-in-Fusion-360-HSM-CAM.html>
- Vectric documents smooth, zig-zag, and spiral profile ramps and the use of
  plunge rate during ramp entry:
  <https://docs.vectric.com/docs/V12.5/VCarveDesktop/ENU/Help/form/uiProfileMachineForm/index.html>

## Next CNC Tickets

1. Component-aware entry-region planning for multiple pockets and islands.
2. Deterministic adaptive clearing with explicit rest-material modeling.
3. Male/female inlay automation with allowance and glue-gap controls.
4. Drag-placeable tab handles with compiled-position parity.
