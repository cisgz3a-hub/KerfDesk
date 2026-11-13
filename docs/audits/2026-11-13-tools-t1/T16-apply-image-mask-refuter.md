# T16 Apply Mask to Image — refuter report
Tree: origin/main @ 49ced452b (read-only). Command id: `tools.apply-image-mask`. Scratch: `C:\Users\stolk\kd-t1\zz-t16r`.
Method: I did not re-run the auditor's G-code decoder. I sampled the real mask pixel test (`createImageMaskPixelTest`) and the real Fill contours (`collectFillContoursForLayer`) on a 0.05 mm grid. I compared both with my own signed-crossing non-zero winding oracle (`r1.test.ts`). For the canvas I drew a whole frame with `drawScene`, after the real store `applyImageMask`, into a context that records the clip stack (`r2.test.tsx`). Logs: `r1.log`, `r2.log`. Vitest ran with `--maxWorkers=1` and an explicit file list (free memory 1.53–2.55 GB at start). No browser, no pnpm, no tree edits.

## Verdicts

| Claim | Verdict |
|---|---|
| T16-P2-1 mask ignores the non-zero fill rule | **CONFIRMED, P2 kept, reach corrected.** The defect is real: the mask and Fill disagree on the same object. But the auditor's main case is wrong. New text is **welded by default** (ADR-321 D1; `use-text-dialog-fields.ts:203` `useState(editing ? (state.weldOverlaps ?? false) : true)`, used by both AddTextDialog and CanvasTextEditor). Welded script text masks exactly like its Fill: 0 mm² interior miss across all 9 bundled script fonts. The remaining reach is unwelded text (projects from before 2026-09-12, or weld turned off) and SVGs with `fill-rule: nonzero` and overlaps. There is also a wider case the auditor missed, and his suggested fix would not cover it (T16R-P2-1). |
| T16-P2-2 canvas draws the whole photo | **CONFIRMED, P2.** Not a documented choice. Every document that mentions it (ADR-633 Amd 2 and 3 Context, H5-P1-1, the J9-P1-1 refuter) names it as a *cause* of harm. None accepts it. |

## Evidence

### T16-P2-1
- **Is even-odd a documented choice? No.** No ADR or WORKFLOW section weighs the fill rule for an external image mask.
  - ADR-480 and Amd 1 only describe the *owned* clip as "the even-odd clip that SVG import gives an image" (storage format, ADR-358).
  - ADR-633 Amd 3 D3 says the preflight share uses "the even-odd rule compile uses". That describes the rule; it does not decide it.
  - ADR-286 is scoped to V-carve and records that "No ADR anywhere weighed even-odd against non-zero for text". Laser Fill then adopted per-object non-zero (`layer-fill.ts:231,248`; `fill-rule.ts:5-13`, ADR-270 Amd 1).
  - The mask code itself (`image-mask.ts:122-134`) never reads `path.fillRule`.
- **Is text accepted as a mask? Yes.** `selectedImageMaskPair` accepts any non-raster object with a closed contour (`image-mask-command-state.ts:18-20`), and `closedMaskContours` handles `text` (`image-mask.ts:125`).
- **Weld default (refutes the "Weld overlaps off, the default" premise).**
  - ADR-321 D1: "New editor sessions enable it".
  - The jig text (`jig-text-object.ts:80`) and remote text (`remote-control/text.ts:61`) also weld.
  - Only existing text with an absent or false value keeps raw contours.
- **R1a: bundled fonts, "Wedding Love" at 30 mm, mask vs non-zero oracle.** Interior miss = missed cells at least 0.2 mm inside the ink. Welded (the default for new text): mask interior miss is **0.00 mm²** for every font. The leftover miss/leak of about 1–5 mm² is equal both ways and sits on the edge. Unwelded:

  | Font | Unwelded mask interior miss | Fill of same unwelded text |
  |---|---|---|
  | Pacifico | **62.93 mm²** (mask 1896.38 vs oracle 1960.13) | 1956.41 |
  | Great Vibes | 4.74 | 742.38 vs 743.12 |
  | Dancing Script | 4.63 | 703.48 vs 704.68 |
  | Corinthia | 3.13 | — |
  | Parisienne | 3.17 | — |
  | Alex Brush | 2.69 | — |
  | Pinyon Script | 1.82 | — |
  | Allura | 1.77 | — |
  | Italianno | 0.29 | — |
  | Roboto, Anton | 0.00 (no overlaps) | — |

  So all nine bundled script fonts overlap at joins. The defect only shows when weld is off.
