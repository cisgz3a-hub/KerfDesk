# T13 Image Studio — refuter report
Tree: origin/main @ 49ced452b (read-only export `C:\Users\stolk\kd-t1\t13-main`). Command id: `tools.edit-image`.
Method: my own Vitest file `C:\Users\stolk\kd-t1\zz-t13r\r13.test.ts` (config `zz-t13r\vitest.config.mts`, log `zz-t13r\r13.log`). Run from the tree:
`NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t13r/vitest.config.mts --maxWorkers=1 r13.test.ts` (3/3 pass, 8 s, free memory 2.7 GB).
The test is independent of the auditor's scripts. It uses its own straight-RGBA logo, its own W3C over-white composite as the loader's output, the **real** `decodeRasterToBuffer` (only the file read and canvas decode are mocked), real `createSession` / `commitAdjustment` / `compositeSession`, real `compileJob` + `grblStrategy.emit` + `runPreflight`, and its own G-code lit-length parser.

## Verdicts

### T13-P2-1 — Studio Invert on a transparent-background logo bakes a blank image: **CONFIRMED, P2**
Attempts to refute, and why each fails:
1. **"Alpha-preserving Invert is intended."** Nothing documents it. `lut.ts:44` says only "The alpha channel is never touched", which is right for upper layers. ADR-245 §4 sets the opposite contract for the Background: "Upper layers start transparent … The Background layer keeps the white-is-empty convention (ADR-242)". The code treats the Background as opaque everywhere else. The eraser paints the background colour there, not transparency (`editor-session.ts:313`, `erase: … activeLayerId !== BACKGROUND_LAYER_ID`). WORKFLOW F-L1 says erasing goes "to white — white is 'no burn'". The Studio never shows transparency: there is no checkerboard in any `image-editor/*.tsx`. The help tip (`image-tool-tutorials.ts:318`) says only "Invert and Desaturate apply immediately". The alpha on the Background is a side effect of #1020 (2026-09-29, "straight colour in Image Studio"). That change fixed a double alpha composite, and its comment explains that it keeps alpha "so tools that read alpha still see it". It did not decide what point adjustments should do. No ledger has it: I searched `docs/audits/**` for Invert or Threshold together with alpha or transparent, and found only rolling v2 23-P2-1 / 23-P3-2, which are different tools.
2. **"Photoshop parity."** The pixel maths does match Photoshop. R3 inverts straight RGB, keeps alpha and flattens on white, and gets a value set of {255}, so an invert done in Photoshop and re-imported is also blank. But in Photoshop a transparent PNG opens as "Layer 0" (not "Background") over a checkerboard, so the user sees a white logo on transparency. KerfDesk calls the layer "Background", gives it Background eraser semantics and shows the over-white composite. On that surface the expected result is the over-white inverse, which the app's own layer **Negative image** and LightBurn's Negative Image both produce. So the parity defence fails on KerfDesk's own ADR-245 §4 contract.
3. **"Rare path: import flattens alpha."** It does not. `import-image-action.ts:122-124` stores the original file bytes (`readFileAsDataUrl(file)`) as `dataUrl`. Only `lumaBase64` is flattened over white. The Studio decodes `dataUrl` (paged imports: the same bytes via `readRasterSourceFile`). The loader keeps alpha (`composited-pixels.ts:11-23`, `compositeRgbOverWhitePreservingAlpha`), and the decode keeps it on the Background (`image-editor-decode.ts:43-56`). So every PNG logo with transparency reaches the Studio with alpha intact: the common "logo.png" case. A second route needs no PNG at all. **Clean up white paper** (the first Prepare-your-photo quick action, `PhotoQuickActions.tsx:11-15`) puts alpha on the Background of any JPEG. After it, Invert is blank as well (R2).
4. **"Hidden or harmless."** It is not hidden: the canvas draws `compositeSession` (`composite-cache.ts:59`), which is all white before Apply, and the step is undoable. That is why it is not P1. Nothing in Job Review names the cause:
   - Image alone: Start refuses with `empty-output: Internal error: G-code generation produced no cuts.` (see T13R-P3-1).
   - Image plus a cut outline (a typical coaster job): **no issue at all**. The outline cuts (140 mm) and the logo burns 0 mm.

Evidence (R1, `r13.log`): a 32×12 logo has a black 16×4 core and a 1-px rim at alpha 128. The rest is transparent, with RGB 0 as most exporters write it.
- Background alpha on row 3 after the real decode: `0×7, 128×18, 0×7`.
- Composite after Invert: every pixel is 255. 320 of 384 pixels differ from 255 − imported luma.
- Burn at threshold, 1 line/mm:

| Case | Lit length | Moves |
|---|---|---|
| Original | 108.0 mm | 6 |
| **Studio Invert + Apply luma** | **0.0 mm** | **0** |
| Layer Negative image | 276.0 mm | 18 |
| My own 255 − luma | 276.0 mm | 18 |

Severity: **P2** under AREAS.md ("a wrong result the user is likely to notice"). Precedent: rolling v2 23-P2-1 (Spot heal after Clean up white paper; visible before Apply, undoable) was confirmed at P2.

**Note for the fix.** The auditor's main suggestion is to make the imported Background opaque. That alone does **not** cover the Clean up white paper route, because that route adds alpha to the Background after open (see T13R-P2-1). The alternative fix covers both routes: run point adjustments on the Background's over-white colour, or premultiply.

