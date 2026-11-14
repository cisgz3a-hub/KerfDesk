# T37 Optimize Shapes — refuter report
Tree: origin/main @ 975631408 (`C:\Users\stolk\kd-t1\t36-main`, read only). Command id: `tools.optimize-shapes`.
Auditor report: `C:\Users\stolk\kd-t1\reports\T37-optimize-shapes.md`.

Method: three new Vitest files in `C:\Users\stolk\kd-t1\zz-t37r` (`r1.test.ts`, `r2.test.ts`, `r3.test.ts`). They use my own helpers in `r-util.ts`: a G-code decoder that tracks modal G, S and M3/M4/M5 and refuses G2/G3; a per-row fill oracle that compares, on each hatch row, the burned intervals with the inside intervals of the source glyph contours under non-zero and under even-odd; and a shoelace area. The independent text oracle is opentype.js ink bounds. I used other fonts and inputs than the auditor (Tinos, Pacifico, "LOT-{{serial:3}}", "Serial No. i:j;"). I also ran the welded case (Weld overlaps on, which is the default for new text) and reached the tool through Select All. Logs: `r1.log`, `r2.log`, `r3.log`. To rerun, from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t37r/vitest.config.mts --maxWorkers=1 r1` (or `r2`, `r3`). Free memory was 2.2–2.4 GB at every run.

## Verdicts

| Claim | Auditor | Verdict | Final |
|---|---|---|---|
| T37-P1-1 variable text / barcode frozen into the template | P1 | **CONFIRMED** (narrowed for barcodes) | **P1** |
| T37-P1-2 converted text loses non-zero, so overlaps go unburned | P1 | **CONFIRMED as a defect, RE-GRADED** | **P2** |
| T37-P2-1 default Smooth erases dots and small closed contours | P2 | **CONFIRMED** | **P2** |
| T37-P3-1 `name` dropped by `localPathArtwork` | P3 | confirmed, READ | P3 |
| T37-P3-2 no test for variable data, fill rule or small features | P3 | confirmed (grep of the 4 Optimize test files finds none) | P3 |

## Evidence per claim

### T37-P1-1: CONFIRMED P1
- **The guard is bypassed.** READ: `optimizeShapesSelection` (`src/ui/state/optimize-shapes-plan.ts:62-77`) filters only by `isVectorPathObject`, `isRegistrationBox`, boolean compound and locked. `optimizeShapesMutation` (`optimize-shapes-actions.ts`) uses that selection directly. The command (`optimize-shapes-commands.ts`) is enabled by `ctx.hasSelection` alone. Neither the dialog files nor the plan mention `objectVariableTemplate` or `geometryToolSources`. Offset, Cut, Trim, Rubber-band, the vector-path selection and the repair sources all call `geometryToolSources` (`geometry-tool-sources.ts`); Optimize does not. The text then becomes `localPathArtwork(object)` (`optimize-shapes-plan.ts:165`), which drops `variableTemplate`.
- **It is reachable through ordinary use.** In r1 V1 the scene held a variable text and a hand-drawn rectangle with jitter. `selectAllObjects()` gave `["VT","R"]`, Optimize targeted `VT,R`, and the command was enabled.
- **Repro (r1 V1).** Tinos 8 mm, Weld on, "LOT-{{serial:3}}", default options, decoded G-code:
  - Before: serial 7 lit 155.932 mm, x 40.000..69.020 (width 29.020); serial 8 lit 166.311 mm (width 28.945). The two G-codes differ.
  - After: kind `imported-svg`, `variableTemplate` gone. Serial 7 **and** 8 both lit 295.400 mm, width 55.430, and the G-code is byte-identical.
- **Oracle.** opentype.js ink widths: "LOT-007" 29.020, "LOT-008" 28.945, the template 55.430. The burn before matches the value exactly; the burn after matches the template glyphs (the braces).
- **Notice.** Only "Optimized 2 objects: … 1 text object was converted to a path in the same step; Undo restores it." Nothing says the variable data is lost. The canvas already draws the stored template glyphs before and after (as in T26-P1-1), so nothing on screen changes.
- **Barcodes (narrowed).** In r1 V2, a variable Code 128 "A{{serial:4}}":
  - Without a caption, Optimize changes nothing ("Nothing changed"; bars are rectangles with 90° corners), so it is not frozen.
  - With a caption, it converts to `imported-svg`, and serials 7 and 8 both burn 719.308 mm with identical G-code. Before, they burned 719.763 and 722.932 mm.
  - So only captioned variable barcodes freeze. That is the common default (`showText`), and still P1.
- **Grade.** A wrong burn on every record after the first, no warning, reached by Select All. This is the same root and the same grade as T26-P1-1, T28-P1-1, T29-P1-1, T30-P1-1 and T32R-P1-1 (all P1 in the LEDGER). LightBurn requires text to be converted to paths before Optimize, and KerfDesk's Convert to Path refuses variable text since #1875. Optimize is a side door around that refusal. P1 is consistent.

### T37-P1-2: real defect, RE-GRADED P1 → P2
- **Mechanism (READ, then confirmed by running it).** `localPathArtwork` maps text paths through `textPath` (`fillRule: 'nonzero'`), but `optimizedPaths` spreads `paths: result.paths` over it (`optimize-shapes-plan.ts:165`). `result.paths` are the text's own paths, which carry no `fillRule`. The result is an `imported-svg` whose paths have no rule, so it falls back to even-odd. r2 printed `fillRule -` on every converted path.
- **Fill area, own per-row oracle (r2 W).** Fill layer, 0.05 mm hatch at 0°. "Oracle" is the source glyph contours under non-zero (ADR-286); "missed" is non-zero area left unburned.

  | Text | Weld | Oracle NZ / EO mm² | Burned before → after | Missed before → after |
  |---|---|---|---|---|
  | Roboto "OO" ls −0.35, 10 mm | off | 30.417 / 28.864 | 30.311 → **28.610** | 0.396 → **2.465** |
  | Roboto "OO" | **on** | 30.408 / 30.408 | 30.412 → 30.258 | 0.007 → 0.869 |
  | Pacifico "Wedding", 15 mm | off | 345.188 / 333.191 | 343.997 → **332.614** | 2.576 → **16.070** |
  | Pacifico "Wedding" | **on** | 345.228 / 345.228 | 345.232 → 343.450 | 0.051 → 4.780 |
  | Great Vibes "Emily", 20 mm | off | 143.471 / 142.373 | 143.253 → 142.253 | 1.685 → 4.904 |
  | Great Vibes "Emily" | **on** | 143.482 / 143.482 | 143.481 → 143.082 | 0.043 → 3.841 |

  - With Weld off the loss equals the oracle's non-zero minus even-odd difference, which confirms the claim. Pacifico "Wedding" loses 11.4 mm², 3.3 % of the word.
  - With Weld on, non-zero and even-odd are the same region. Only the smoothing displacement remains (within the reported "moved" figure, about 0.5 % net), and there is no fill-rule loss.
- **Why P2 and not P1:**
  1. **Reach.** New text has Weld overlaps on by default (`use-text-dialog-fields.ts:203`: `editing ? (state.weldOverlaps ?? false) : true`). Canvas text, phone text (`remote-control/text.ts:61`) and jig text (`jig-text-object.ts:80`) also default to welded. Welded text loses nothing (table above). The defect needs text the user created with Weld off, or text from before the default.
  2. **It is visible.** The canvas design view paints fill with the path's rule. I called `resolveObjectDisplay` on the real module: `fill/nonzero` before Optimize, `fill/evenodd` after. The overlap holes therefore show as unfilled slivers on the canvas as soon as Apply runs. The dialog's before/after preview draws outlines only (`VectorComparisonPreview`, `fill="none"`), so it does not show the loss.
  3. **Precedent.** T16-P2-1 is the same fill-rule loss (masks), narrowed to P2 because Weld is on by default. N3r-P2-1 (pocket on script text joins, ADR-286 Amd 1) and its tapered-inlay twin were also P2.
- **Grade:** P2, "a wrong result the user is likely to notice", with limited reach. The fix is unchanged: keep `fillRule: 'nonzero'` on converted text paths.

### T37-P2-1: CONFIRMED P2
- **Repro (r3 S).** "Serial No. i:j;", Weld on, default options (Smooth on, 0.25 mm). Areas are per-contour shoelace in world mm².
  - Roboto 2 mm: every dot contour 0.036/0.039 → **0.000** (6 dots). Line lit 54.514 → 48.174 mm. Fill missed 0.153 → 0.739 mm².
  - Roboto 3 mm: dots 0.081/0.088 → 0.015/0.019 (−81 to −83 %).
  - Roboto 5 mm: dots −30 %.
  - Tinos 2 mm: dots 0.035/0.044 → 0.000. Tinos 3 mm: dots −74 to −82 %.
  - The toast says "nothing moved more than 0.13 mm" (0.14 for Tinos), which is true but does not say that features vanished.
- **Plain circles (r3 C), default σ 0.25:**

  | Radius | Area change |
  |---|---|
  | r 0.1 | −100 % |
  | r 0.15 | −86 % |
  | r 0.2 | −59 % |
  | r 0.25 | −36 % |
  | r 0.3 | −21 % |
  | r 0.5 | −6 % |
  | r 1 | −2.4 % |

  - ADR-499 item 7 gives the shrink as about σ⁴/4R³. At R 0.25 that predicts a radius shrink of about 0.010 mm (about 8 % area), but the measured shrink is 0.050 mm (36 %). The formula fails for R ≲ 2σ.
- **Documentation.**
  - The Smoothing distance field says "wiggles shorter than about four times this distance … are smoothed away" (`OptimizeShapesFields.tsx:85,98`). That indirectly covers a whole contour under about 1 mm perimeter, but nobody will read it as "dots vanish".
  - The Smooth checkbox says "curves keep their size" (`:71`).
  - The command help says "Smooth the selected vector outlines without shrinking them" (`optimize-shapes-command-help.ts`).
  - ADR-499 says "smoothing does not shrink shapes" (line 111).
  - No minimum feature size is documented.
- **Preview.** It is an outline-only SVG, 220 px tall, fitted to the selection. A dot shows as a dashed "before" ring with no solid "after" ring. With small text selected alone that is a few pixels and noticeable on a close look. With a normal-size design selected it is sub-pixel.
- **LightBurn.** Its docs ("Optimize Selected Shapes") say stronger smoothing comes "at the expense of potentially losing small details". So LightBurn warns about the same class of loss, while KerfDesk promises the opposite.
- **Grade.** A wrong burn on default settings, but limited to text ≲ 3 mm or specks ≲ 0.3 mm. It is shown, if faintly, in the preview and on the canvas, and LightBurn carries the same caveat. P2 stands. Not P1, because of the limited reach and the visible preview.

### P3 spot-checks
- **T37-P3-1:** `local-path-artwork.ts:9-25` copies operationIds, powerScale, override, locked and tabs. It does not copy `name`, `registrationJig` or `svgImport`. I checked whether losing `registrationJig` drops a piece out of the jig. Jig copies keep their prefixed ids, and the box-0 sources keep membership through the copies' ancestry (`registration-jig-artwork.ts:198-225`). So the jig survives, and this stays P3 (READ).
- **T37-P3-2:** grep for `variable|fillRule|nonzero|small|dot|collapse` in `optimize-shapes-actions.test.ts`, `OptimizeShapesDialogHost.test.tsx` and `shape-optimize/*.test.ts` finds nothing. Confirmed.

## Extra findings
None raised.
- I looked for a jig break and found none (see P3-1).
- Imported non-zero SVG keeps its rule: `rebuiltPaths` spreads `...path` (READ).
- An uncaptioned variable barcode is untouched (r1 V2). That narrows P1-1 rather than adding a finding.
- The wrong shrink formula and the "without shrinking" wording in ADR-499 and the help belong to the P2-1 fix, not a separate finding.

## Totals
Verdicts: confirmed 2 (T37-P1-1 P1, T37-P2-1 P2), re-graded 1 (T37-P1-2 P1 → P2), refuted 0; P3s 2 confirmed. Extra raised: 0 ().
