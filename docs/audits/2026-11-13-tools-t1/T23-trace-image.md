# T23 Trace Image — auditor report
Tree: origin/main @ 1988481a5. Command id: `tools.trace-image`.

## Map
- **Command:** Tools → Trace → Trace Image… (Alt+T), `src/ui/commands/command-raster-family.ts:53,118`; enabled only with a single `raster-image` selected ("Select an image first."). Invoke = `traceImageAction` (`src/ui/commands/image-command-actions.ts:18`) → `useUiStore.openImageDialog(selected)`.
- **Dialog:** `src/ui/trace/ImportImageDialog.tsx` (`DialogBody` → `submitTraceDialog` :245 → exported `commit` :313 → `commitTraceResult` :359). Source bytes: `use-trace-source-file.ts` (`readRasterSourceFile`, then `bindTraceSourceMask` for `imageClip` / `imageMaskId`). Defaults (`use-trace-dialog-settings.ts:74-81`): preset Line Art, output Editable vectors, fill style scanline, Delete Image After trace off.
- **Trace:** `trace-commit-result.ts` (`resolveTraceCommitResult`; finer commit grid via `trace-commit-at-grid.ts`, ADR-409) → `region-enhance-trace.ts` / `trace-region.ts` → `use-trace-worker-client.ts` (worker; cooperative inline fallback ≤ 160 000 px; 30 s silence watchdog) → `src/core/trace/trace-to-paths.ts` `traceImageToColoredPaths`. Mask clip: `trace-source-mask.ts` + `trace-mask-result.ts`. Laser move simplification / CNC fairing at the live placement: `trace-machine-conditioning.ts`.
- **Commit:** `trace-output-commit.ts` → store `traceExistingImage` (`src/ui/state/import-actions.ts:87`) → `applyTraceToExisting` (`src/ui/state/scene-mutations.ts:274`) → `positionTraceOverRasterSource` (`src/ui/state/trace-placement.ts`). Operation mode: `fresh-artwork-mode.ts:24` (filled contours → Fill; Centerline/Edge → Line; Line + fill → one Fill + one Line operation). Raster scan output: `trace-raster-output.ts` → Convert to Bitmap path.
- **Presets** (`src/core/trace/trace-presets.ts`): Line Art (default), Photo shading, Centerline, Line + fill, Edge Detection, Smooth, Sharp, Colour layers. There is no preset called "Logo"; Line Art is the logo/line-art preset.
- **ADRs:** 026 (trace overlays its source), 408 (settings travel with the trace), 409 (+Amd 2) commit grid, 434 (small-mark policy), 439, 454 (Line + fill), 461 (colour layers), 530, 532, 673 (+Amd 1) kept picture engraves, Delete off by default. WORKFLOW.md F-E1 "Import and trace a raster image" (line 4754).
- **Changes since 2026-10-16** (trace dirs, 50 commits): #1484 #1495 #1496 #1497 #1502 #1517 (small marks, staircase/apex), #1587 #1594 (off-thread decode, speed), #1692 (corner spikes), #1700 #1703 (dead exports, JPEG pin test). The T16/T17 mask fixes (#1865, #1867) touch the image side, not the trace clip.

## October register re-check
Row #30 ("Line Art source retention and commit"): **still holds.** Through the real `commit` on 8 placements the source stays (objects 1 → 2, toast "Traced art.png — 1 color, source kept"), the trace lands on a new Fill operation (fill, scanline, 0.1 mm hatch, power 30, speed 1500, output on) and becomes the selection; with Delete ticked the source is removed in the same undo step ("source deleted"). The register's corpora (10 000 fuzz masks + 3000×3 saddles in `contour-boundary-parity.test.ts`, cancellation, ownership, mask parity, retrace settings) pass on this tree: 6 files, 30 tests.

