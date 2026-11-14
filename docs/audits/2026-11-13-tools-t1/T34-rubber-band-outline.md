# T34 Rubber-Band Outline — auditor report
Tree: origin/main @ eeac725e8. Command id: `tools.rubber-band-outline`.

## Map
- **Command:** `src/ui/commands/design-tools-commands.ts:58-74`. It is enabled when anything is selected (`ctx.hasSelection`). Otherwise it is disabled with "Select the artwork to outline first." It sits in the Tools → Vector group (`tools-vector-menu-ids.ts:16`) with no CNC gating. Tooltip: `src/ui/help/design-tools-command-help.ts:41`.
- **Dialog:** none. There is no margin, offset or smoothing option, which matches LightBurn (see below).
- **Store:** `src/ui/state/rubber-band-outline-actions.ts`.
  - The selection is filtered in scene order (l.61), then guarded by `geometryToolSources(..., 'variable')`. Variable text and barcodes are left out with a notice (l.57-67).
  - The core builds the outline. `bindOutline` (l.94-105) then picks the first selected object in scene order whose primary operation has `mode === 'line'` and calls `prepareIndependentArtwork`. If there is none, it creates a new Line operation named "Outline".
  - One undo step and a success toast with the size in mm.
- **Core:** `src/core/geometry/rubber-band-outline.ts` runs Andrew's monotone chain (`convex-hull.ts`) over every materialised world point. Vector objects and text are flattened at 0.025 mm. Images and reliefs contribute their four transformed bound corners. The outline is refused when the hull area is below 1e-4 mm².
- **ADRs:**
  - ADR-480 item 3, whose LightBurn quote I re-checked today: "the shortest possible path…", on the last palette layer, with no margin option.
  - ADR-350 Amendment 2 item 4: rubber-band uses the `variable` guard.
  - ADR-103: the clone-the-operation rule that ADR-480 cites.
- **WORKFLOW:** F-A6e item 1.
- **Changes since 2026-10-16** on the tool's files: `d9b8abf0b` (the Weld guard, which introduced `geometry-tool-sources.ts`) and `89385f65b` (ADR-350 Amd 2, which put rubber-band behind the guard). The T29 refuter's pointer that rubber-band bypassed the guard is **verified fixed** on this tree (C3 below).

## October register re-check
Register row 41 (`tools.rubber-band-outline`): a rectangle gets a hull with 2 objects / 2 operations, and Undo returns to 1/1. **Still holds.**
- D2: Undo returns the identical project object (`===`), going from 3 objects / 2 layers back to 2/1.
- Redo gives a scene that is JSON-equal to the first apply.
- The register's 10,000-rectangle stress has an equivalent here: 3,000 rotated rectangles match the oracle exactly, in 115 ms.

