# Fill Hatch Edge Burn Research and Plan

Date: 2026-06-01
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: visible side burn marks on a successful traced/logo fill burn.
Photo evidence: `C:\Users\Asus\Downloads\191275.jpg`

## Research Inputs

- LightBurn Fill Mode documentation: Fill scans line by line inside
  closed shapes. Its Overscanning section says extra moves at the
  beginning and end of each line let the head accelerate before firing
  and decelerate after firing. Source:
  https://docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Fill.html
- LightBurn Dark & Burned Edges troubleshooting: darker Fill/Image
  edges are attributed to missing or incorrect overscanning. Source:
  https://docs.lightburnsoftware.com/Troubleshooting/JobQuality/BurnedEdges.html
- LightBurn Overscanning explainer: overburn happens when the laser is
  still firing while the gantry slows at scan-line ends; the fix is
  laser-off acceleration/deceleration runway outside the engraved area.
  Source: https://docs.lightburnsoftware.com/2.1/Explainers/Overscanning/
- LightBurn shared GRBL settings: LightBurn defaults GRBL devices to
  Variable Power mode (`M4`) and treats Constant Power (`M3`) as a
  compatibility option. Source:
  https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SharedSettings/
- GRBL v1.1 documentation: `$32` laser mode allows continuous motion
  with instantaneous S changes; `M4` dynamic laser power scales output
  with speed. Source: https://github.com/gnea/grbl and
  https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md

## Local Evidence

- `src/core/job/fill-hatching.ts` produces correct two-point scanline
  hatch polylines, alternating direction by scanline. It does not and
  should not add burn runways; it is pure geometry.
- `src/core/job/compile-job.ts` currently converts Fill layers into the
  same `CutGroup` shape used by Line layers.
- `src/core/output/grbl-strategy.ts` emits every `CutSegment` as:
  rapid to boundary with `S0`, then first active `G1` with positive `S`.
  There is no feed-speed lead-in or lead-out for Fill hatches.
- `src/core/raster/emit-raster.ts` already solves this class for Image
  mode: it rapids to an overscan point, moves to the active span with
  `S0`, burns the active span, and exits to overscan with `S0`.

## Findings

### P1 - Fill hatches burn while accelerating at shape boundaries

- **Files:** `src/core/job/compile-job.ts`,
  `src/core/output/grbl-strategy.ts`
- **Trigger path:** trace/import vector logo -> set layer to Fill ->
  generate G-code -> burn at 30 percent power on wood.
- **Failure mode:** each hatch starts and stops exactly on the filled
  shape boundary. The first active feed move carries positive `S`, so
  the boundary receives heat while the gantry is still accelerating.
- **Consequence:** darker side halos and edge scorch, especially on
  dense small text and adjacent hatch endpoints.
- **Severity:** Medium. Job is usable and geometry is correct, but
  output quality is visibly below LightBurn-style fill.
- **Confidence:** High. The photo matches the reference failure mode,
  and the local fill output path lacks the overscan logic already
  present in Image mode.
- **Fix:** give Fill hatches an output-specific overscan path:
  `G0 leadStart S0`, `G1 burnStart S0`, `G1 burnEnd Spositive`,
  `G1 leadEnd S0`.

### P2 - Fill is currently indistinguishable from Line at output time

- **Files:** `src/core/job/job.ts`, `src/core/job/compile-job.ts`
- **Trigger path:** any Fill layer compiles to `CutGroup`.
- **Failure mode:** the output strategy cannot tell a Fill hatch from a
  normal vector cut, so a targeted Fill-only fix would either miss the
  hatches or accidentally change Line behavior.
- **Consequence:** applying overscan in the current `CutGroup` path
  would be unsafe for normal outlines and cuts.
- **Severity:** Medium-high for implementation safety.
- **Confidence:** High from direct code inspection.
- **Fix:** add a distinct `FillGroup` in the `Job` union, or an equally
  explicit discriminant, so Fill can be emitted differently while Line
  remains byte-for-byte stable except for union plumbing.