## Checks run
| Check | Method | Result |
|---|---|---|
| World placement, Line Art, 8 placements (identity; rot 30; mirror X; scale 2 × 0.5 rot 45; mirror Y rot 200 with centred bounds; `imageClip` crop rot 30 scale 1.5; external world-circle mask on a rot 30 mirrored image; Delete source, rot 90 mirror) | `zz-t23/t23a.test.ts`: real dialog `commit` → store → `prepareOutput` → G-code (only the file decode replaced by the synthetic pixels, masked by the real `maskTraceSourcePixels`). Oracle: own inverse transform world → source pixel, dark-pixel test, mask in pixel space | Vector region vs pixels: area −0.2 to −0.4 %, mismatch only within 0.93 px of a pixel edge (far mismatch 0 mm² in every case), centroid within 0.03 mm. Burn: lit area +0.1 to +1.8 % (hatch rows on the global 0.1 mm grid, row on the top edge), far mismatch 0 mm², centroid within 0.12 mm (half a hatch pitch) |
| Holes and nested islands under Fill | same, per-feature coverage | Ring hole burned 1.6–2.7 % (edge band), island inside the hole 97–98 %, rectangular plate hole 0–2 %: even-odd nesting right in every placement |
| Thin lines and specks per preset | `t23a`, `zz-t23/t23b.test.ts` (Smooth, Sharp, Centerline, Line + fill, Edge Detection, Colour layers on the scale 2 × 0.5 rot 45 source) | 1, 2, 3 px lines kept by every preset. Isolated 1×1 and 2×2 black specks dropped by Line Art and Smooth, kept by Sharp; Colour layers also drops the 3×3. Both by design (ADR-434 3c, ADR-461 rule 3, Remove specks 12 px) |
| Line-type presets placement | `t23b`: every flattened vertex mapped back to source pixels | Centerline: all 412 vertices inside ink (max 0.00 px). Edge: max 0.81 px from an ink/paper border. Line + fill: 5 of 171 vertices 1.5–1.62 px off ink (stroke ends) |
| Operation defaults | `t23a`/`t23b` | Filled presets → one Fill op; Centerline, Edge → Line op; Line + fill → "art fills" Fill + "art lines" Line; Colour layers → per-colour Fill, power by darkness |
| Source grid larger than the decoded grid (1000×750 stored, 400×300 decoded), with and without a Boundary crop, rot 30 mirror, scale 1.3 × 0.8 | `zz-t23/t23e.test.ts` | Registered: far mismatch 0, centroid within 0.03 mm; crop region exactly the boundary |
| Undo / Redo | `t23a`, every case | One undo entry; Undo restores an identical project (also with Delete source); Redo restores the traced project |
| Save / reopen | `zz-t23/t23c.test.ts`: `serializeProject` → `deserializeProject` | transform, `traceSettings` (preset, overrides smoothness 0.5 / ignore 4, output, fillStyle offset), `traceSourceId`, grid identical; G-code byte-identical (33 028 B); Fill op keeps `fillStyle: offset` |
| Cancel mid-trace | `t23c`, AbortSignal at 5 ms | No toast, project object unchanged (`===`), undo stack 0 |
| Source moved/rotated before Trace | `t23c` | Trace follows the live transform (x 90, y 100, rot 15) |
| Existing suites | `trace-commit-ownership`, `ImportImageDialog.cancel`, `trace-mask-parity`, `ImportImageDialog.retrace-settings`, `contour-boundary-parity`, `trace-placement` | 6 files, 30 tests pass |
| Huge images, worker budgets | READ | inline ≤ 160 000 px, commit grid ≤ 24 MP (6 MP Centerline), 30 s silence watchdog, decode cap; as verified by rolling v2 07 Q5. Not run (memory) |

## Findings
### T23-P3-1: Line + fill's success toast counts paths as colours ("6 colors" for a two-operation trace)
- Severity: P3, wording; nothing burns differently.
- Where: `src/ui/trace/trace-output-commit.ts:198` (`const colorCount = traced.paths.length`).
- Repro: `zz-t23/t23b.test.ts`, preset Line + fill: toast "Traced art.png — 6 colors, source kept" while the trace has two colours (#000000 fills, #0000ff strokes) on two operations ("art fills", "art lines").
- Oracle: distinct `path.color` values = 2; operations created = 2.
- Suggested fix: count distinct colours (or say "fills and lines" for a hybrid trace).

### T23-P3-2: Test gap — no test sends a rotated, mirrored or masked trace through the output path and compares it with the source pixels
- Severity: P3, test gap; no defect behind it (all 10 placements here register within one source pixel).
- Where: `src/ui/state/trace-placement.test.ts` checks the transform algebra; `src/ui/trace/trace-mask-parity.test.ts` has no rotated/mirrored external mask (`scenePointToImage` in `trace-mask-result.ts:72`); no trace test calls `prepareOutput` on a transformed trace.
- Repro/oracle: `zz-t23/t23a.test.ts` + `t23-measure.ts` (inverse-map pixel oracle, far-mismatch metric) can be adopted as a regression.
- Suggested fix: add the masked rot 30 + mirror X case and the non-uniform scale case as a G-code-level regression.

## Not a defect / limits
- **Isolated 1×1 and 2×2 specks dropped by Line Art / Smooth, 3×3 by Colour layers.** ADR-434 decision 3c ("lone 2x2 specks do not" pass; "Isolated 2x2 ink squares … still removed") and ADR-461 rule 3 (Remove specks 12 px). Sharp keeps them, as WORKFLOW F-E1 says.
- **Kept source also engraves** (default Delete Image After trace off): ADR-673, as in LightBurn; WORKFLOW F-E1 says to delete it or turn its operation's Output off. The per-trace advisory is already ledgered as annoying (A5-P2-4).
- **Trace lands on a new Fill operation** rather than LightBurn's current layer: KerfDesk's fresh-artwork rule (`fresh-artwork-mode.ts`), Line modes for Centerline/Edge. Not raised.
- **Burn centroid 0.05–0.12 mm off the pixel centroid:** the Fill hatch rows sit on the global 0.1 mm grid and a row on the top edge burns (plate 83–93 mm burns rows 83.1…93.0). Fill engine behaviour, the same for any Fill object; not a trace defect.
- **Line + fill stroke ends up to 1.62 px past the ink** on a non-uniformly scaled source: close to known rolling v2 07-P3-1 (Line + fill strokes off centre); not re-raised.
- **Mask clip uses even-odd** (`trace-mask-result.ts:26`): inherits known T16-P2-1 (non-zero mask shapes); not re-raised.
- Not checked: Raster scan output end to end (the jsdom canvas stub cannot render; it reuses the Convert to Bitmap path audited in T22), Photo shading tone, huge images (> 2048 px decode, 24 MP commit grid; memory gate), the dialog in a browser (memory gate ~2.1–2.9 GB, no browser run), inch display of the Line + fill Max stroke width field. The Potrace benchmark was not re-run: placement, not fidelity, was the question, and Q4/N8/R2 cover fidelity.

## Totals
Raised 2; P1 0; P2 0; P3 2; known 0 new (context only: ADR-434/461 by design; rolling v2 07-P3-1; T16-P2-1; A5-P2-4).