## Checks run
Scripts are in `C:\Users\stolk\kd-t1\zz-t34\`. `t34.test.ts` runs the real store action, `prepareOutput` → `emitPreparedGcode`, the own decoder `decode.ts`, and an own Jarvis-march hull with a point-to-convex-polygon distance as the oracle. Logs: `t34-ABC.log` (sections A–C) and `t34.log` (the last section run). The D–G output is quoted below.

| Check | Method | Result |
|---|---|---|
| A1 two rects, collinear points | oracle hull + decode | 6 vertices, area 600.0000, equal to the oracle; outline lit = ring perimeter |
| A2 ellipse, rotate 33°, mirror X, scale 2.5×0.6 | 20,000-point analytic ellipse | true curve at most 0.0233 mm outside the hull (chords); burned source at most 0.0006 mm outside |
| A3 200 mm circle | analytic | true curve 0.0247 mm outside; area short by 1.345 mm² (chords, KNOWN T26-P2-1) |
| A4 open path, rotated 90° + mirror Y, collinear points | oracle | exact: 4 vertices, area 50 |
| A5 imported cubic + elliptical arc (canonical curves, coarse compatibility polyline) | analytic Bezier + arc samples | 51 vertices, true curve 0.0247 mm outside; burned art 0.0006 mm |
| A6 text "Ag8%@Q", rotated 200°, mirrored, non-uniform | stored glyph points + burn | 0.0139 mm outside the stored points; burn 0.0004 mm |
| A7 image rotated 30°, mirrored, scale 1.5 | corner oracle + burned raster | hull = rotated rectangle exactly; burned raster rows reach 0.042 mm outside (rasterisation of a rotated image, not this tool) |
| A8 image + rect | oracle | exact |
| B1 one point, B2 one line, B3 two collinear lines | store | refused, warning "lies on one straight line", no undo entry |
| B4 0.008 mm square | store | refused with the "straight line" wording (P3-2) |
| B5 50 × 0.0015 mm sliver | store | accepted (P3-2) |
| B6 3,000 rotated rects | oracle | 21 vertices, area equal, 0 outside, 115 ms |
| C1 group: click one member | `selectObject` | selects both members; the hull covers the group |
| C2 locked object + object on a hidden operation, explicitly selected | store | both included (110×110); Select All excludes them |
| C3 variable text "SN {{serial:4}}" + rect | store | text left out; info toast; hull is the rect only. The hull is **not** sized to the template, which renders 121 mm wide against 74.5 mm for "SN 0042" |
| C3b variable text alone | store | refused with a warning, nothing added |
| D1 Line source with an override + powerScale | decode | outline burns at the operation's base settings (P2-1) |
| D2 Undo / Redo | store | exact |
| D3 save → reopen | serialize/deserialize + G-code | byte-identical G-code |
| D4 selection order vs scene order | store | the scene-order first source wins (P3-3) |
| D5 Offset Shapes on the same source (the rule ADR-480 cites) | store + decode | Offset keeps the override (F300/S450) |
| D7 cut order (two Fill squares, fill ellipse, line rect) | decode | outline runs **after** the engraving in every case (artworkOrder kept in sync) |
| E/F CNC project (`cncToolSectionProject`) | store + Z/XY decode | outline copies a **pocket** operation (P1-1) |
| G first Line source is output-off | decode | outline copies output=false and burns nothing (P2-1) |
| LightBurn docs `CreateRubberBandOutline/` | WebFetch | outline on the last palette layer; no margin; hidden/locked not covered |

## Findings

### T34-P1-1: In a CNC project, Rubber-Band Outline can copy a Pocket (or V-carve) operation, so the outline clears the whole hull instead of cutting around the parts
- **Severity:** P1, because it is a wrong cut that harms the job.
  - The outline is meant to be a cut-around (the action's comment says "so it cuts like the artwork's own outline").
  - Instead, the machine mills the entire convex area, including the face of every selected part, to the pocket depth.
  - The canvas does show a new operation with the copied cut type, and the refuter may lower this to P2 on that basis, as T33-P2-1 was lowered. The harm is still material removal over the whole part, not a power mismatch.
- **Where:** `src/ui/state/rubber-band-outline-actions.ts:99-102`.
  - `bindOutline` treats any operation with `mode === 'line'` as a "Line operation". In CNC, pocket, profile and V-carve operations all have mode `line` and differ only in `cnc.cutType`.
  - The source is the first selected object **in scene order** (l.61), not the one the user picked.
  - `prepareIndependentArtwork` (`vector-path-actions.ts:326-366`) clones the source operation, including `cnc`.
- **Repro:** `zz-t34/t34.test.ts`, tests E and F (`-t "F\."`). The fixture is `src/__fixtures__/cnc-tool-programs.ts` `cncToolSectionProject()`, which has a pocket artwork (20..45 mm, tool B 2 mm) and a release profile-outside (10..60 mm, tool A 6 mm).
  - **Select release only:** the outline gets profile-outside. Outline alone: `cutXY=224.0mm bbox=[7.0,7.0..63.0,63.0]`. This is correct, a cut around the part.
  - **Select release + pocket, in either order:** the outline gets `{"cutType":"pocket","toolId":"B","depthMm":1}`. Outline alone: `cutXY=945.6mm bbox=[11.0,11.0..59.0,59.0]`. The whole 50 × 50 mm hull is pocketed 1 mm deep.
  - No notice is shown beyond the normal success toast.
- **Oracle:**
  - Expected: a profile around the hull, about 4 × 56 mm = 224 mm at the tool-offset boundary. That is what the profile source produces.
  - Actual: 945.6 mm of area clearing inside the hull.
  - ADR-480's intent is a cut line ("the outline takes a copy of the first selected artwork's Line operation settings"), and LightBurn's documented use is "cut lines around images or complex artwork".
- **Suggested fix:** In CNC, pick only a profile operation (`cnc.cutType` starting with `profile`, or `undefined`) as the source. Otherwise create a new profile-outside operation, or refuse with a notice. Add a test with a pocket source first in scene order.

### T34-P2-1: The outline's operation drops the source artwork's override and power scale, and inherits an output-off source, chosen silently by scene order
- **Severity:** P2. It is a wrong burn with no warning: the outline does not cut through, or does not burn at all. The new operation is visible in Cuts / Layers, and nothing burns outside the art.
- **Where:**
  - `src/ui/state/rubber-band-outline-actions.ts:94-105`.
  - `prepareIndependentArtwork` → `effectiveOperationForObject(source, artwork)` at `vector-path-actions.ts:347` takes the override from `artwork`, which is the new outline. The outline never carries the source's `operationOverride` or `powerScale`.
  - Offset Shapes, which ADR-480 cites as the rule ("the ADR-103 offset rule"), copies both onto its result (`offset-shapes.ts:300-303`). Its operation therefore bakes the override in.
  - The `...withoutRuntimeBinding` spread copies `output: false`.
- **Repro:** `zz-t34/t34.test.ts`, test D (`-t "D\."`) and test G.
  - **Override:** source rect `a` sits on Line L (20 %, 1500 mm/min) with an override of power 90 / speed 300 and powerScale 50. The source burns at `F300/S450`.
    - Rubber-band outline: operation `{power:20, speed:1500}`. Burn after: `F300/S450 > F1500/S200`, so the outline is cut at F1500/S200.
    - Offset Shapes from the same source: operation `{power:90, speed:300}` with powerScale 50, burning `F300/S450`.
    - With the override, the outline gets 44 % of the source's S at 5 times its feed, so it will not cut through.
  - **Output-off:** a guide rect sits on an output-off Line operation and a cut ellipse on a 95 % Line operation. Select both and run the tool.
    - The outline operation is `{"output":false,"power":5}`.
    - Lit length is 110.483 mm before and 110.483 mm after. The 280 mm outline never burns.
    - The toast says "Added a rubber-band outline around 2 objects (80 × 60 mm)."
- **Oracle:**
  - The source's effective settings, which are what burns for the artwork the outline is "cut like".
  - ADR-480's cited ADR-103 rule, as Offset Shapes implements it.
- **Suggested fix:** Pass the source's `operationOverride` and `powerScale` into the outline, as `offsetShapes` does, or clone from `effectiveOperationForObject(sourceOperation, lineSource)`. Skip output-off operations when choosing the source. Say which operation was copied in the success toast.

### T34-P3-1: Variable text is left out of the outline, and the notice does not say that the outline does not go round it
- **READ + run (C3):** `rubber-band-outline-actions.ts:57-67`. The info toast reads "Variable text was left as text: use Bake Variable Text first to fix its value." That wording comes from Convert to Path and does not tell the user the band does not enclose the text. The test shows the outline is the rect only, while the text sits 30 mm below it.
- This is by design (ADR-350 Amd 2: "The outline goes round the rest of the selection"). LightBurn includes all selected graphics.
- A hull is a new object, so the template-glyph risk does not apply. The template hull (121 mm for "SN {{serial:4}}" against 74.5 mm for "SN 0042") would be a safe superset of every value. Maintainer decision: include the template extent, or change the wording to "…was left out of the outline".

### T34-P3-2: Tiny shapes are refused as "on one straight line", while a sliver is accepted
- **Run (B4, B5):** `rubber-band-outline.ts:21,30` uses an area threshold (1e-4 mm²), not a width.
  - A 0.008 mm square gets "The selection has no area to outline: it lies on one straight line." It is not a line.
  - A 50 × 0.0015 mm sliver is accepted and burns as a doubled 50 mm line ("50 × 0.002 mm").
- Suggested: test the hull's minimum width, and word the refusal "too small or on one straight line".

### T34-P3-3: "First selected" means first in scene order, not the order the user selected
- **Run (D4):** select `c` (on L2, 77 %) first, then `a` (on L, 20 %). The outline takes L (20 %), because `scene0.objects.filter(...)` sets the order (l.61).
- ADR-480 and WORKFLOW F-A6e say "the first selected". The same pattern was ledgered for Offset (T33-P2-1). It is the mechanism behind P1-1 and P2-1, so it is raised here only as the wording or test gap.

## Not a defect / limits
- **Hull geometry is correct** against an independent hull in every case: transforms including mirror and non-uniform scale, open paths, collinear points, text, images, groups and 3,000 objects. The true curve lies up to 0.025 mm outside the hull because curves are flattened to chords at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM`. The burned artwork is flattened the same way and stays within 0.0006 mm. This is KNOWN T26-P2-1 and not re-raised.
- **Images** contribute their transformed corners, which is a superset when a mask or clip applies. A rotated raster's burned rows reach 0.042 mm past its rotated rectangle. That comes from raster rasterisation (5 lines/mm), not this tool.
- **Hidden or locked artwork**, when explicitly selected, is included (C2). Select All excludes both. LightBurn outlines "all graphics in your selection".
- **Cut order:** the outline's operation is appended last, and with Inside-first the outline cuts after the engraving it surrounds (D7a/b/c). An early run showed the outline first, but that was a harness artefact (`artworkOrder` not synced). It is not a defect.
- **Stroke envelopes** (`strokeWidthMm`) are ignored by the hull. They burn only for CNC V-carve, where the envelope would extend half a stroke beyond the hull. This is READ ONLY and not raised.
- **No margin option.** LightBurn has none either (its docs link to Offset Shapes).
- **Variable barcode** is guarded by the same code path as variable text. I read it but did not run it separately.
- **Not checked:** browser and keyboard use of the menu entry (there is no dialog); the Pro admission path (`committed === false`); rotary.

## Totals
Raised 5; P1 1; P2 1; P3 3; known 1 (T26-P2-1 curve chords, not re-raised; the T29 guard-bypass pointer is verified fixed by #1900 / `89385f65b`).