### P3 - Bounds and preview must account for non-burning runway moves

- **Files:** `src/core/job/job-bounds.ts`, `src/core/job/toolpath.ts`,
  `src/core/job/planner.ts`, `src/core/preflight/preflight.ts`
- **Trigger path:** Fill object near bed edge with overscan enabled.
- **Failure mode:** if overscan is added only in G-code, Frame/job bounds
  may still show burn bounds while emitted runway coordinates can extend
  outside the bed.
- **Consequence:** either false confidence near bed edges or excessive
  Frame size if burn bounds and runway bounds are mixed together.
- **Severity:** Medium, safety-facing.
- **Confidence:** Medium-high. Raster currently excludes overscan from
  job bounds but preflight catches out-of-bounds emitted G-code.
- **Fix:** keep Frame/job bounds on the burn area, but make preflight
  validate the emitted fill runway coordinates. Preview/toolpath should
  show runway moves as travel, not as burned marks.

### P4 - Material settings still matter

- **Files:** not code-only; operator material calibration.
- **Trigger path:** 30 percent power on wood, dense logo/text features.
- **Failure mode:** high power, slow speed, focus, air assist, and wood
  resin/grain can all darken side marks even with perfect G-code.
- **Consequence:** code can remove acceleration-endpoint overburn, but
  it cannot make the same power/speed behave identically on every board.
- **Severity:** Low for software, medium for operator quality.
- **Confidence:** Medium. The separator lines look cleaner than filled
  dense areas, pointing to a mix of heat accumulation and fill endpoint
  behavior.
- **Fix:** after code overscan, run a small material matrix: same design,
  fixed focus/air, compare 20/25/30 percent power and two speeds.

## Recommended Next Implementation

1. Add `fillOverscanMm` to `Layer` with default `5` mm and a Fill-only
   UI field. Back-fill old `.lf2` files from `LAYER_DEFAULTS`, no schema
   bump.
2. Add a `FillGroup` job discriminant carrying hatch `segments` plus
   `overscanMm`. Keep `CutGroup` for Line unchanged.
3. Add a shared pure helper that expands a two-point hatch into
   `leadStart`, `burnStart`, `burnEnd`, and `leadEnd`.
4. Add a Fill emitter in `grbl-strategy.ts`. It should emit lead-in and
   lead-out at layer feed with `S0`, and put positive `S` only on the
   active hatch motion.
5. Update planner/toolpath/job-bounds handling for `FillGroup`: burn
   geometry remains the framed area; lead-in/out are travel/runway.
6. Keep `M3` for the first implementation to minimize behavioral blast
   radius. Document `M4` variable-power Fill as a second controlled
   hardware experiment, because LightBurn defaults GRBL to `M4` but
   LaserForge currently chose `M3` for line/fill in ADR-020.

## Verification Plan

- Unit-test the overscan geometry helper with horizontal, vertical,
  diagonal, zero-length, and zero-overscan cases.
- Compile-test that Fill layers produce `FillGroup` with `overscanMm`,
  while Line layers still produce `CutGroup`.
- G-code-test Fill output for:
  - lead-in `S0`,
  - active hatch positive `S`,
  - lead-out `S0`,
  - no stationary positive-power command,
  - Line output unchanged.
- Preflight-test a fill near the bed edge where overscan makes the
  emitted G-code out-of-bounds.
- Preview/toolpath-test that fill burn steps still render and overscan
  runway is not treated as burned geometry.
- Hardware-test with the same logo at current settings, then compare
  0 mm, 2 mm, and 5 mm Fill Overscan.

## Residual Risk

- More overscan adds job time and can fail preflight near bed edges.
- Tiny features may still darken because hatch lines are too short to
  reach full speed. If that remains visible after overscan, the next
  experiment is Fill `M4` variable power or Convert-to-Bitmap/Image mode.
- A true LightBurn-parity fill engine also has fill grouping and
  bidirectional controls; this plan intentionally does not add those yet.