### Auditor's other items (not asked, noted)
- **T13-P3-1** (fit-view Threshold / Posterize preview hides fine detail) is **KNOWN**: rolling v10 **V5-P3-1** (`docs/audits/2026-11-07-rolling-v10/V5-fix-photo-image-trace.md:29`, same file, same Amd 1 decision 6, same fix direction). Count it as known, not new.

## Evidence
- `C:\Users\stolk\kd-t1\zz-t13r\r13.test.ts` — R1 (transparent logo, Invert, burn, preflight), R2 (opaque scan, Clean up white paper, then Black & white / Invert), R3 (Photoshop-style oracle).
- `C:\Users\stolk\kd-t1\zz-t13r\r13.log` — raw output quoted above and below.
- Reads: `image-editor-decode.ts:36-69`, `lut.ts:42-92`, `editor-session-layers.ts:220-232`, `editor-composite-identity.ts` (the fast path applies only to an opaque layer, so the white backing is always used when alpha exists), `editor-session.ts:313`, `import-image-action.ts:122-124`, `composited-pixels.ts:11-23`, `PhotoQuickActions.tsx:6-31`, `preflight.ts:208-239`, `blocking-codes.ts:31-50`, DECISIONS.md ADR-242 / ADR-245, WORKFLOW F-L1/F-L2, `git show 01c49d2f5` (#1020) in the main checkout (read-only).

## Extra findings

### T13R-P2-1: "Black & white" after "Clean up white paper" (the Prepare-your-photo quick actions, in order) changes nothing, and Invert after it blanks the image. This hits any photo or scan, JPEG included.
- **Severity P2:** a wrong result the user is likely to notice (the canvas does not change). These are the panel's two headline actions, and running them in order is the natural "scan a drawing → clean line art" workflow. It is visible before Apply and undoable, so it is not P1. Same class as rolling v2 23-P2-1 (P2).
- **Where:**
  - `src/core/image-adjust/remove-white-background.ts:30-50` turns paper and ink into straight black with alpha, on the Background too, per `PhotoQuickActions.tsx:11-15`: "Make white paper transparent on the active layer".
  - `src/core/image-adjust/lut.ts:72-92` (`applyLumaLutInPlace`) then thresholds the straight RGB, which is now all black (luma 0 → 0), and never reads alpha.
  - `src/core/image-adjust/lut.ts:46-66` (Invert) turns the straight black into straight white, and over white that is blank.
  - Contract: `tone-luts.ts:49-52` promises Threshold gives "pure line-art", and ADR-245 §4 keeps the Background white-is-empty.
- **Repro (R2, ran):** an opaque 32×12 scan with paper 245, ink 20, a smudge at 200 and an edge at 128 goes through the real decode and opens. Then Clean up white paper (default cleanup 0%), then Black & white (default threshold 128).
  - Row 5 after clean-up: `245×7,128,20×16,245,245,200,200,200,245×3` (the composite is unchanged, by design). The Background alpha is now `10…127,235…,55…`.
  - **Row 5 after Black & white: identical (`245…,128,20…,200…`). Distinct composite values are {20, 128, 200, 245}: not two-level.**
  - Expected (the same Threshold without the clean-up): `255×8,0×16,255×8`.
  - Clean-up then Invert: the composite is all 255. The burn is 0.0 mm and the standalone job is refused with `empty-output: Internal error…`.
- **Oracle:** Threshold of the over-white composite. The clean-up preserves the composite (`O6-image-maths-truth.md:155`, ≤ 0.49 levels), so Black & white should give the same result with or without it. My row without clean-up is that result.
- **Relation to T13-P2-1:** same root (point LUTs ignore Background alpha), different trigger. An import-only fix (an opaque Background on open) leaves this one open. One fix covers both: for the Background layer, point adjustments should map the over-white colour and write it opaque (or work premultiplied). Add a test: clean-up → Threshold gives only {0, 255}; clean-up → Invert is not blank.
- **Not known:** I searched `docs/audits/**` for "Clean up white paper" / remove-white-background. The only hits are 23-P2-1 (Spot heal), V5-P3-1 (preview) and the O6 maths check. None covers Threshold or Invert after clean-up.

### T13R-P3-1: an all-white image refused at Start is reported as "Internal error: G-code generation produced no cuts." (READ + RUN)
- **Severity P3:** wording. The refusal itself is correct (`empty-output` is compile integrity, `blocking-codes.ts:41`). But a user who has just inverted or erased an image to white is told that the program had an internal error, not that the image has no dark pixels to burn.
- **Where:** `src/core/preflight/preflight.ts:236-238` (`emptyOutputIssue` names only the relief case).
- **Repro:** R1 / R2 `burn(...)` on the blank applied luma gives `issues ["empty-output: Internal error: G-code generation produced no cuts."]`. With a cut outline in the same job, no issue is raised and the image silently contributes 0 mm.
- **Suggested fix:** when every output object on the empty job is a raster image, say "The image on <layer> has no pixels dark enough to burn (it is all white)". Consider an advisory when one raster in a mixed job emits nothing.
- **Known?** Rolling v2 03 P2-4 quotes the same message for a different cause (an `$30=1` power collapse) but did not raise the wording.

## Totals
Verdicts: T13-P2-1 CONFIRMED (P2). Extra raised 2: P1 0; P2 1 (T13R-P2-1); P3 1 (T13R-P3-1). Known noted 1: the auditor's T13-P3-1 = rolling v10 V5-P3-1.