- **R1b: welded 2-line script, line height 0.75** (Dancing Script and Great Vibes; one render path per text): interior miss 0.00. Lines that overlap at tight leading are unioned too.
- **LightBurn.** The ApplyMaskToImage 2.0 page says the masked area is what "would normally be solidly engraved" in Fill. A mask may be "a Group of vectors (including text)". Its Layer Modes page says that for partly overlapping shapes on one layer, "the area where they overlap will not be engraved". Its Text page offers **Welded** for "when characters touch or overlap" (no default stated). So in LightBurn an unwelded overlapping text mask also leaves the overlaps out. KerfDesk's even-odd mask matches LightBurn's *output* there. It breaks LightBurn's *principle* (mask = this app's Fill area), because KerfDesk's own Fill unions per object.
- **Severity reasoning.** It stays P2 rather than P3 because the burn region inside the art is wrong against the app's own Fill of the same object, and T16R-P2-1 shows a common reach that needs neither text nor non-zero. Preview shows it, so it is not P1 under the auditor's reasoning.

### T16-P2-2
- **R2 (`r2.test.tsx`, `r2.log`).**
  - Real store `applyImageMask('PHOTO','CIRC')` → `imageMaskId=CIRC`, still 2 objects.
  - Full `drawScene` (design view, `preview: false`): 1 `drawImage` at **clip depth 0**, destination `[0,0,40,30]`, the whole photo.
  - Same image carrying the real `bakedImageMaskClip` (what Crop/Flatten store): 1 `drawImage` at **clip depth 1**.
  - No other canvas layer marks the masked area: `grep mask` in `src/ui/workspace/draw-*.ts` finds only the owned-clip import and the Preview renderer.
- **Deliberate?** No. ADR-633 Amd 2 Context says "The design canvas draws a photo without its external mask … so all three photos looked the same". Amd 3 Context says the same of the board array. The J9 refuter lists "The design canvas clips the photo to its external mask" as a condition that would have refuted the P1. None of these accepts it, and no decision gives "see or position the whole photo" as a reason. ADR-480 Amd 1 D3 ("The image looks like what it burns") points the other way, and so does LightBurn ("it just hides it from view"). It does not drop to P3.

## Extra findings

### T16R-P2-1: The mask knocks out overlaps between an object's separate paths, while Fill unions them, even when every path is even-odd
- **Severity P2.** Wrong burn region inside the art, against the same object's Fill. No text and no non-zero rule needed. Preview shows it (same ceiling as T16-P2-1). It shares T16-P2-1's root but is a separate failure: the auditor's suggested fix ("resolve per path … then combine the paths even-odd") **would keep this defect**, because Fill combines the per-path regions by non-zero union (`layer-fill.ts:248`), not even-odd.
- **Where:** `src/core/raster/image-mask.ts:122-134` flattens every path's contours into one pool, and `:161` / `mask-scanline.ts:25-45` resolve that pool even-odd. Fill resolves each path, then unions them (`layer-fill.ts:229-249`). `parse-svg.ts:294` makes each element with a declared `fill-rule` its own `ColoredPath`, so separate overlapping elements stay separate paths.
- **Repro:** `C:\Users\stolk\kd-t1\zz-t16r\r1.test.ts` R1c (`r1.log`). One SVG with two overlapping 30 × 30 mm squares (overlap 10 × 30 mm), each `style="fill:#000000;fill-rule:evenodd"`, the way Inkscape commonly writes styles. The real `parseSvg` gives 1 object with 2 paths.
  - Mask: **1200.00 mm²**. Fill: 1500.00 mm². Oracle (what each path paints): 1500.00 mm². **296 mm² missed at least 0.2 mm inside the ink.**
  - Control: the same SVG without `fill-rule` (one path) gives Fill 1200 = mask 1200, consistent.
- **Oracle:** my own signed-crossing winding test. Each SVG element paints its own region, and KerfDesk's Fill of the same object paints their union.
- **Suggested fix:** build the mask region the way `appendFillPathContours` does. Resolve each path by `path.fillRule ?? (text ? 'nonzero' : 'evenodd')`, then non-zero-union the normalized paths. Rasterize that region. Bake the same region in `bakedImageMaskClip` and measure it in `maskShareOnImage`. Add R1c as a test.

## Not a defect / limits
- The "join lens" loss for script text is gone for new text: weld is on by default, and welded text masks equal non-zero within edge noise (R1a/R1b). Unwelded and legacy text still loses up to about 63 mm² (Pacifico).
- Fill of *unwelded* text differs from my polyline oracle by about 4–8 mm² both ways (miss ≈ leak). That is likely Fill using native curves against my polyline oracle. I did not split edge from interior for Fill, so nothing is raised.
- Deleting a mask removes the dangling `imageMaskId` (`repair-object-dependencies.ts:44-48`). Not a defect.
- Not checked: Inkscape's actual default style on this user's version (the R1c styling is representative, not captured from a file), browser rendering, hardware.

## Totals
T16-P2-1 CONFIRMED (P2, reach corrected: default text is welded and unaffected); T16-P2-2 CONFIRMED (P2, not deliberate). Extra raised 1: P1 0, P2 1 (T16R-P2-1), P3 0.
