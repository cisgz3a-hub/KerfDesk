# T32 Prepare Stamp — refuter report
Tree: origin/main @ eeac725e8 (`C:\Users\stolk\kd-t1\t31-main`, read only). Command id: `tools.prepare-stamp`.

## How I checked
- I wrote my own script, `C:\Users\stolk\kd-t1\zz-t32r\r32.test.ts`. The log is `zz-t32r\r32.log` and the run summary is `zz-t32r\run.txt`: 6/6 tests ran, free memory was 2.8 GB.
- The script runs the real modules: `prepareStampSource`, `prepareStampHeight` (the worker's only computation, called in-thread), `stampDraftImage`, `applyStampDraft`, `prepareOutput` / `prepareOutputSnapshot`, `emitPreparedGcode`, `detectJobIntentWarnings`, `deriveVariableBarcodeDisplay` + `encodeWaiting`, `buildBitmapFromVectors` and `applyConvertToBitmap`. The Convert-to-Bitmap worker runs in-thread through `assembleBitmapAsync`.
- **Own G-code decoder.** It reads G0/G1, G90/G91, M3/M4/M5 and modal S. A move counts as lit when it is G1, the laser is on and S > 0. I did not reuse the auditor's `decode.ts`.
- **Own face oracles.** Neither uses the tool's face mask:
  - Raster: the source luma at the mirrored column `w−1−i`, on a 0.1 mm world grid.
  - Text: an even-odd point-in-polygon test of the glyph polylines, reflected about the source raster's centre.
- **Different art from the auditor.** I used an asymmetric "F" + "T" photo (300 × 150 px, 0.1 mm) and real Roboto text "KERF" at 12 mm. For variable data I used Tinos text "LOT {{serial:3}}" at serial 7, parsed by the real `parseVariableTemplateSource` and evaluated by `evaluateVariableTemplate`, and a Code 128 `{{serial:5}}` stored at 00100 with the project serial at 117.

## Verdicts

| Claim | Verdict |
|---|---|
| T32-P1-1 Apply leaves the source burning under the stamp | **CONFIRMED, P1 kept** |
| T32-P2-1 The variable-data guard is bypassed; the stamp freezes template text or the stored barcode code | **CONFIRMED, P2 kept** |
| T32-P3-1 The stamp's operation defaults to Floyd–Steinberg (single power) | CONFIRMED, P3 |
| T32-P3-2 The menu item is enabled for any selection | CONFIRMED, P3 |
| T32-P3-3 WORKFLOW.md does not document Prepare Stamp | CONFIRMED, P3 |
| Known H5-P3-3 The stamp operation uses the source's import-time lines/mm | Still accurate, now reproduced: `stamp-preparation-actions.ts:53` and `:74` |

## Evidence

### T32-P1-1: CONFIRMED, P1 kept

**Is the source meant to stay?** It stays as an object, by design:
- ADR-570 says the tool "preserves source artwork".
- The tutorial (`layout-tutorials.ts`, step 3) says "The original stays unchanged".
- The comment on `applyStampDraft` says the sources "retain their exact identities".

None of these says the source keeps burning. No ADR, dialog text, tutorial or WORKFLOW line says the source is hidden, set to Output off, moved to a non-output operation, or kept for reference. The dialog's only Apply wording is "Apply adds an image with ordinary image-operation defaults. Set proportional laser power … Qualify a physical coupon".

**Does anything tell the user to turn the source off?** No:
- `commitStamp` (`use-stamp-work.ts:160-170`) shows no toast and no notice.
- Compare Trace, the accepted keep-source precedent (T23 "Not a defect"):
  - it shows a toast "… source kept";
  - WORKFLOW F-E1 tells the user to delete the source or turn its Output off;
  - it has a per-trace advisory.
- Prepare Stamp has none of these three.

**Do Job Review, the canvas or Preview show the overlap?**
- **Job Review: no.** `detectJobIntentWarnings` on the applied project gives two warnings. The only one that names both operations is "2 operations are still using the uncalibrated defaults … 'Stamp height intent', 'SRCOP'". Nothing mentions an overlap.
  - `stackedCopyWarnings` keys copies by content (`rasterContentKey`), so a stamp over its own source never counts as a stack.
- **Canvas: no (READ).** `draw-scene.ts:361-387` draws objects in scene order. The stamp is appended last, its bounds are padded wider than the source, and `drawRasterImage` paints it opaque, with no blend mode or alpha. Fill pools are painted at their members' index, which is before the stamp. The canvas therefore shows a clean stamp and hides the source.
- **Preview: yes, if opened.** Preview renders all output operations, so the source's burn across the white face would be visible there. Opening Preview is not required before Start.

**Measured burn on the raised face** (own decoder and own oracle; `R1`/`R2` in `r32.log`):

| Case (dialog defaults: taper 0.5 or 1, 254 DPI) | As applied | Source op set to Output off |
|---|---|---|
| Photo "F T", mirror on (default) | 534.0 mm lit on the face; **53.8 %** of face cells burned | 0.000 mm; 0 % |
| Photo "F T", mirror off | 992.5 mm; **100 %** of face cells | 0.000 mm |
| Text "KERF" on a Fill, mirror on (default) | 389.3 mm × 0.1 mm hatch = 38.9 mm² of 84.0 mm² face = **46 %** | 0.508 mm (edge cells, 0.19 %) |
| Text "KERF" on a Fill, mirror off | 807.4 mm × 0.1 = 80.7 of 84.75 mm² = **95 %** | 0.329 mm (edge) |

- With mirror on, the damage is the overlap between the art and its own mirror image.
- Symmetric art (O, H, X, a round seal) loses the whole face, even with mirror on.
- The stamp operation alone puts exactly 0 mm on the face, so the damage comes entirely from the kept source operation.

**Grade.** It meets the severity table's P1 row: "harms a job (wrong burn)".
- The obvious journey is Apply, set power, Start. On that journey 46–100 % of the raised face is engraved away.
- The canvas shows a perfect stamp, and Job Review says nothing.
- The dialog's "qualify a coupon" advice does not prevent it: the coupon burns the same way.
- I considered re-grading to P2 ("missing warning", since keeping the source is by design). I rejected it. The by-design part is only that the object is kept. Nothing makes the doubled burn visible except an optional Preview, and the result defeats the tool's purpose.

### T32-P2-1: CONFIRMED, P2 kept
- **Raster or vector?** The stamp is a raster rendering. `prepareStampSource` sends vectors through `buildBitmapFromVectors(..., renderType 'fill-all')`, which reads the object's stored `paths`. For variable text those are the template glyphs; for a barcode, the code stored when it was made.
- **Is a stamp meant to be a fixed value?** Yes. A rubber stamp is one physical object, so the reasonable expectation is either the value the job would print now (Bake Variable Text's rule) or a refusal that points to Bake Variable Text, as ADR-350 Amd 1/2 do for the outline tools. The tool does neither: it bakes the template text.
- **Variable text measurement (R3).** "LOT {{serial:3}}", value "LOT 007":

  | Measure | Result |
  |---|---|
  | `canPrepareStamp` | true |
  | Stamp face width | 55.355 mm |
  | Independent render of the template | 55.355 mm |
  | Independent render of the value | 28.945 mm |
  | IoU of the face with the template render | **97.97 %** |
  | IoU of the face with the value render | **18.97 %** |

  - The stamp has no `variableTemplate`, and its label is "LOT {{serial:3}} (bitmap) (stamp height intent)".
  - The source text itself still burns the value: 28.945 mm wide with the stamp operation off.
- **Variable barcode measurement (R4).** Stored 00100, project serial 117:
  - `canPrepareStamp` is true.
  - The canvas object (`deriveVariableBarcodeDisplay` after `encodeWaiting`) differs from the stored one.
  - The stamp face differs from an independent even-odd render of the **stored** code in **0 of 54,285 px**, and from the code the **canvas shows** in **6,109 px**.
  - So the bars on the stamp encode a code that is not on screen, with no notice.
- **Why P2 and not P1:**
  - For text, the braces are plainly visible in the mandatory review. The default preview tab is "Height map" (`use-stamp-preparation.ts`), and the face is 1.9× the value's width.
  - The source object keeps burning correctly. Only the new stamp is wrong.
  - The barcode case is silent, but its trigger (making a stamp of a variable barcode) is rare. Its harm is limited to the stamp object.
- **Why not lower:** it is a wrong result. ADR-350 Amd 1 limits ADR-386 Amd 2's stored-code acceptance to "Convert to Path alone".

### P3 spot checks (R6)
- **P3-1.** A stamp with 1,916 intermediate-grey shoulder pixels emits a single power level: `S300` for 639.4 mm. The stamp image has `dither: 'floyd-steinberg'` (`stamp-preparation-actions.ts:52`).
- **P3-2.** With only an open path selected, `canPrepareStamp` is false while the menu stays enabled (`stamp-preparation-command.ts:5`, `hasSelection` only).
- **P3-3.** WORKFLOW.md contains "Prepare Stamp" 0 times. F-A7e2 (Fill Ramp for rubber stamps) does not mention the tool.
- **H5-P3-3 (known).** Source operation 25 lines/mm and source image field 10 give a stamp operation at **10** lines/mm (power 30 % against the source operation's 55 %). The code is still at `:53` and `:74`. H5 was READ only, so this is the first run reproduction.

## Extra findings

### T32R-P1-1: Convert to Bitmap freezes variable text into template glyphs and deletes the source (same root as T32-P2-1, T22 area, unguarded)
- **Severity: P1.** This follows the T26-P1-1 / T28-P1-1 / T29-P1-1 / T30-P1-1 precedent:
  - the burn changes from the value to the literal template;
  - the serial stops advancing;
  - the canvas does not change, because it already draws the template glyphs;
  - the only message is the toast "Converted to bitmap: …".
  - Unlike Prepare Stamp, Convert to Bitmap **removes the source** (`convert-to-bitmap.ts:51-55`), so nothing burns the value any more.
- **Where:**
  - `selectedConvertibleVectors` (`selection-command-state.ts:86-96`) and `isConvertibleVector` (`bitmap-assembly`) accept `text` and `shape` with no `objectVariableTemplate` / `geometryToolSkipReasons` check.
  - `bitmap-conversion.ts:16-70` converts them.
  - No raster or bitmap module references the guard (searched `src/ui` for `objectVariableTemplate|variableTemplate` in `*bitmap*|*raster*|*stamp*`: no hits).
- **Repro:** `zz-t32r\r32.test.ts` R5. "LOT {{serial:3}}" at serial 7, Tinos 8 mm, 254 DPI, Fill All.
  - Before: the burn is 28.945 mm wide, which is the independent render of "LOT 007".
  - After the real `applyConvertToBitmap`: the objects are `raster-image` only. The burn is **55.355 mm** wide, which is the template width. The G-code at serial 7 and at serial 8 is **identical**.
- **Not covered:** the variable-barcode case for Convert to Bitmap is READ only. It goes through the same `buildBitmapFromVectors` from stored paths, so it should freeze the stored code.
- **Not in earlier ledgers:** I searched `docs/**` and `reports/` for Convert to Bitmap together with variable/serial/template. T22's auditor report does not raise it.
- **Suggested fix:** one fix covers both tools. Apply `geometryToolSkipReasons(scene, 'variable')` in `selectedConvertibleVectors`/the Convert to Bitmap host and in `canPrepareStamp`, with the shared "use Bake Variable Text first" notice.

## Totals
Verdicts: T32-P1-1 CONFIRMED (P1 kept); T32-P2-1 CONFIRMED (P2 kept); T32-P3-1/2/3 confirmed; H5-P3-3 still accurate. Extra raised: 1 (T32R-P1-1 Convert to Bitmap freezes variable text into template glyphs and deletes the source; P1, T22 area).
