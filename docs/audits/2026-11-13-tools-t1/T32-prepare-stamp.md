# T32 Prepare Stamp — auditor report
Tree: origin/main @ eeac725e8. Command id: `tools.prepare-stamp`.

## Map
- **Command:** `src/ui/commands/stamp-preparation-command.ts:5`. The command is enabled whenever anything is selected (`ctx.hasSelection`). It opens `StampPreparationDialogHost` through `CommandShell.tsx:112` (`requestPrepareStamp`).
- **Dialog:** `StampPreparationDialog.tsx`, with the hooks `use-stamp-preparation.ts` (defaults: taper 0.5 mm, threshold 127, DPI 254, Mirror on) and `use-stamp-work.ts`.
  - Validation is at `use-stamp-work.ts:137-157`.
  - Apply is `commitStamp`, which runs through `proOperationMutationSetter`.
- **Source:** `src/ui/raster/stamp-source.ts`. It accepts either one raster image, or only closed vectors (`canPrepareStamp`, `:17`).
  - Vectors go through `buildBitmapFromVectors(..., renderType 'fill-all')` in the Convert to Bitmap worker.
  - Image masks and clips are applied to the raw luma.
  - The physical pitch is `bounds × |scale|`.
- **Core:** `src/core/raster/stamp-height.ts` (`prepareStampHeight`) builds the stamp:
  - The face is source pixels with luma ≤ threshold. With Mirror on, it reflects about the image X axis.
  - The padding is `ceil(taper/pitch)+1` px per side.
  - The shoulder is `255·(1 − d/taper)`, where d is the exact Euclidean distance to the nearest face pixel cell (`stamp-distance.ts`).
  - The worker is `stamp-worker.ts`.
- **Store:** `src/ui/state/stamp-preparation-actions.ts`.
  - `stampDraftImage` (`:31-55`) makes a new raster image. It has the source's transform, local bounds widened by the padding, `dither: 'floyd-steinberg'` and the source image's `linesPerMm`.
  - `applyStampDraft` (`:58-85`) adds that image on a new Image operation named "Stamp height intent", pushes one undo step and leaves every source untouched.
- **Export:** `stamp-export.ts` saves a PNG and shows a toast with the mm extent.
- **Governing docs:**
  - ADR-570, paragraph "Stamp preparation …": it preserves the source artwork, requires review, and infers no depth or power.
  - ADR-699 Context: the nearest thing to the new Fill Ramp, and it "burns nothing itself".
  - WORKFLOW.md has no Prepare Stamp section. F-A7e2 (Fill Ramp for rubber stamps) is the stamp workflow.
- **Changes since 2026-10-16:** one, `7cd54afd9` in PR #1375 (ADR-656 Amd 1, save picker in `stamp-export.ts`). The core, source and store files are unchanged.
- **LightBurn:** it has no "prepare stamp" command. Its documented stamp workflow (cited in ADR-699) works on the artwork itself:
  - mirror the art;
  - make the letters raised: Negative Image for a bitmap, or the letters as holes in a filled border plate for a Fill;
  - slope the shoulders with Fill **Ramp Length**, with **Ramp Outer Edge** off.
  - One object is burned. There is no second copy.

## October register re-check
The 2026-10-16 register row 39 ("Prepare Stamp") recorded **no repaired defect**. It passed an edge-distance oracle, the 2 M-pixel guards, Apply (image + operation) and exact Undo. All of this still holds on eeac725e8:
- the core matches an independent brute-force oracle exactly (C1);
- Undo restores the project byte-identically, and Redo re-adds the stamp (B1);
- the tree's own 6 stamp suites pass, 20/20 (`zz-t32/tree-tests.log`). One run at `--testTimeout=60000` timed out in the dialog-host import under load; it passed at 180 s.

## Checks run
Script: `C:\Users\stolk\kd-t1\zz-t32\t32-flow.test.ts`; output: `C:\Users\stolk\kd-t1\zz-t32\t32-flow.log`. The script runs the real `prepareStampSource`, `prepareStampHeight`, `stampDraftImage`, `applyStampDraft`, store Undo/Redo, `prepareOutput` → `emitPreparedGcode`, and a decoder copied from zz-t26. Vector rasterisation runs the real `assembleBitmapAsync`, called in-thread in place of the worker.

