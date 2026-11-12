# T13 Image Studio — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.edit-image`.

## Map
- Menu: `src/ui/commands/app-menu-groups.ts:136` (Tools → Image) → `src/ui/commands/command-raster-family.ts:114` → `editImageAction` (`src/ui/commands/edit-image-action.ts`): a selected raster opens directly; otherwise pick + import, then open.
- Session store: `src/ui/image-editor/image-editor-store.ts` (ephemeral, outside project Undo). Open / close / stash / Apply: `image-editor-lifecycle.ts`; ownership fences: `image-editor-ownership.ts` (exact owner for async completions, `ownersShareSource` for reopen, ADR-311 Amd 2).
- Open: `editor-project-document.ts:openProjectPhoto` → saved `editorDocument` layers (lossless), or `image-editor-decode.ts:decodeRasterToBuffer` (loader output, then `straightColourForEditor` undoes the over-white composite and **keeps alpha on the Background layer**, `image-editor-decode.ts:34-62`, since #1020, 2026-09-29).
- Adjust / Filter dialog: `adjust-dialog-store.ts` → preview `adjust-preview-window.ts` (pointwise ops on an area-averaged window at `min(1, view.scale)`, ADR-245 Amd 1; neighbourhood filters at full resolution, in a worker above 512² px, ADR-245 Amd 2, `adjust-filter-preview.ts`) → OK = `editor-adjust-session.ts:commitAdjustment` → `editor-adjustments.ts:runAdjustment` → core `src/core/image-adjust/*` (LUTs `lut.ts`/`tone-luts.ts`/`levels.ts`/`curves.ts`, `gaussian-blur.ts`+`box-blur.ts`, `unsharp-mask.ts`, `high-pass.ts`, `median.ts`, `halftone.ts`, `remove-white-background.ts`).
- Apply: `image-editor-lifecycle.ts:runApply` → `bakeProjectPhoto` (white-backed composite → PNG `dataUrl` + BT.601 `lumaBase64`; lossless `editorDocument`) → `src/ui/state/image-edit-actions.ts:applyEdit` (one project Undo entry; strips `imageAsset`; other objects untouched). Compile reads only `lumaBase64` (`src/core/job/raster-luma-decode.ts`).
- Governing: ADR-242 (+ Amd 1 screens on the pixel grid, Amd 2 whole-pixel pitch), ADR-245 (§4 "The Background layer keeps the white-is-empty convention", §5 one composite path) + Amd 1 (display-resolution preview) + Amd 2 (worker filter previews), ADR-246, ADR-311 Amd 2, ADR-590 (128 MiB saved-document bound), ADR-671 Amd 1 (gamma direction text).
- Since 2026-10-16 (git log on origin/main): af73018d0 (v2 23-P2-1..3: heal on transparent layers, opacity Undo flood, stash drop, #1371), f3e535e79, 64ac38583 (Q3-P2-1 screens track tone at 0°/90°, ADR-242 Amd 1), 3a8acb3bb (#1578, S5-P2-1, ADR-245 Amd 1), 4e6c2a00e (O6-P3-1 whole-pixel pitch, ADR-242 Amd 2), 5a8f7e596 / 111d49b1a (#1804, ADR-245 Amd 2), ab3226fd1 / 26ead0e8e (C2 tidy-ups), 7e02b344d (ADR-706 shortcuts).

## October register re-check
Row #20 ("tile history, source ownership, apply; 1024² adjustment undo/redo; 512² sigma-50 blur; max latency unqualified"):
- Pixel inversion, Apply and exact project Undo: **still hold** — B1: applied luma equals my oracle on all 1,728 pixels; project Undo restores the project JSON byte for byte, Redo restores the applied project byte for byte.
- Source ownership: **still holds** — B1/B2: an image sharing the same source/dataUrl/luma is byte-identical after Apply on its twin; two stashed sessions on twin images each apply only to their own object; a duplicate of an applied image (sharing `editorDocument`) edits independently.
- 1024² adjustment undo/redo and 512²... σ-50 blur: the regressions still exist and pass (`editor-tools-stress.test.ts`: "restores all channels through adjustment undo and redo on a megapixel image", "keeps flat-image colour and alpha invariant at a large Gaussian radius").
- Max latency: now qualified by ADR-245 Amd 1/2 (display-resolution preview, worker filters); not re-measured (no browser run).

## Checks run
| Check | Method | Result |
|---|---|---|
| Invert, Desaturate, Threshold 128 / 1, Levels (identity; 20/230 γ1.8 10/245; γ0.5), B/C identity, Curves identity | own reference code (255−v, BT.601 luma, GIMP `pow(t,1/γ)`), 48×36 synthetic photo, real `commitAdjustment` (`zz-t13/t13a.test.ts`, log `t13a.log`) | 0 differing bytes in every case |
| Gamma direction | Levels γ2 on grey 128 | 181 = GIMP `255·(128/255)^0.5`; higher gamma lightens, same as the app's other gamma fields (O6-P2-1 kept that direction, ADR-671 Amd 1) |
| Gaussian blur σ 0.5…50 | exact edge-clamped Gaussian (6σ kernel) | σ < 2 exact kernel: max 0–1 level; σ ≥ 2 (three boxes): max 2–3 levels, mean ≤ 0.41 |
| Unsharp mask / High Pass | `v + a(v − G)` with threshold; `v − G + 128` | High Pass max 1–3; USM max 1 at 100%/σ1, 7 at 150%/σ2/thr 4, 8 at 500%/σ3 (box error × amount; see limits) |
| Median r 1, 2, 4 | own sorted-window median, edge clamp | 0 differing bytes |
| Halftone / Line screen | flat patches 96², 9 greys × 0/15/45/90° × pitch 4, 8, 7.6 | coverage within 0.34% of ink (line screen at 45°: 1.1–1.8%); solid black 100%, white 0%; output strictly 0/255; typed pitch 7.6 → period 8, 7.4 → 7 (whole pixels, ADR-242 Amd 2). Q3-P2-1 stays fixed |
| 1:1 preview vs OK | `computeAdjustPreview` vs composite after `commitAdjustment`, all 14 adjustments × {single layer; feathered selection; alpha background + 70% multiply upper layer + selection} | byte-identical in all 42 cases; preview never touched the document |
| Fit-view preview vs OK | `computeWindowPreview` at 25% vs area average of committed composite (`t13a.log` A4, `t13c.log` C2) | Invert 0, Levels γ2 6 levels; **Threshold: 1-px dark lines vanish in the preview (0% black) but OK keeps them (16.7% black); a 64/192 checkerboard previews solid white, shows 50% grey after OK** (T13-P3-1) |
| Studio Undo / Redo | 3 committed adjustments, undo ×3, redo ×3 | exact both ways |
| Apply through the real store | open (decode mocked to my buffer) → Levels → Invert → Threshold via dialog store → `apply()`; bake mocked with the same contract (app's own luma function, my own PNG encoder) (`t13b.test.ts`) | luma 0/1,728 differ from oracle; `editorDocument` layer 0 differ; one Undo entry; success toast |
| Burn | `prepareOutput` → `emitPreparedGcode`; own decoder; Grayscale, 1 line/mm | G-code of the applied project is identical to G-code of a hand-built project carrying my oracle luma; decoded lit pixel centres 0/1,728 disagree with oracle black; S 800 = 80% × 1000 |
| Save / reopen | `serializeProject` → `deserializeProject`; reopen in Studio | luma, `editorDocument` and G-code identical; Studio composite from the saved layers 0 differ |
| Cancel / Close | adjust Cancel; Close with unapplied edits | doc and revision unchanged; project JSON unchanged, no Undo entry, no toast |
| Transparency (real decode) | loader output = `compositeRgbOverWhitePreservingAlpha` of a black logo on a transparent PNG; real `decodeRasterToBuffer`; Invert; Apply; burn (`t13c.test.ts`) | **burn after Studio Invert: 0 mm; layer Negative image on the same image: 1,260 mm** (T13-P2-1). Over-white round trip of the decode itself: 0 levels error over all 65,280 (a, s) pairs |
| Large image | 4032×3024 with 3 layers → Apply | refused: "Photo layers exceed the 128 MiB editable document limit…"; project unchanged, session kept — KNOWN rolling v2 23-P3-5, still open |
| Existing suites | Vitest, 6 files (`editor-tools-stress`, `adjust-apply-golden`, `adjust-preview-window`, `image-editor-decode`, `image-editor-ownership`, `editor-project-persistence`) | 25/25 pass |
| Crop vs owned image clip | read `appliedBounds` and `bakedImageMaskClip` | clip lives in the image's local mm frame, not relative to bounds, so a Studio crop does not move it. No issue |
| LightBurn | docs: Adjust Image, Cut Settings → Image Mode | No Studio-equivalent editor. Output inversion is Image Mode "Negative Image"; docs say nothing about transparency |

## Findings

### T13-P2-1: Studio Invert on a picture with a transparent background (a typical logo PNG) bakes a blank image that burns nothing; the layer's own Negative image burns the inverse
- **Severity P2:** a wrong result the user is likely to notice (the Studio canvas also goes blank, so the burn matches the screen and nothing is hidden). The common job is "invert my logo for slate/anodised aluminium". Studio Invert silently gives a blank job, and the app's two inverts disagree. A refuter could argue for P3 on Photoshop parity: Photoshop's Invert also keeps a layer's alpha.
- **Where:** `src/ui/image-editor/image-editor-decode.ts:34-62` keeps the imported alpha on the **Background** layer (straight colour; fully transparent pixels become RGB 255 with alpha 0). `src/core/image-adjust/lut.ts:47-66` (`applyLutInPlace`) and `:72-92` (`applyLumaLutInPlace`) map RGB and never touch alpha. `editor-session-layers.ts:224-232` composites over white. Contract: ADR-245 §4 ("The Background layer keeps the white-is-empty convention (ADR-242)"); `tone-luts.ts:49-52` says Threshold gives "pure line-art the tracer and engraver read unambiguously".
- **Repro:** `C:\Users\stolk\kd-t1\zz-t13\t13c.test.ts` (C1), log `t13c.log`. Run from the tree: `node node_modules/vitest/vitest.mjs run --config ../zz-t13/vitest.config.mts --maxWorkers=1 t13c.test.ts` with `NODE_OPTIONS=--no-experimental-webstorage`. A 24×8 logo (black bar, 1-px rim at alpha 128, the rest transparent) goes through the real decode, Invert and Apply:
  - Background alpha row 3 after decode: `0,0,0,0,0,128,255…255,128,0,0,0,0,0`.
  - Studio composite after Invert: all 255. Applied luma: all 255.
  - Burn: original 660 mm lit. **After Studio Invert + Apply: 0 mm, 0 moves.** The same original with the layer's Negative image: 1,260 mm.
  - Expected inverted luma row 3 (255 − imported): `0,0,0,0,0,128,255…255,128,0,0,0,0,0`.
- **Second symptom, same cause** (`t13b.log` B4): Threshold 128 on an alpha-ramp black edge leaves the applied luma unchanged (`255,238,…,17,0` in and out). Antialiased or semi-transparent areas stay grey after "Threshold", so it does not give the promised two-level line art.
- **Oracle:** the app's own Negative image (`core/raster/luma-adjust.ts:maybeInvertLuma` inverts the over-white luma). ADR-245 §4 white-is-empty Background. My inversion of the imported over-white luma.
- **Suggested fix:** keep imported tone exactly but make the Background opaque: hand it the over-white RGB with alpha 255. Imported alpha could stay available as a selection, or an upper layer for "Remove white background". Alternatively, point adjustments on the Background could composite it over white first. Add a test: Invert / Threshold of a transparent-background logo, then Apply.

### T13-P3-1: At fit view the Threshold / Posterize preview can hide whole areas of fine detail that OK keeps (ADR-245 Amd 1 says "an edge can differ by a screen pixel")
- **Severity P3:** the burn is not affected (OK runs at full resolution, and the canvas shows the true result after OK), but the user tunes the level on a preview that misleads. Repro run, capped at P3 because Amd 1 accepted a display-resolution preview.
- **Where:** `src/ui/image-editor/adjust-preview-window.ts:106-108` (LUT applied to area-averaged samples); ADR-245 Amd 1 Decision 6.
- **Repro:** `zz-t13/t13c.test.ts` C2 and `t13a.test.ts` A4. White page with 1-px lines (luma 30) every 6 px, Threshold 128, view 25%: preview 0.000 black (lines gone), after OK 0.167 black. A 1-px 64/192 checkerboard: preview solid 255, after OK displayed 128 (difference 127 levels).
- **Oracle:** area average of the committed full-resolution composite (what the canvas draws after OK).
- **Suggested fix:** for non-linear point ops (Threshold, Posterize, steep Curves), average after the LUT (map each source pixel of the window, then box-average). Or correct Amd 1 §6 to say detail finer than a screen pixel can disappear from the preview.

### T13-P3-2: Image Studio's Levels "Gamma" does not say which way it moves the midtones (READ ONLY)
- **Severity P3:** wording. ADR-671 Amd 1 ("Every image Gamma field states which way it moves the midtones") added the shared sentence (`ui/raster/gamma-direction.ts`) to Adjust Image, Shape properties and Photo engraving only. `AdjustDialog.tsx` / `editor-adjustments.ts:104` label it plain "Gamma". The direction itself is correct and consistent (γ2 on 128 → 181, higher lightens; Photoshop/GIMP Levels agree).
- **Where:** `src/ui/image-editor/editor-adjustments.ts:104`, `src/ui/image-editor/AdjustDialog.tsx:173-206`.
- **Suggested fix:** show the shared gamma-direction sentence under the Levels Gamma slider.

## Not a defect / limits
- **Unsharp Mask** at high amounts is up to 7–8 levels from an exact-Gaussian USM, because the σ ≥ 2 three-box blur (≤ 2–3 levels, O6 verified ≤ 2.4) is multiplied by the amount (1.5–5×). This is inside the Filter Effects box-blur allowance; no burn-visible defect.
- **Threshold / filters on upper paint layers ignore alpha:** blur, median, USM and High Pass are KNOWN rolling v2 23-P3-2, not re-run. Keeping alpha on a transparent *upper* layer for LUT ops is Photoshop parity; T13-P2-1 is about the Background layer, which ADR-245 §4 makes white-is-empty.
- **128 MiB Apply refusal** (12 MP × 3 layers; the Resize dialog admits 8192², which can never be applied): KNOWN rolling v2 23-P3-5, still open (B5 reproduced the refusal; the project and session are kept).
- Fit-view preview of Levels differs by up to 6 levels from the after-OK display (averaging before a non-linear curve). Within Amd 1.
- Levels lets Input black exceed Input white (degenerates to a hard threshold at the black point, `levels.ts:31`); Photoshop prevents crossing. Not raised.
- **Not checked:**
  - no browser run (memory gate about 2.9 GB, brief says no browser): keyboard, focus, dialog wording, real PNG encode (`canvas.toBlob`) and worker previews were not exercised;
  - Apply's bake was mocked with the same contract, using the app's own luma function and my own PNG encoder; jsdom has no canvas encoder;
  - 16-bit PNG decode, worker cancellation and real 12 MP latency were not measured;
  - paint, heal, clone, transform and crop tools were only read.

## Totals
Raised 3; P1 0; P2 1; P3 2; known 2 (rolling v2 23-P3-5 128 MiB Apply refusal — re-run, still open; rolling v2 23-P3-2 filters ignore layer alpha — not re-run).
