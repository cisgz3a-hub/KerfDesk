# T26 Convert to Path — auditor report
Tree: origin/main @ 3293fd15d. Command id: `tools.convert-to-path`.

## Map
- Menu: `src/ui/commands/command-families.ts:142-158` (`convertToPathCommand`), enabled by `selectionHasUnlockedVectorObject` (`src/ui/commands/selection-command-state.ts:69-77`, any selected unlocked convertible vector). Also the Node tool hint button (`src/ui/workspace/NodeEditHint.tsx`). No dialog.
- Store: `vectorPathActions().convertSelectionToPath` → `convertSelectionToPathMutation` (`src/ui/state/vector-path-actions.ts:186-210`): every selected, unlocked object with `paths` (text, shape incl. barcode and registration box, imported-svg incl. sketch/part, traced-image), boolean compounds skipped; one Undo step; no toast.
- Core: `convertVectorObjectToPath` (`src/ui/state/vector-path-conversion.ts:9-12`) = `materializeVectorObject` (`src/core/geometry/vector-path-tools.ts:68-176`: bakes the transform into world points, flattens every curve at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM` 0.025 mm, drops `curves`, keeps colour, path operation ids, stroke fields, fillRule (text → `nonzero`), name, locked, operationOverride, powerScale, operationIds) + `materializedTabAnchors` (`src/core/geometry/materialized-tab-anchors.ts`, reprojects placed laser/CNC tabs).
- Twin: `localPathArtwork` (`src/core/geometry/local-path-artwork.ts`, used by Trim/Extend/Optimize) keeps curves and the transform.
- Governing: ADR-494 Amd 1/3/4 (tabs), ADR-286 (text non-zero), ADR-386 Amd 2 (barcodes: "Convert to Path still converts the stored code"), ADR-498 (trim converts in place); WORKFLOW F-D5.
- Changes since 2026-10-16 on these files: 313cea95a / 28768335c (tabs follow resized shapes and Studio rebuilds, ADR-494 Amd 3/4), f3e535e79, 7449c6362, ab3226fd1 (helpers shared). No change to the flattening.

## October register re-check
Row 33: "repaired lost laser/CNC tabs; nonuniform scale, mirror/rotation and open-contour tab positions".
- Still fixed. `vector-path-conversion-tabs.test.ts`, `materialized-tab-anchors.test.ts`, `command-vector-path-tools.test.ts`: 3 files, 6 tests pass on this tree.
- Own check on a curved outline (not in the repo tests, which use squares): rounded rectangle r 5 at 35°, mirrorX, scale 2.5 × 0.8, four placed tabs: anchors move 0.023–0.026 mm (chord of the 0.025 mm flattening), decoded tab gaps identical before/after, lit 221.309 = 221.309 mm. Automatic tabs identical too.
- "Huge-curve latency absent" was a test gap; performance S7 (2026-11-02) measured 2,000 characters at 121–187 ms. Not re-measured.

## Checks run
| Check | Method | Result |
|---|---|---|
| Burn before vs after, 6 kinds (rect r5, ellipse, bulged polygon, bulged star, cubic SVG, Roboto text) × identity and rot 35°+mirror+2.5×0.8 × Line and Fill | `zz-t26/t26-burn.test.ts`, real store action, `prepareOutput` → `emitPreparedGcode`, own decoder (`decode.ts`), own Hausdorff and chain winding | 24/24 identical: lit length to 0.001 mm, Hausdorff 0.000 both ways, same F/S, same start point and contour winding, same Fill row count and hatch length; text gets `fillRule: nonzero` |
| Undo / Redo / save-reopen, same 24 cases | same script | Undo returns the identical project object; Redo equal; `.lf2` round trip burns the same |
| Variable text (serial) | `t26-more.test.ts` A, `prepareOutputSnapshot` with a Roboto renderer | **T26-P1-1** |
| Scale after convert | B, analytic circle | **T26-P2-1** |
| Native arcs (GRBL 1.1, arcs on) | C | same root as T26-P2-1 |
| Tabs on curves (placed and automatic) | D | holds (above) |
| Registration jig, Select All → Convert | E | **T26-P2-2** |
| Locked, group, overrides, metadata | F | locked untouched, group kept, overrides/powerScale/name kept, burn equal; metadata dropped (T26-P3-1) |
| Earlier ledgers | rg over docs/audits | R4-P2-2 (→P3) known; L6 claim contradicted |
| LightBurn reference | docs.lightburnsoftware.com Reference/ConvertToPath and VariableText (2.2) | result is "paths made up of lines, curves, and nodes"; converted variable text "will no longer be substituted"; Bake keeps the currently output text |

## Findings

### T26-P1-1: Converting variable text burns the literal template ("SN {{serial:4}}") instead of the record value
- P1: wrong burn with no sign. The canvas draws the stored template before and after, so nothing changes on screen; no toast, no Job Review notice.
- Where: `src/ui/state/vector-path-actions.ts:194-200` converts any text with `paths`; `vector-path-tools.ts:89-116` keeps the stored `paths`, which `build-text-object.ts:44-84` renders from the template source. Enabled by `selection-command-state.ts:69-77` (no variable check). Output re-renders only `kind: 'text'` with `variableTemplate` (`prepare-output-snapshot.ts:251-262`); the converted imported-svg is plain geometry.
- Repro: `C:\Users\stolk\kd-t1\zz-t26\t26-more.test.ts` test A, log `t26-more.log`. Text `SN {{serial:4}}`, serial 42, Roboto 10 mm. Before: lit 212.520 mm, bbox x 50–87.241. After Convert to Path: lit 351.213 mm, bbox x 50–110.522, source "Text: SN {{serial:4}} (paths)", toasts [].
- Oracle: independent render of "SN 0042" outline = 212.782 mm, of the template = 351.872 mm. The burn went from the value to the braces.
- LightBurn: converted variable text stops being substituted; it does not burn template codes. KerfDesk's own Bake Variable Text "fixes ... at the value they would engrave now".
- Suggested fix: bake variable text and barcodes (the `bakeSelectedVariableText` evaluation) before converting, or refuse them with "Bake Variable Text first".

### T26-P2-1: Convert to Path flattens every curve to 0.025 mm chords, so a converted shape scaled up burns off-shape and loses native arcs
- P2: a wrong result the user can see as facets; burn deviation 10–20× the machine tolerance after an ordinary resize.
- Where: `src/core/geometry/vector-path-tools.ts:89-99,120-141` (polylines only, `curves` dropped). The twin `local-path-artwork.ts:9-26` keeps curves and the transform; rolling v7 L6 (`L6-node-edit-curves.md:368`) states "Convert to Path keeps the curves, the transform and the tabs", which is not what the menu command does.
- Repro: `t26-more.test.ts` B and C. A 10 mm circle converted and then scaled ×10: 32 chords, max radial error 0.247 mm (unconverted scaled ×10: 0.025 mm); ×20: 0.492 mm (unconverted 0.027 mm). The converted circle has 33 nodes, `curves` absent. GRBL 1.1 with arcs on: ellipse 40 mm 2 G2/G3 → 0 G2/G3 + 64 G1; rect r5 4 G2/G3 → 36 G1.
- Oracle: analytic circle radius; LightBurn's converted result is "lines, curves, and nodes".
- Suggested fix: bake the transform into the canonical curves (cubics map exactly under an affine map; elliptical arcs can be re-solved or converted to cubics) and keep polylines as the compatibility view, as `localPathArtwork` does.

### T26-P2-2: Select All → Convert to Path turns the registration jig boxes into plain paths; the jig vanishes and the burn order changes with no warning
- P2: same geometry, but piece-by-piece jig order is lost and the jig panel no longer sees a jig.
- Where: registration boxes are unlocked (`registration-box.test.ts:16-17`) and are found only as `kind === 'shape'` (`src/core/scene/registration-layer.ts:61-68`); the mutation converts them like any shape (`vector-path-actions.ts:194-200`).
- Repro: `t26-more.test.ts` E. Two boxes, an ellipse (art, F2222) and a square (eng, F1111) with jig copies in box B, everything selected. Boxes 2 → 0, jig runs 4 → 0. Decoded order before: eng A > art A > eng B > art B. After: art A > art B > eng A > eng B.
- Oracle: `registrationJigCompilationRuns` contract ("one piece finishes before the next starts").
- Suggested fix: skip registration-layer outlines (and captured-board boxes) in Convert to Path, or keep them as shapes; say what was skipped.

### T26-P3-1: Conversion drops library licence provenance, the operator's "burn this white" choice, SVG re-import identity and explicit jig membership
- REPRO (F): `libraryProvenance` (CC-BY creator credit), path `whiteInk: 'kept'`, `svgImport` and `registrationJig` are all undefined after conversion; the burn is unchanged. A kept white becomes paper white again, so the saved-white knock-out asks again; an explicitly promoted jig member falls out of its box (READ ONLY for the jig effect).
- Where: `vector-path-tools.ts:100-116,155-166` copies only name, locked, override, powerScale, operationIds.
- Fix: carry `libraryProvenance`, `whiteInk` and `registrationJig` (and drop `svgImport` deliberately).

### T26-P3-2: A variable barcode converts its stored insert-time code, not the value the canvas shows (READ ONLY)
- ADR-386 Amd 2 Consequences accept "Convert to Path still converts the stored code". The canvas then switches from the current serial to the stored one and every copy burns that. Maintainer decision; fixed together with T26-P1-1 if Convert bakes first.

### T26-P3-3: Convert to Path is silent
- REPRO: no toast at all (test A toasts []); locked objects in a mixed selection are skipped without a word (F). Same pattern as T10-P3-1.

### T26-P3-4: Test gap
- No test covers variable text or barcodes, curve retention, conversion under a scale-up, registration boxes, or metadata carried through; tab tests use straight squares only.

## Not a defect / limits
- Burn at the moment of conversion is exact for every kind tried (24 cases), including text winding under mirror (ADR-286 non-zero kept explicitly) and Fill hatch.
- Transform is baked (identity transform afterwards), as the October audit intended ("bake transforms"); LightBurn documents nothing on this.
- Text loses its missing-glyph warning on conversion: KNOWN, rolling v9 R4-P2-2 (lowered to P3).
- Constrained sketch / part generator sources are dropped by design (conversion detaches parameters); boolean compounds are skipped by design.
- Not checked: CNC compile of a converted path (laser tabs and CNC anchors were checked by position only), text on a path and bent text (stored paths, READ), browser/dialog (no dialog; memory gate not met for a browser run), Design Studio objects (they become imported-svg via their own route, not this command).

## Totals
Raised 7; P1 1; P2 2; P3 4; known 1 (R4-P2-2, rolling v9 R4-fix-text-frames).