| Check | Method | Result |
|---|---|---|
| Face, counters, islands (ring + counter + island + tab) | independent per-pixel oracle (luma ≤ threshold, mirrored column `w−1−x`) | 0 differing pixels in all 4 cases; the counter is recessed, the island is raised |
| Mirror axis and pivot | oracle | the tab at source column 70 lands at output column 9 (mirror on) or 70 (off); the padding is symmetric, so the centre stays put |
| Shoulder heights | brute-force Euclidean distance to face cells, anisotropic pitch 0.25 × 0.5 mm | max \|height − oracle\| = 0; measured ramp 1.000 mm for taper 1, 0.750 mm for 0.75; margin corner luma 0 |
| Vector source (ring, counter, island, tab; even-odd) | even-odd point-in-polygon oracle at 310 × 230 pixel centres | 0 mismatches |
| Raster placement: rotated 30° with scale 1.5 × 0.8; 90° with mirrorX; scaleX −1 | world position of each source pixel vs the matching stamp pixel | error 0 mm; world pitch equals the draft pitch (0.750 / 0.500) |
| Stamp burn alone | decoded G-code, lit length on face pixels | 0.000 mm on the face (image source and vector source); the burn covers the padded bounds only |
| **Job as applied (source left on)** | decoded G-code | **770 / 867 mm burned on the raised face (mirror on); 100 % of the face burned (mirror off)**: T32-P1-1 |
| **Variable text / barcode** | independent render of the value | **stamp face 60.522 mm wide = the template glyphs, not the value "SN 0042" (37.241 mm); the barcode stamp uses the stored code**: T32-P2-1 |
| Mixed, open, many | `canPrepareStamp` + real run | closed + open, image + vector and two images are all refused; 30 objects on 2 operations make 1 stamp |
| Image clip (left half) | face count | 740 left / 0 right |
| Inherited settings | read the new layer | new Image operation: power 30, speed 1500, `linesPerMm` 10 (source's import-time value), dither Floyd–Steinberg; the source operation keeps Output on |
| Stamp output power | decoded S values | a single S300 for the whole stamp: shoulders become full-power dots (T32-P3-1) |
| Undo / Redo / save-reopen | store, serialize → deserialize → burn | exact; lit 13306.500 mm before and after |
| Tree tests | 6 stamp suites | 20/20 pass |

## Findings

### T32-P1-1: Apply leaves the source artwork burning under the stamp, so the job burns away the raised face
- **Severity: P1.** It harms a job: a wrong burn, and the burn does not match what the canvas shows.
  - The stamp image is opaque and drawn on top of its source, at the same place. It recesses everything except the face.
  - The source keeps its own live operation, and that operation burns exactly the face: the dark art on an Image operation, or the letters on a Fill.
  - The obvious journey is select art → Prepare Stamp → Apply → Start. On that journey the face is engraved flat as well.
  - The dialog only says "Apply adds an image". It never says the source still burns.
  - Nothing in LightBurn's stamp workflow leaves a second burning copy, and Convert to Bitmap removes its source.
  - ADR-570 says the tool "preserves source artwork". It does not say the source stays in output, but a refuter may read it as accepted by design.
- **Where:** `src/ui/state/stamp-preparation-actions.ts:58-85` (`applyStampDraft` adds the image and operation and leaves the source operation's `output` alone); `StampPreparationDialog.tsx:35-40` (the Apply wording).
- **Repro:** `zz-t32/t32-flow.test.ts`, tests B1, B3 and B6. Log lines:
  - **B1, image source, mirror on (default), taper 1:** the stamp alone burns 0.000 mm on face pixels. The job as applied burns 770.000 mm on the face (13306.5 mm in total).
  - **B3, vector ring on a Fill:** 867.009 mm on the face, against 0.000 mm with the Fill set to Output off.
  - **B6, mirror off:** the source operation burns 2910.000 mm on the face. That is 100.000 % of the face area at 0.1 mm rows (291 mm² ÷ 0.1).
- **Oracle:** a stamp's raised face must get zero laser time. The per-pixel face mask comes from the independent oracle in C1/B3. Expected lit length on the face is 0 mm; actual is 770–2910 mm.
- **Suggested fix:** on Apply, turn the source's output off. Either move the sources to an Output-off operation, or replace them as Convert to Bitmap does, with exact Undo kept. At minimum, say in the dialog and in Job Review that the source still burns.

### T32-P2-1: Prepare Stamp bypasses the variable-data guard (#1882) and freezes "{{serial}}" templates and stored barcode codes into the stamp
- **Severity: P2.** It is a wrong result.
  - Weld, Convert to Path, Offset and the other geometry tools rated the same root P1.
  - Here the mandatory preview shows the source pixels, so the braces of variable *text* are visible before Apply.
  - The *barcode* case is silent: the bars look right but encode the insert-time value.
  - There is no notice and no skip, and `canPrepareStamp` accepts both.
- **Where:** `src/ui/raster/stamp-source.ts:17-23` (`canPrepareStamp`) and `:77-83` (`isClosedStampVector`). `use-stamp-work.ts:108` calls `prepareStampSource` with no `geometryToolSkipReasons`/`objectVariableTemplate` check. The menu gate `stamp-preparation-command.ts:5` checks only `hasSelection`.
- **Repro:** `zz-t32/t32-flow.test.ts`, tests B4 and B7.
  - **Variable text:** Roboto text "SN {{serial:4}}" at serial 42. `canPrepareStamp` is true, and the stamp is made.
    - The stamp face is **60.522 mm** wide, which is the template glyph width (60.522).
    - An independent render of the value "SN 0042" is **37.241 mm**, and the text's own output burn is 37.232 mm.
    - The stamp image has no `variableTemplate`.
  - **Variable Code 128 `{{serial:4}}`:** stored code 0042, project serial 43. The stamp is made from the stored code. A stamp of the 0043 code differs in 4172 of 42,240 pixels.
- **Oracle:** an independent `textToPolylines` render of the value, and the barcode re-materialised at the current value.
- **Suggested fix:** gate `canPrepareStamp` (and the menu) with `geometryToolSkipReasons(scene, 'variable')`, and show the shared "use Bake Variable Text first" notice. Alternatively, render the current record value before rasterising.

### T32-P3-1: The stamp's operation defaults to Floyd–Steinberg, so the graded shoulder burns as full-power dots
- The whole stamp emits a single power level, S300 (B6). Each shoulder pixel is either on at full power or off, so the result is not the sloped support the height map describes.
- The dialog does say "Set proportional laser power … through existing tools".
- ADR-699 now ships 3D Sliced and Fill Ramp for exactly this. A Grayscale or 3D Sliced default, or a pointer to them, would make Apply → Start produce a ramp.
- Where: `stamp-preparation-actions.ts:52`.

### T32-P3-2: The menu item is enabled for any selection
- `stamp-preparation-command.ts:5` enables the command for any selection. The disabled tooltip says "Select one raster image or closed vector artwork first", but open paths, mixed selections and two images are refused only after **Prepare preview**, with a message.
- Gate it with `canPrepareStamp` (and the T32-P2-1 guard).

### T32-P3-3: No documentation of Prepare Stamp in WORKFLOW.md
- There is no WORKFLOW.md section for Prepare Stamp.
- F-A7e2 (Fill Ramp for rubber stamps) and the dialog never point to each other.
- The relationship to Fill Ramp (ADR-699) and what to do with the source after Apply are undocumented.

## Not a defect / limits
- **Mirror axis.** It is the image's local X axis for raster sources: a 90°-rotated image appears flipped vertically in world. Vector sources are rasterised in the world frame (identity transform), so for them it is world X. Both are true reflections, so the stamp prints the right way round. The dialog states the image-axis rule.
- **Raw pixels.** Brightness, contrast and Negative Image are not baked in; the dialog says so (ADR-570). Masks and clips are honoured (B5).
- **Margin and border.** The black margin is `ceil(taper/pitch)+1` px. The whole padded rectangle is recessed and nothing beyond it is burned, as stated in the dialog. The outer edge of the plate is the user's cut, as in LightBurn with Ramp Outer Edge off.
- **Known, not counted as new:** **H5-P3-3** (rolling v3): the stamp operation takes the source image's import-time `linesPerMm` (10). It is still present: B1 shows `linesPerMm 10`.
- **Not checked:**
  - The canvas rendering of the stamp over its source. This was a READ only (images are drawn in object order, and the stamp is appended last); no browser run was made.
  - Inch display units in the dialog: its fields are labelled in mm.
  - The Export PNG save path, beyond reading it.
  - Curves are flattened before rasterising; that is known as T26-P2-1 and has no visible effect at the pixel pitch.

## Totals
Raised 5; P1 1; P2 1; P3 3; known 1 (H5-P3-3, rolling-v3 H5: the stamp operation uses the source image's import-time lines/mm).
