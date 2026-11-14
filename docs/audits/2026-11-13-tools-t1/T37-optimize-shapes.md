# T37 Optimize Shapes — auditor report
Tree: origin/main @ 975631408 (`C:\Users\stolk\kd-t1\t36-main`). Command id: `tools.optimize-shapes`.

## Map
- Command: `src/ui/commands/optimize-shapes-commands.ts` (enabled with any selection) → `OptimizeShapesDialogHost.tsx` → `OptimizeShapesDialog.tsx` + `OptimizeShapesFields.tsx` (Smooth 0.25 mm, Corner 30°, Fit 0.05 mm, "Lines, arcs and curves" / "Lines and arcs only"; remembered for the session) → live plan `use-optimize-shapes-preview.ts` (30 ms slices) → `optimizeSelectedShapes` (`src/ui/state/optimize-shapes-actions.ts`), which reuses the dialog's plan per object when the options and object identity match (`planReusing`, `optimize-shapes-plan.ts:123-136`).
- Selection: `optimizeShapesSelection` (`optimize-shapes-plan.ts:62-77`): any object with `paths`, minus registration boxes and boolean compounds; locked counted and left. It does **not** call `geometryToolSources` (`geometry-tool-sources.ts`), unlike Convert to Path, Weld, Offset, Cut/Trim, Warp.
- Result: `optimizedPaths` (`optimize-shapes-plan.ts:154-166`): imported/traced keep their object (`{...object, paths}`); a drawn polyline stays one if possible; text and other drawn shapes become `localPathArtwork(object)` with `paths: result.paths` (line 165). Tabs: `withTabsFollowingEdit` (line 150, ADR-494 Amd 3).
- Core: `src/core/geometry/shape-optimize/` — `optimize-object.ts` (per contour, ids/places kept), `optimize-contour.ts` (world-mm sampling, corners, Gaussian twicing smoothing, `fitRun`, back to local via `local-pieces.ts`, which maps arcs to elliptical arcs under non-uniform scale), `outline-deviation.ts` (two-way distance for the status/toast).
- ADRs: ADR-499 item 7 (LBG-T22), ADR-494 Amd 3 (tabs), ADR-319 Amd 1 (mentions Optimize keeps exact curves via `localPathArtwork`), ADR-609 (worker; Optimize stays time-sliced).
- Changes since 2026-10-16 on these files: 313cea95a (#1522, tabs follow Optimize, ADR-494 Amd 3), ab3226fd1 (C2-P3-1 helper sharing).
- LightBurn (docs "Optimize Selected Shapes", 2.2): smooth + fit to lines/arcs; **text and primitive shapes must be converted to paths first**; the docs warn smoothing may lose "small details". It does not remove duplicate or overlapping lines either (those are Delete Duplicates and the Cut Planner's Remove overlapping lines, ADR-499 item 8 in KerfDesk).

## October register re-check
Row 44 (2026-10-16): world tolerance, cancellation, Apply toast, exact Undo.
- World tolerance: still holds. Smooth off, Fit 0.05 on a noisy r 10 circle at rot 20° / 3 × 0.5 / mirror X: oracle 0.046 mm on the decoded burn (t37a A). At scale 0.1: 0.047.
- Apply toast and Undo: every t37a run Undo returns the exact previous project object, Redo repeats it, and save → reopen burns the same (26/26 cases).
- Cancellation: READ (`use-optimize-shapes-preview.ts` drops old work on new settings; the dialog's Cancel only closes). Existing `OptimizeShapesDialogHost.test.tsx` passes.

## Checks run
| Check | Method | Result |
|---|---|---|
| Existing suites (tabs, actions, dialog host, contour, object, deviation) | Vitest, 6 files | 30/30 pass |
| Fitted outline vs source, Smooth off, tol 0.005 / 0.05 / 1, lines-arcs and curves | t37a A: own two-way distance on decoded G-code (`oracle.ts`, own G1 decoder) | within tolerance + 0.025 machine flattening at every scale/rotation/mirror; toast figure agrees with oracle to ≤ 0.016 mm |
| Default Smooth on large shapes | t37a A, B | r 10 circle mean radius 10.004 (no shrink); text 20 mm moved 0.074, toast 0.074 |
| Tolerance in mm after scale | t37a A (3 × 0.5, 0.1) | yes, world mm |
| Open path ends | t37a C | both ends move < 1e-14 mm |
| Same outline on two layers (overlap across operations) | t37a C2 | both kept, each layer burns 62.776 mm; nothing deleted |
| Pierces / travel | t37a | pierce count unchanged in every Line case; travel within 0.02 mm (text 20 mm: −8 mm) |
| Variable text / variable Code 128 | t37a D, `prepareOutputSnapshot` with Roboto renderer | **P1-1** |
| Text fill rule after conversion | t37b G, grid oracle nonzero vs even-odd | **P1-2** |
| Small closed contours, small text | t37b F, t37c I | **P2-1** |
| Degenerate input (equal points, 2-point closed, retrace, collinear, duplicate points, r 600, figure-8) | t37a E | no throw, no NaN; collinear 50 points → 1 line; retrace stays 20 mm |
| NaN / −3 / Infinity options via the store | t37a E | clamped to defaults/range, applies |
| Locked + unlocked, preview == Apply, stale plan, object edited since plan | t37b H | locked left (toast says so); preview object equals applied; stale options/edited object recomputed |
| Inheritance | t37a B | operation, override, ids kept; text/shape `name` dropped (P3-1) |
| Lines-and-arcs with `laserArcMoves: 'on'` | t37c J | 0 G2/G3 before and after on the default device (see limits) |

Scripts: `C:\Users\stolk\kd-t1\zz-t37\t37a.test.ts`, `t37b.test.ts`, `t37c.test.ts`, `oracle.ts`, `decode.ts`; logs `t37a.log`, `t37b.log`, `t37c.log`. Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t37/vitest.config.mts --maxWorkers=1 t37a`.

## Findings

### T37-P1-1: Optimize Shapes rebuilds variable text into its template glyphs and freezes variable barcodes
- Severity P1: wrong burn on every record. The burn changes from the record value to the literal braces, and the serial stops advancing. The toast only says "1 text object was converted to a path". This is the twin of T26-P1-1 / T28-P1-1. The #1882/#1900 guard is not used here.
- Where: `src/ui/state/optimize-shapes-plan.ts:62-77` (`optimizeShapesSelection` has no `objectVariableTemplate` / `geometryToolSources(…, 'variable')` check); `:165` converts text and barcodes with `localPathArtwork`.
- Repro: `zz-t37/t37a.test.ts` case D. Variable text "SN {{serial:4}}" (Roboto 10 mm at 50,50), default options, store `optimizeSelectedShapes`, then `prepareOutputSnapshot` → G-code:
  - before: serial 42 lit 212.520 mm (bbox maxX 87.241), serial 43 213.472;
  - after: kind `imported-svg`, source "Text: SN {{serial:4}} (paths)", serial 42 **and** 43 both lit 349.785 mm, bbox maxX 110.522.
  - Variable Code 128 "LOT-{{serial:3}}" with a caption: before 1020.191 / 1022.982 mm for serials 41 / 42; after it is `imported-svg`, and both serials burn 1020.014 mm, so the code is frozen. Toast: "1 drawn shape was converted to a path". The caption's curves change, so the whole barcode converts.
- Oracle: rendered "SN 0042" outline length 212.782 mm, which matches the before burn. The after burn matches the template glyphs (bbox to x 110.5, the same as T26/T28's template render).
- Suggested fix: filter targets through `geometryToolSources(scene, …, 'variable')` and add `geometryToolSkippedNotice` to the status line and the toast. Add the variable-text and barcode cases to `optimize-shapes-actions.test.ts`.

### T37-P1-2: Text converted by Optimize Shapes loses its non-zero fill rule, so overlapping glyphs burn with unburned gaps
- Severity P1: wrong burn under Fill with default settings and no warning. Script fonts whose letters overlap at the joins (the typical name-engraving case) and tight or negative letter spacing leave the overlap unengraved. Convert to Path keeps non-zero (`localPathArtwork`'s `textPath`), but Optimize throws that away.
- Where: `optimize-shapes-plan.ts:165` `{ ...localPathArtwork(object), paths: result.paths, bounds }`. `result.paths` are the text's raw paths without `fillRule`, so `textPath`'s `fillRule: 'nonzero'` is overwritten. The fill then falls back to even-odd for a non-text object (`src/core/job/layer-fill.ts:231`, `fill-material-components.ts:57`).
- Repro: `zz-t37/t37b.test.ts` case G. Fill layer, 0.05 mm hatch, default options:
  - Roboto "OO", letter spacing −0.35: burn area 121.453 → 114.532 mm². Oracle non-zero 121.733, even-odd 115.520.
  - Great Vibes "Hello": 155.884 → 153.528 (oracle non-zero 156.381, even-odd 154.693).
  - Dancing Script "mill": 98.162 → 97.395 (98.468 / 97.837).
  - Alex Brush "Anna": 114.637 → 114.308 (114.812 / 113.784).
  - Result `fillRule` is undefined on every path.
- Oracle: own scan-line grid area of the source glyph contours under non-zero vs even-odd (`decode.ts gridArea`). The loss after Optimize equals the even-odd minus non-zero difference.
- Suggested fix: for text, map `result.paths` through the same `textPath` (or set `fillRule: 'nonzero'` where absent) in `optimizedPaths`. Add a fill-area test with overlapping glyphs.

### T37-P2-1: Default smoothing erases dots and punctuation in small text and any closed contour under about 0.2 mm, and shrinks contours up to about 0.6 mm
- Severity P2: a wrong result with limited reach, on default settings. The toast's "nothing moved more than 0.13 mm" is technically true, but it does not say features vanished. The Smooth tooltip ("curves keep their size") and ADR-499's "smoothing does not shrink shapes" are false for contours near the smoothing distance. LightBurn's own docs warn that smoothing may lose small details. A collapsed contour stays in the file as a degenerate closed 2-segment curve (start = end, zero area).
- Where: `optimize-contour.ts:69-76` (smoothing applies to a whole periodic run whatever its size; no area or size guard). `run-smoothing.ts` (σ = 0.25 mm Gaussian twicing; its shrink ≈ σ⁴/4R³ is large for R ≲ 2σ). `OptimizeShapesFields.tsx:71` tooltip.
- Repro:
  - `zz-t37/t37b.test.ts` case F, a 48-point circle, Smooth default:
    - r 0.05 / 0.08 / 0.1 mm → closed curve `c→start, l→start`. Line lit 0.314 / 0.502 / 0.629 → 0.000 / 0.002 / 0.013 mm; Fill → 0.
    - r 0.15: Fill 1.308 → 0.224 mm of hatch.
    - r 0.2: Line 1.256 → 0.853 mm, Fill 2.390 → 1.045 mm (radius 0.2 → 0.141).
    - With Smooth off every size is kept (r 0.05: 0.314 → 0.273).
  - `zz-t37/t37c.test.ts` case I, Roboto "i.j:;!":
    - 2 mm: the 4 dot contours 0.036 mm² → 0.000 each; fill area 0.962 → 0.719 mm² (−25%); line lit 14.41 → 9.66 mm (−33%). Toast "nothing moved more than 0.13 mm".
    - 3 mm: dots 0.080 → 0.014 mm² (−82%).
    - 5 mm: dots −33%.
- Oracle: shoelace area of each contour before/after, scan-line area (`gridArea`), and the analytic circle radius.
- Suggested fix: leave closed contours (or runs) whose size is under a few σ unsmoothed, or cap smoothing per run so area changes by at most a few percent. Name contours that shrank or collapsed in the status and the toast. Correct the tooltip and the ADR wording.

### T37-P3-1: Text and drawn shapes converted by Optimize drop their name (and jig/SVG-import identity)
- P3. Where: `src/core/geometry/local-path-artwork.ts:9-25` copies operationIds, powerScale, override, locked and tabs, but not `name`, `registrationJig` or `svgImport`. Repro: t37a B, a text with name "my label" → `name` undefined after Optimize. The burn is unchanged. Convert to Path keeps `name` (T26 map). The same pattern is known for Weld/Offset (T28-P3-1, T33-P3-2), but this helper is a separate code path.
- Fix: copy `name` (and `registrationJig`) in `localPathArtwork`.

### T37-P3-2: No test covers variable data, text fill rule, or small-feature loss
- P3 test gap behind P1-1, P1-2 and P2-1. `optimize-shapes-actions.test.ts` covers ids, locked, tabs and conversion, but none of these.

## Not a defect / limits
- No duplicate or overlap removal and no merging across objects: by design. The tool is LightBurn's Optimize Selected Shapes, which does neither. Delete Duplicates and the Cut Planner's "Remove overlapping lines" (ADR-499 item 8) do that work. Verified: the same outline on two layers stays on both (t37a C2).
- Smoothing moves more than the Fit tolerance (r 10 circle 0.069 mm vs tolerance 0.05): by design. The tolerance bounds the fit against the smoothed outline, and the status/toast reports the true two-way movement. The oracle agrees within 0.015 mm plus the 0.025 mm machine flattening.
- Text and drawn shapes convert in the same step, where LightBurn requires converting them first: by design (ADR-499 item 7), and the toast says so. The two P1s live in that step.
- Fit tolerance 1 mm on a scale-0.1 circle gave 213 segments and moved 0.008 mm, while 0.05 mm gave 2 segments. Odd (corner detection uses the tolerance as noise scale), but harmless: it moves less, not more.
- "Lines and arcs only" with `laserArcMoves: 'on'` wrote 0 G2/G3 on the default device. Not followed up: the default controller may not accept laser arcs (`controllerAcceptsLaserArcs`). Not raised.
- Text-on-path: optimizing a guide keeps its id, so the text keeps its guide. The stored glyph layout is not re-laid along the moved guide (≤ movedMm). That is general app behaviour, READ only. Image masks keep their mask id.
- Not checked: browser run of the dialog (keyboard, labels), inch display of the fields, CNC output, groups selected through the group row, a performance re-run (S6 measured 2,000 outlines in 4.3 s).

## Totals
Raised 5; P1 2; P2 1; P3 2; known 0. Related known: T26-P1-1 / T28-P1-1 (same variable-text class, other tools); T26-P2-1 (curve flattening) not re-raised.
