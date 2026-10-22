# Rolling audit v2 — Image editor (Image Studio)

- **When:** 2026-10-22 00:00–02:00 +0800   **Tree:** origin/main @ `902f1d0c0` (worktree HEAD
  `60d5fcd5b`; `git diff origin/main -- src/` empty; `git fetch` during the audit still showed
  `902f1d0c0`).
- **Scope:** `src/ui/image-editor/**`, `src/core/image-edit/**`, `src/core/image-layers/**`,
  `src/core/image-select/**`, `src/core/image-retouch/**`, `src/core/image-composite/**`.
  Followed into the twins and entry points:
  - Apply commit `src/ui/state/image-edit-actions.ts`; project undo budget
    `src/ui/state/undo-stack.ts`; editable-document schema and validator
    `src/core/scene/photo-editor-document.ts`, `src/io/project/project-photo-document-validator.ts`
  - Studio filters in `src/core/image-adjust/` that report 20 left to this area (Gaussian blur,
    median, remove-white-background; LUTs and halftone were report 20's)
  - Crop Image / Flatten (`src/ui/raster/crop-image.ts`), Convert to Bitmap plan and assembly
    (`src/ui/raster/bitmap-conversion-*.ts`, `bitmap-assembly.ts`) — read only
  - Raster masking `src/core/raster/image-mask.ts` (crop/clip geometry); `applyTransform`

  Pipeline mapped: decode `dataUrl`/paged source (RGB composited over white) → un-composite to
  straight RGBA (`straightColourForEditor`) → Background layer → session ops mutate the active
  layer in place behind tile/document history → one composite (`compositeSession`, cached by dirty
  window for the canvas) → Apply: synchronous composite + layer clone → PNG `dataUrl` + BT.601
  `lumaBase64` + lossless RGBA `editorDocument` → one project undo entry with pixel size and bounds
  mapped through `cropOffset` × `pixelSizeMm`.

  Governing: ADR-242, ADR-245, ADR-246 (`DECISIONS.md`), ADR-313 §2 and ADR-314 §4–5 (ownership),
  ADR-590 (editable photo layers, document Undo), WORKFLOW F-L1..F-L4, PROJECT non-negotiable 9.
  Prior audits: `2026-09-05-pr301-501-audit.md` + `-image-edit-fixes.md` (F01–F06, F351/353/354),
  `2026-09-05-feature-code-quality/features-08-14.md` §12–13 (F12-01..04, F13-01/02),
  `2026-10-15-tools-image-trace.md`, `2026-10-16-remaining-image-ai.md` (no Studio items),
  report 20 (raster).
- **Lenses run:** L3, L4, L6, L1, L7 as separate passes; L2 for the algorithm claims (W3C Filter
  Effects premultiplied filtering, GIMP feather sigma, Photoshop Delete/Opacity semantics); L5 on
  the one untrusted input in scope (`.lf2` `editorDocument`). Repros were temporary
  `zz-23-*.test.ts(x)` files next to the code (deleted), run one at a time; the largest buffer was
  12 MP for a single timing.
- **Counts:** 13 raised → refuter: 13 confirmed, 0 plausible, 0 refuted → P1 0 / P2 3 / P3 10
  (+5 KNOWN, not re-checked by the refuter). Severity change: P2-4 → P3 (performance only, output
  correct). The ID is kept for traceability.

## Headline

The geometry and the bake are right: crop, Image Size, Canvas Size, Undo across them and Revert all
keep physical size and placement exactly, and the canvas composite, the Apply bake and the burned
luma are one function. Every 2026-09 finding (F01–F06, F12-01..04, F13-01/02, F351/353/354) is fixed
on this tree. What is wrong is in the newer layer-era paths:
- Spot heal reads the active layer's raw RGB and ignores alpha, so healing after the "Clean up
  white paper" quick action, or on an empty layer, paints a solid black disc that burns at full power.
- The Layers opacity slider records a full-document Undo step per input event, so one drag becomes
  dozens of steps and, on a real photo, evicts the whole editor history.
- Closing Studio promises "the editing session is kept and resumes on reopen", but any later change
  to the image object (a 1 mm nudge) silently discards the unapplied session.
- Every session change (even a marquee) resamples every layer at full resolution for 28×21
  thumbnails: about 0.75–0.9 s per 12 MP layer. The refuter downgraded this to P3 (slow, but
  the output is correct).

## Findings

### P2-1 — Spot heal samples the active layer's straight RGB and ignores alpha: after "Clean up white paper", or on an empty layer, it paints a solid black disc

- **Where:**
  - `src/core/image-retouch/spot-heal.ts:43` (`annulusMedian(doc, …)`), `:99` (pushes RGB only,
    never alpha), `:58` (writes `alpha = max(old, strength·255)`), `:56` (blends straight RGB
    regardless of the existing alpha).
  - `src/ui/image-editor/editor-session-retouch.ts:49` passes `session.doc` (the active layer), while
    clone at `:26` samples `compositeSession(session)`.
- **Anchor:** Twin. Every other sampling tool reads what the operator sees:
  - clone (`editor-session-retouch.ts:26`), bucket (`editor-session-fill.ts:33`, "the
    transparent-active-layer lesson"), wand (`image-editor-store.ts:281-284`, "a transparent layer
    would select everything") and eyedropper (`use-editor-pointer.ts:306-312`) all sample the
    composite;
  - ADR-245 §5 (one composite = what burns); F01 (2026-09-05) made paint/fill/clone straight-alpha
    source-over, and heal was never moved to that contract.
  - Tool label: "Spot heal — click a blemish; the surround patches it" (`EditorToolStrip.tsx:71`).
- **Scenario:**
  1. Background is light paper (luma 225–231) with a dark 4 × 4 speck. The operator presses the
     **Clean up white paper** quick action (`PhotoQuickActions.tsx`, cleanup 0 %). Visually nothing
     changes (composite paper 231), but the paper pixels become straight RGB `0,0,0` with alpha 24.
  2. They click the speck with **Spot heal**. The ring median is black (alpha ignored), and the dab
     writes black with alpha up to 255.
  3. The speck becomes a black disc of the brush diameter (composite luma 0 at the centre and at
     r = 3) instead of paper. After Apply it burns at full power.
  - Same on an empty upper layer (Photoshop's "heal on a new layer" habit): the dab paints
    `0,0,0,255` over a grey 200 Background.
  - The result is visible on the Studio canvas before Apply, so it is not silent.
- **Evidence:** REPRO (temp Vitest, deleted).
  - `createSession` grey paper + speck → `commitAdjustment('remove-white-background', {cleanup:0})`
    → paper layer pixel `[0,0,0,24]`, composite 231 → `commitHealDab({32,32}, 6)` → composite at
    centre `0`, at r = 3 `0`, far paper `231`.
  - Empty upper layer over grey 200: layer pixel `[0,0,0,255]`, composite `[0,0,0,255]`. The same
    dab on the plain Background gives `[200,200,200,255]`.
  - No test covers heal with alpha < 255 or on an upper layer (`editor-session-retouch.test.ts:82`
    uses an opaque Background only).
- **Refuter:** CONFIRMED, stays P2. Own repro (64 px paper 225–231 with a 4 px speck → Clean up
  white paper at its default cleanup 0 % → `commitHealDab` r 6): the paper layer becomes `[0,0,0,30]`,
  and after heal the composite is `[0,0,0,255]` at the centre and at r 3. Cleanup 10 % also gives
  black. On an empty upper layer the dab writes `[0,0,0,255]`. Control without cleanup: 228. The
  black disc reaches the committed bitmap, because Apply bakes the same `compositeSession` into the
  PNG and luma (`editor-project-document.ts:17`), so it burns at full power. It is also visible on
  the Studio canvas before Apply, and Undo removes it, so it is not P1. It remains a broken twin
  contract with a clear failure path after a default quick action.
- **Fix direction:** Compute the ring median from the composite (as clone does) or in premultiplied
  space with alpha, and composite the repair source-over with straight alpha like every other paint
  op.

### P2-2 — One drag of the Layers opacity slider records dozens of full-document Undo steps and evicts the editor history

- **Where:**
  - `src/ui/image-editor/LayersPanel.tsx:228-236`: `<input type="range" … onChange>` calls
    `setActiveLayerProps` on every input event.
  - `src/ui/image-editor/editor-session-layers.ts:162-183` → `withLayers(…, 'Layer opacity')`
    (`:42-45`) → `captureDocumentHistory`, which clones every layer buffer and charges the Revert
    base too (`editor-document-history.ts:69-87`).
- **Anchor:** Contract.
  - WORKFLOW F-L4: "Every committed operation is one editor-local undo step".
  - ADR-246 §1 and ADR-590 ("layer metadata changes now have complete snapshots") assume one
    snapshot per metadata change, not one per input event.
- **Scenario:**
  - Dragging opacity 100 → 50 % fires up to 50 `onChange` events, so up to 50 "Layer opacity"
    History rows. Ctrl+Z steps back 1 %.
  - Each event clones all layers. For a 12 MP photo with one added layer the entry is charged
    2 × 48 MB + 48 MB base = 144 MB against the 256 MB budget
    (`EDITOR_HISTORY_BYTE_BUDGET`, `history.ts:227`). After the second event every earlier paint,
    crop or adjustment step is evicted ("N older history steps trimmed").
  - Each event also allocates ~96 MB of clones and re-runs the full composite plus every layer
    thumbnail (see P2-4), so the slider is very slow at photo sizes.
- **Evidence:** REPRO (temp Vitest, budget scaled to 1 MiB with 128 × 128 layers, so the
  proportions match the 12 MP case): one brush stroke, add layer, 50 `setActiveLayerProps` calls
  (0.99 → 0.50) → undo stack holds 5 entries, all "Layer opacity", `trimmedCount 47`, the "Brush"
  entry is gone. The real-size figures are arithmetic from `captureDocumentHistory`'s `byteSize`.
- **Refuter:** CONFIRMED, stays P2. Own repro under the **real** 256 MiB budget
  (`byteBudget 268435456`): a 500 × 500 photo, a Spot heal, Add layer, then one 100 → 0 drag
  (100 `setActiveLayerProps` calls). The result is 89 entries, all "Layer opacity",
  `trimmedCount 13`, and both "Spot heal" and "Add layer" are gone (each entry is charged
  3 000 000 B). By the same `byteSize` formula, a full drag evicts all earlier history for any
  image above about 0.45 MP with one added layer. At 12 MP, the second event evicts it. The slider
  has no coalescing, and React's range `onChange` fires on every `input` event.
- **Fix direction:** Preview opacity live without history and commit one entry on
  pointer-up/blur (or coalesce consecutive same-layer opacity entries). A metadata change could
  record only the metadata, not clone every buffer.

### P2-3 — An unapplied Studio session is silently discarded if the image object changes after Close, although Close promises it resumes

- **Where:**
  - `src/ui/image-editor/image-editor-lifecycle.ts:84-104`: a stash is resumed only when
    `ownersMatch` (exact object identity); otherwise a fresh decode replaces it
    (`stashSession(state.stash, image.id, null…)`).
  - `src/ui/image-editor/image-editor-ownership.ts:28-35, 49-51` (identity compare).
- **Anchor:** Contract.
  - Close button title "Close — the editing session is kept and resumes on reopen"
    (`ImageEditorTopBar.tsx:145`); footer "Esc closes — session is kept".
  - WORKFLOW F-L1 step 4: "reopening the same image resumes it". ADR-242 §5.
  - ADR-313 §2: "same-document reopen remains resumable" (exact identity was meant to fence
    *replacement documents*).
- **Scenario:**
  1. The operator paints for ten minutes in Studio and closes it to check placement, without Apply.
  2. They nudge the image 1 mm on the canvas, change its power override, or reassign its layer. Any
     of these creates a new object, the same id in the same document.
  3. They reopen Studio. The image decodes fresh: every stroke, layer and Undo step is gone. There
     is no toast or warning, and nothing can recover the work.
- **Evidence:** REPRO (temp Vitest, decode mocked).
  - Open → stroke (revision 1, dirty, 1 Undo) → close (stash key present) → replace the object
    with `transform.x: 1` → reopen → decode called a 2nd time, revision 0, not dirty, 0 Undo,
    stash empty.
  - The existing test `image-editor-lifecycle.test.ts:243` only covers the unchanged-object
    resume.
- **Refuter:** CONFIRMED, stays P2. Own repro (decode mocked, real store actions): open → heal dab
  (revision 1, dirty, 1 Undo) → close (stash key `img`). Then `selectObject` +
  `nudgeSelection(1, 0)` creates a new object with `transform.x 1`. On reopen the stash is emptied
  at once, decode is called a 2nd time, and the session is revision 0, not dirty, 0 Undo, with no
  toast. The exact copy is the Close title "Close — the editing session is kept and resumes on
  reopen" (`ImageEditorTopBar.tsx:145`) and the footer "Esc closes — session is kept · Apply
  commits one undo step" (`ImageEditorOverlay.tsx:174`).
  - Exact-object identity is deliberate (ADR-313 §1 binds Edit Image to the exact object owner;
    the test at `:243` is named "only while the same project image still owns the id"). But
    dropping the stash silently contradicts the copy.
  - A project Undo of the nudge *before* reopening restores the identical object and the session
    resumes. That is not discoverable.
  - Not P1: the work was never applied, and F-L4 already treats unapplied sessions as volatile.
- **Fix direction:** Key resumability on document epoch + object id + pixel identity (`dataUrl`,
  `imageAsset`, pixel size). Rebase `sourceBounds` if bounds changed. When a stash really must be
  dropped, say so instead of discarding it silently.

### P2-4 (refuter: severity now P3) — The Layers panel resamples every layer at full resolution on every session change (even a selection), about 0.9 s per 12 MP layer

- **Where:** `src/ui/image-editor/LayersPanel.tsx:119-143`.
  - The `LayerThumbnail` inline `ref` callback (`:130`) calls
    `resampleBuffer(layer.buffer, 28, 21)` on every render.
  - The panel subscribes to the whole `session` (`:29`), and the dock is open by default
    (`ImageEditorOverlay.tsx:45`).
- **Anchor:** Contract.
  - ADR-245 Consequences: "Editing stays exactly as fast as today… rendering pays one full-doc
    composite per committed op."
  - ADR-246 §2 makes selection-only changes cost nothing to recomposite (`EMPTY_DIRTY_RECT`).
  - The thumbnails add N full-resolution area resamples to every change, including those.
- **Scenario:** 12 MP phone photo, Background plus two layers, panels open (the default). Every
  brush stroke, marquee, wand click, Deselect or layer click blocks the main thread for about
  3 × 0.9 s. With one layer it is still about 0.9 s per action.
- **Evidence:** REPRO (temp Vitest).
  - A mounted `LayersPanel` with a spied `resampleBuffer`: one `select()` gives 3 calls / 360 000
    source pixels (3 layers × 400 × 300). One brush stroke gives the same.
  - Timing under Vitest/jsdom on this shared machine: `resampleBuffer` 2000×1500 → 28×21 =
    232–435 ms per call (6 runs); 4000×3000 = 928 ms.
  - Not measured in a browser.
- **Refuter:** CONFIRMED mechanism; **severity P2 → P3**.
  - Own repro: mounted `LayersPanel`, 3 layers, a selection-only `select(selectAllMask)` → 3
    `resampleBuffer` calls. The inline `ref` plus the whole-`session` subscription redraw every
    thumbnail on every session change.
  - Timing in the Vitest node environment (no jsdom) on this loaded PC: 2000 × 1500 → 28 × 21 =
    187–208 ms (6 runs), so roughly 0.75 s per 12 MP layer by extrapolation (no 12 MP run). The
    dock is open by default (`ImageEditorOverlay.tsx:45`), and photos reach Studio at native size.
  - It is a real stall, but the canvas, the commit and the Apply output stay correct. Nothing is
    broken or misleading. The ADR-245 "as fast as today" line is a Consequence forecast, not a
    guard. Under METHOD §3 this is performance polish, so P3.
- **Fix direction:** Memoise thumbnails per layer buffer and revision (or per dirty rect), compute
  them from a cheap strided sample or the cached composite, and defer them off the commit path.

### P3-1 — Delete on an upper layer paints opaque white over the layers below; move and transform clear the same layer to transparent

- **Where:** `src/ui/image-editor/image-editor-store.ts:211-212`
  (`commitFillSelection(session, WHITE, 'Delete selection')`). The layer-aware clear
  `clearEditorLayerInPlace` (`editor-layer-clear.ts:21-29`) is used only by move
  (`editor-session.ts:380`) and Free Transform (`editor-transform-session.ts:51`).
- **Anchor:**
  - Twin: move, transform and the upper-layer eraser (`editor-session.ts:313`) all clear upper
    layers to transparency (ADR-245 §4).
  - Ground truth: Photoshop clears a normal layer to transparency and fills only the Background
    (Adobe help "Delete or cut selected pixels"; fetch refused with 403, so only the search-result
    summary was read).
- **Scenario:** Add Text on a new layer over a photo, select part of the text, press Delete. A
  white rectangle punches through the photo instead of revealing it. After Apply, that area burns
  nothing. The button title does say "Clear the selected area to white", and WORKFLOW F-L2 (written
  before layers) says white, so the result is honest but layer-inconsistent.
- **Evidence:** REPRO: grey 40 Background + upper layer, rect selection, Delete → upper pixel
  `[255,255,255,255]`, composite `255` inside, `40` outside. No test covers Delete on an upper
  layer.
- **Refuter:** CONFIRMED (P3). Own repro through the real store `deleteSelection()` on an upper
  layer over grey 40: the layer pixel is `[255,255,255,255]`, composite 255 inside and 40 outside.
  `WHITE` (`editor-session.ts:67`) is the same opaque colour that `clearEditorLayerInPlace` uses
  only for the Background.
- **Fix direction:** Route Delete through `clearEditorLayerInPlace` (white on Background, transparent
  above), and update the title and F-L2.

### P3-2 — Gaussian Blur, Median, Unsharp Mask and High Pass ignore alpha on layers: black ink does not soften, and light ink gets a dark fringe

- **Where:** `src/core/image-adjust/gaussian-blur.ts:65-88` (convolves straight RGB including the
  RGB of transparent pixels; alpha is neither filtered nor used as a weight) and `:118-139`
  (`writeMasked` writes RGB only). `median.ts` shares `writeMasked`. Unsharp/High Pass use
  `blurredRect`.
- **Anchor:** Ground truth: W3C Filter Effects 1 §9.1, "all image filters operate on premultiplied
  RGBA samples" (https://www.w3.org/TR/filter-effects-1/). Twin: the transform resampler is
  premultiplied (`transform-blit.ts:109-137`, PR #496).
- **Scenario:**
  - A black-ink layer over white with Gaussian Blur σ 3 is unchanged (row
    `255,255,255,0,0,0,0,0,0,255,255,255` before and after). The same content on the Background
    blurs as expected (`247,224,178,118,62,…`).
  - Grey-220 ink on a layer gets a dark ring inside its hard edge (`118,166,195,201,184,144`),
    because transparent `0,0,0` neighbours are averaged in.
- **Evidence:** REPRO (temp Vitest; numbers above).
- **Refuter:** CONFIRMED (P3).
  - Own repro via `commitAdjustment('gaussian-blur', {sigma: 3})` on a new upper layer (new layers
    are `[0,0,0,0]`): black ink row before = after exactly.
  - Grey-220 ink becomes `123,148,167,177,177,167,148,123`: the whole stroke darkens, and the
    alpha edge stays hard.
  - W3C Filter Effects 1 §9.1 fetched: "Unless otherwise stated, all image filters operate on
    premultiplied RGBA samples."
- **Fix direction:** Filter premultiplied RGBA (blur alpha too), then un-premultiply on write.

### P3-3 — Selection Feather is quantised: 1, 2, 3 and 4 px give the identical mask (so do 5–7); Border widths are always even

- **Where:**
  - `src/core/image-select/mask-morphology.ts:40-51`: `boxRadius = max(1, round(radius/3))`; the
    comment claims "sigma ~radius/2".
  - `:24-27`: Border uses `round(thickness/2)` per side.
  - Used by the options-bar Feather ("Soft-edge every new selection by this many pixels",
    `EditorSelectionControls.tsx:56-66`) and Modify ▸ Feather/Smooth (default 2 px).
- **Anchor:**
  - Contract: the control labels promise "this many pixels".
  - Ground truth: GIMP feathers continuously with σ = radius / 3.5 (`gimp-gegl-apply-operation.c`,
    `gimp_gegl_apply_feather`, "3.5 is completely magic").
  - Internal: three box passes of radius b give σ = √(b(b+1)), i.e. 1.41 px for every input 1–4.
- **Scenario:** The operator tries Feather 1, 2, 3 and 4 px and sees no difference. 5 px jumps to
  σ 2.45. Feather 8 and 10 are identical. Border 1 gives a 2 px band, Border 3 a 4 px band.
- **Evidence:** REPRO: `featherMask(20×20 rect, r)` row profiles: r = 2, 3, 4 "SAME as" r = 1;
  r = 6, 7 same as 5; r = 10 same as 8. No test pins radius → spread
  (`mask-morphology.test.ts:46-62`).
- **Refuter:** CONFIRMED (P3). Own repro on a 20 × 20 rect in 40 × 40: Feather 1 = 2 = 4,
  5 = 7 and 8 = 10 (row profiles identical), and 4 ≠ 5. Border bands for thickness 1, 2, 3, 4 are 2,
  2, 4, 4 px. This matches `max(1, round(r/3))` and `round(t/2)` (JS rounds 0.5 up). GIMP's σ
  constant was not re-fetched, but the finding stands on the label contract alone.
- **Fix direction:** Use a continuous kernel (exact Gaussian or the extended box of
  `core/image-adjust/box-blur.ts`) with a documented σ(radius), and make Border band = thickness.

### P3-4 — Clone stamp "Opacity" builds up per dab (50 % gives ~94 %); Heal shows Opacity and Hardness sliders it ignores

- **Where:**
  - Clone: `src/core/image-retouch/clone-stroke.ts:89-113, 131-149` source-overs every dab at
    `coverage × opacity`, with dabs every ¼ diameter.
  - Heal: `editor-session-retouch.ts:93` passes only the radius.
  - Shared sliders: `EditorOptionsBar.tsx:20-29, 133-162` (Heal and Clone show Size/Hardness/
    Opacity).
- **Anchor:** Twin: the brush applies opacity once per stroke (MAX coverage, `brush-stamp.ts:1-8`,
  "Photoshop's normal brush"). The same "Opacity" slider means a cap for Brush and a per-dab flow
  for Clone. Photoshop's Opacity is the stroke ceiling and Flow the build-up (third-party: Kelby
  One, "flow vs opacity"; Adobe helpx not reachable).
- **Scenario:** Clone at Opacity 50 % across a black source gives luma 16 (≈ 94 % coverage), where
  Brush at 50 % gives 128. Heal at Opacity 10 % or Hardness 0 behaves exactly like 100 %.
- **Evidence:** REPRO (clone 16 vs brush 128 at the same pixel) + READ (heal).
- **Refuter:** CONFIRMED (P3).
  - Own repro: `cloneStrokeInPlace` of a black source over white, 8 px hard tip, opacity 0.5 →
    `[16,16,16,255]`. That is 1 − 0.5⁴ ≈ 94 %, from about four overlapping dabs at ¼-diameter
    spacing.
  - `applyHealAt` passes only `diameterPx / 2` (`editor-session-retouch.ts:93`).
  - `isPaintToolKind` in `EditorOptionsBar.tsx` includes `heal`, so the Hardness and Opacity sliders
    show for Heal.
- **Fix direction:** Accumulate clone coverage with MAX in a stroke window (as the brush does) and
  apply opacity once. Hide or honour the Heal sliders.

### P3-5 — Apply refuses any layer stack over 128 MiB (12 MP × 3 layers; 32 MP × 2), although ADR-245 says layer count is not guarded

- **Where:**
  - `src/ui/image-editor/editor-project-document.ts:23-31`: `captureProjectDocument` throws
    before the bake, so the flattened bitmap is not applied either.
  - Image/Canvas Size accept up to 8192 px per edge (`resize-dialog-store.ts:47-50`), i.e. one
    268 MB layer that can never be applied.
- **Anchor:** Contract.
  - ADR-245 §1: "Layer count is operator-bounded, not guarded."
  - ADR-590 sets the 128 MiB bound as validation of *saved documents before allocation*, not as an
    Apply refusal.
  - Twin: import admits 32 MP (`BURN_MAX_SOURCE_PIXELS`, `image-loader.ts:37`) and the resize
    dialogs admit 67 MP.
- **Scenario:**
  - A 48 MP phone photo is imported at 32 MP. Adding one Text layer makes Apply fail:
    "Photo layers exceed the 128 MiB editable document limit. Reduce image size or merge layers."
  - A 12 MP photo fails the same way with three layers.
  - The message is honest and Merge Down is a workaround, but the burnable bitmap is refused
    because of an optional editable-source copy.
- **Evidence:** REPRO: `captureProjectDocument` on a 4000 × 3000 session with 3 layers → throws
  that message (a fake buffer was used; the check runs before any pixel access).
- **Refuter:** CONFIRMED (P3).
  - Own repro: 3 fake 4000 × 3000 layers → `captureProjectDocument` rejects with the quoted
    message. `bakeProjectPhoto` awaits both, so the flattened bitmap is refused too, and `runApply`
    toasts "Could not apply image edits: …".
  - ADR-590 (`docs/decisions/ADR-590-…md:51-52`) scopes the 128 MiB bound to "Saved documents are
    validated before allocation".
  - A single 32 MP layer (128 MB) passes. Any second layer fails.
- **Fix direction:** When the editable stack exceeds the bound, still apply the flattened bitmap
  without `editorDocument`, and say so. Or align the resize dialog bound. Maintainer decision.

### P3-6 — Live previews differ from the commit: Free Transform keeps the lifted pixels visible underneath; Eraser drags preview in the foreground colour

- **Where:**
  - `src/ui/image-editor/EditorCanvas.tsx:52-96` draws the unchanged composite, then the floating
    preview on top (`editor-canvas-draw.ts:120-148`). `commitEditorTransform`
    (`editor-transform-session.ts:51-52`) clears the source (white or transparent) before blitting.
  - The Eraser drag preview strokes `style.color` = foreground (`editor-canvas-draw.ts:232-234`,
    `EditorCanvas.tsx:83`). The commit uses the background colour or erases alpha.
- **Anchor:** Twin: `transform-blit.ts:1-6` says the live preview "draws the same affine" as the
  byte-authoritative commit. Photoshop hides the lifted area during Free Transform.
- **Scenario:** Ctrl+T a black logo and drag it 50 px. The preview shows two logos, and Enter
  leaves one plus a white hole. An eraser drag shows a black line, and release produces white.
- **Evidence:** READ (render path traced; jsdom has no real canvas). This only affects the editor's
  transient preview: the committed document and Apply are consistent.
- **Refuter:** CONFIRMED (P3, READ, two independent code facts).
  - `startEditorTransform` is documented and implemented to lift "without mutating" the layer.
    `EditorCanvas` draws the unchanged composite, then `drawTransformPreview` on top, with no
    masking step. Only `commitEditorTransform` clears the source.
  - Eraser starts a `'paint'` drag (`editor-drag.ts:134-135`), and the `'paint'` preview strokes
    `style.color` = foreground (`editor-canvas-draw.ts:232-234`).
- **Fix direction:** Render the transform preview over a composite with the mask region cleared per
  layer rule, and draw the eraser preview in the background colour (or as an outline).

### P3-7 — Memory: every edited image keeps a full session in the stash with no global budget, and the kerf worker computes every superseded request

- **Where:**
  - Stash: `src/ui/image-editor/image-editor-lifecycle.ts:43-53, 94-98` stores one session per
    object id. `retainDocumentEpochStash` (`image-editor-ownership.ts:73-82`) evicts only other
    documents. Each session holds its layers, the Revert base and up to 256 MB of history.
  - Kerf worker: `kerf-check-worker-client.ts:91-100` `cancelRequest` only forgets the id. The
    queued message, carrying a full composite copy (`:72-86`), is still computed by
    `kerf-check-worker.ts:6-11`.
- **Anchor:** Contract: ADR-242 §2 promises "byte-budgeted history" and ADR-245 §1 says "memory
  pressure surfaces in the History trim note". Both budgets are per session, and the number of
  sessions is unbounded.
- **Scenario:**
  - Editing six 12 MP photos in one project keeps six sessions: up to roughly 6 × (48–150 MB of
    layers/base + 256 MB of history). That is enough to exhaust a renderer and lose unsaved work.
  - Rapid edits on a large burn grid (compute longer than the 400 ms debounce) queue 48 MB
    composite copies in the worker, and each is computed in turn.
- **Evidence:** REPRO for the stash (5 stashed sessions survive `closeEditor`). READ plus
  arithmetic for the sizes and the worker queue; no browser heap measurement.
- **Refuter:** CONFIRMED (P3, READ).
  - `stashSession` keys one session per object id. `retainDocumentEpochStash` filters only by
    epoch, and no size budget exists.
  - `cancelRequest` only deletes the pending id. Its own comment says "The worker keeps running the
    stale computation".
  - Severity stays P3: no browser heap exhaustion was demonstrated.
- **Fix direction:** Add a global stash budget (evict the oldest unapplied session's history first,
  and tell the user). Supersede queued kerf requests in the worker, for example a latest-id check
  before computing.

### P3-8 — After two or three Studio Applies on a large photo, project Undo silently drops every earlier step, including unrelated edits

- **Where:** `src/ui/state/undo-stack.ts:18-38, 41-57`. `limitProjectHistory` charges each retained
  `editorDocument` 2 bytes per base64 character against 256 MiB and cuts the stack at the first
  snapshot that crosses it. Nothing in the UI reports the trim (only Design Studio has a similar
  note, `DesignStatusBar.tsx:49`).
- **Anchor:** Contract: ADR-242 §3 says Apply is "Exactly one project-undo entry", with project
  undo as the safety net ("Applying is destructive to `dataUrl` pixels with project undo as the
  safety net"). `HISTORY_DEPTH` 50 is the documented depth. No ADR records the source-byte trim.
- **Scenario:**
  - Each 12 MP single-layer Apply charges 128 MB. After the 4th Apply only the last two snapshots
    remain: object moves, settings changes and earlier Applies made before them can no longer be
    undone.
  - A 20 MP photo (213 MB charged) collapses project Undo to one step after its 3rd Apply.
- **Evidence:** REPRO (scaled): `limitProjectHistory([plain×3, apply1, apply2, apply3], 100)` with
  80-byte charged documents keeps only `apply 3`. The real sizes are arithmetic from the base64
  length formula.
- **Refuter:** CONFIRMED (P3, READ + arithmetic).
  - `limitProjectHistory` walks newest → oldest and cuts at the first snapshot that pushes the
    shared-source total past 268 435 456 B.
  - A 12 MP layer is charged 128 000 000 B. Only *previous* projects are charged, so the cut first
    happens on the 4th Apply, leaving 2 snapshots, as stated.
  - No UI outside Design/Image Studio mentions trimming (grep "trimmed"). Neither `DECISIONS.md` nor
    `docs/decisions` documents `HISTORY_SOURCE_BYTES`. It came in with #1157.
- **Fix direction:** Disclose trimmed project history, and/or exclude the editable copy from the
  charge when it equals the current one. Maintainer decision on the budget.

### P3-9 — WORKFLOW and Studio copy describe behaviour that is not built or has changed

- **Where and anchor (Contract, WORKFLOW F-L1..F-L3, ADR-590):**
  - F-L3 step 3 (`WORKFLOW.md:8103`) promises a Natural ⇄ Engrave preview toggle "so the operator
    sees what the laser will burn while editing". There is none: no such control or string in
    `src/ui/image-editor`. PROJECT.md IE-1 still lists it.
  - F-L3 Edge says the status row "shows the resulting mm size before commit". The crop options
    show px only (`EditorOptionsBar.tsx:99-103`).
  - F-L1 Edge — job streaming says Abort sits "inside the editor chrome". It is not there. Abort
    is reachable through the app-shell `LiveMotionBar` above the overlay (z 2³¹−1 vs 1010) and
    Ctrl+., so non-negotiable 9 holds; the text is stale.
  - F-L1 step 2 and F-L2 step 3 say erasing and moving fill white. On upper layers both clear to
    transparent (ADR-245).
  - The Crop button title "Commit the crop (Enter) — history clears"
    (`EditorOptionsBar.tsx:112`) is stale: since ADR-590 crop is an undoable document step.
- **Scenario:** An operator, or the next auditor, relies on an engrave preview inside Studio that
  does not exist (the Q5 twin), and avoids cropping because "history clears".
- **Evidence:** READ (grep: no engrave or natural view in the scope).
- **Refuter:** CONFIRMED (P3, READ).
  - `WORKFLOW.md:8103-8105` promises the Natural ⇄ Engrave toggle. Grep for natural/engrave
    preview in `src/ui/image-editor` finds nothing.
  - The crop status shows only `W×H px` (`EditorOptionsBar.tsx:102`).
  - `EditorOptionsBar.tsx:112` still says "history clears", although crop is an undoable document
    step (ADR-590; Verified clean Q3).
- **Fix direction:** Update F-L1..F-L3 and the crop title, and either build the engrave preview or
  mark it planned.

## KNOWN re-observed (still open on `902f1d0c0`)

- **K-1 (adjust preview stale after a session change):** `AdjustDialog.tsx:46-50` recomputes the
  preview only on dialog param changes. Layer clicks, Undo and History clicks stay live while the
  dialog is open.
  - Earlier note: `features-08-14.md` §13, "Not promoted… not reproduced in the final fixture".
  - Now reproduced: threshold preview `0` (Background active) → click the upper layer → preview
    buffer unchanged → OK commits to the upper layer, composite stays `100`. P3.
- **K-2 (Quick Mask dimensions):** `editor-shortcuts.ts:198-206`: Ctrl+Z inside Quick Mask with no
  rubylith strokes falls through to session Undo. That can undo a crop or resize while the rubylith
  keeps the old dimensions (`quick-mask-store.ts:61`).
  - Earlier note: `2026-09-05-pr301-501-audit.md` #341, "Unvalidated dimensions interaction is not
    promoted".
  - Now reproduced: crop 8×8 → 4×4, Q, Ctrl+Z → doc 8×8, rubylith 4×4. Q off gives a 4×4
    selection on the 8×8 doc, so Fill and paint clip use the wrong stride. P3.
- **K-3 (report 20 P3-4):** Studio Brightness/Contrast (`tone-luts.ts`) and the engrave-stage
  controls use different curves for the same numbers.
- **K-4 (report 20 K-1 / F20):** Save Processed Bitmap dithers the image-oriented grid, not the
  burned one.
- **K-5 (`2026-10-15-tools-image-trace.md` item 3):** Crop Image / Flatten run full-grid
  synchronous loops with no cancellation. Maximum-size latency is still unqualified.

## Refuted

The refuter (2026-10-22) refuted none of P2-1..P2-4 or P3-1..P3-9. Every finding reproduced or was
confirmed by two independent code facts, and P2-4 was downgraded to P3. The items below are the
auditor's own self-refutations.

- **Merge Down of two hidden layers destroys pixels.** Not a defect today: `mergeActiveLayerDown`
  records a full document snapshot (ADR-590), so Undo restores both layers. Hidden content dropping
  on merge matches the "bake what is visible" rule of F02.
- **Tile Undo can land on the wrong layer after its layer is deleted.** History evicts oldest first
  and `fitBudget` keeps order, so the document entry that restores the layer is always replayed
  before older tile entries.
- **Apply bakes a different revision than the PNG/luma pair (F12-04).** Fixed:
  `bakeBufferToBitmapFields` copies the pixels synchronously (`image-editor-decode.ts:181`), and
  `captureProjectDocument` clones layers before its first `await`.
- **Kerf Thicken maps a resampled burn grid 1:1 onto the document.** Guarded by
  `isCompiledGridDirect` (`editor-kerf-thicken-target.ts:109-120`) plus the `mappedCount` check.

## Verified clean

- **Geometry (Q1), by REPRO with exact numbers:**
  - Crop (5, 7, 10, 6) of a 40 × 30 px / 40 × 30 mm image at (10, 20) → bounds (15, 27)–(25, 33).
  - Crop → Image Size 33 × 17 keeps (15, 27)–(25, 33); `pixelSizeMm` 0.30303 / 0.35294.
  - A fractional crop after resize maps through the scaled `cropOffset`: 11 × 6 px → 3.333 ×
    2.118 mm.
  - Canvas Size centred 50 × 40 → (5, 15)–(55, 55). Undo of a crop → bounds `null`, 40 × 30.
  - Crop maps rows from `bounds.minY` like Crop Image's `cropLocalBounds` and `imageClip`
    (image-local mm). `applyTransform` rotates and mirrors about the local origin, so cropped pixels
    keep their world position for any rotation or mirror.
  - No Studio command rotates or flips the document, so its dimensions never transpose.
- **Bake twin (Q5):**
  - Canvas and Apply use `compositeSession`; the dirty-window cache has a byte-equivalence test.
  - Apply luma uses the same BT.601 rounding as import and as the kerf worker's `compositeLuma`.
    The composite is opaque, so alpha cannot leak into luma.
  - `straightColourForEditor` undoes the import's white composite, so an unedited round trip
    reproduces the imported tone (within ±1 at partial alpha).
- **Compositing math (L2):**
  - Source-over is straight-alpha W3C §5.1.
  - Blend formulas match W3C separable modes; overlay switches at Cb ≤ 0.5 (byte < 128).
  - Non-normal Merge Down un-premultiplies against the current backdrop, as F02 required.
- **Selection ops:**
  - Marquee: pixel-centre, half-open; off-image rectangles are empty (F03).
  - Lasso: even-odd with half-open vertex rule.
  - Wand: per-channel `|Δ| ≤ tol`, inclusive (seed 100, tol 32 selects 132 and 68, not 133);
    contiguous mode is a 4-connected scanline fill.
  - Invert is `255 − α`. Add/Subtract/Intersect are max/min.
  - Expand/Contract are exact square-element max/min. Contract does not erode from the canvas edge
    (Photoshop's default).
- **Undo (Q3):**
  - Strokes, fills, gradient, bucket, clone, heal, adjustments, Free Transform, crop, resize,
    Canvas Size and layer structure ops are one entry each.
  - Crop and resize Undo restore pixels, dimensions, `cropOffset` and `pixelSizeMm` exactly.
  - Undo/Redo after Apply marks the session dirty (F12-01 fixed).
  - Apply is one project undo entry and drops `imageAsset` and the old `editorDocument` (F12-03
    fixed).
  - Cancel on Adjust, Resize/Canvas, Text, Crop and Transform leaves the document untouched; the
    transform commit checks session, layer, revision and buffer ownership.
- **Fixed earlier findings re-checked:**
  - Eraser uses the background colour (F12-02).
  - Adjust Enter-on-Cancel (F13-01): the panel guards focused buttons.
  - Single-layer adjust preview composites (F13-02).
  - Bucket ∩ selection (F351-01); clone aliasing snapshot (F353-01); ETA scale (F354-01).
- **Untrusted input (Q6):**
  - `editorDocument` is validated for version, dimensions = raster, 1..128 layers, ≤ 128 MiB,
    finite opacity 0..1, blend whitelist, exact canonical base64 length, unique ids and active id.
  - Opening re-checks sizes before allocation and decodes in yielding slices with a typed error.
  - Corrupt or undecodable sources give a toast, and the scene is untouched.
  - Stale decode or Apply completions no-op (ADR-313).
- **Bitmaps and workers:** `loadImageAsRawData` closes its `ImageBitmap` in `finally`. The kerf
  worker transfers an owned copy and retires itself on worker error. No `createImageBitmap` in
  scope.
- **Abort (non-negotiable 9):** `LiveMotionBar` renders above the Studio overlay, and Ctrl+.
  reaches the window listener because the editor key handler never stops propagation.
- **Novelty:** no open PR touches the scope (`gh pr list`: #1339–#1352 and #1280; #1351's 83 files
  include none). No prior audit records P2-1..P2-4 or P3-1..P3-9.

## Not verified

- No browser run: the thumbnail and slider costs are Vitest/jsdom timings on a shared, loaded PC,
  and real canvas, heap and GC behaviour was not measured. No 20–32 MP interactive session.
- Convert to Bitmap: plan and bounds were read (exact bounds, rounded pixel counts); the
  rasteriser and fidelity tests were not re-run.
- Photoshop primary pages (helpx) returned 403. Delete, heal-sampling and opacity semantics rest
  on the in-repo twins, with search-result summaries and third-party pages as context only.
- PSD import layers, Text rasterisation (fonts), Curves editor UI, Histogram, `mask-outline`
  marching ants and `tone-luts` / halftone (report 20) were not audited.
- Project-file size of `editorDocument` at save (JSON string limits) belongs to area 13.
- No material burn or hardware.

```json
[
  {"id":"P2-1","severity":"P2","area":"image-editor","file":"src/core/image-retouch/spot-heal.ts","line":43,"anchor":"Twin: clone/bucket/wand/eyedropper sample compositeSession (editor-session-retouch.ts:26, editor-session-fill.ts:33, image-editor-store.ts:281); ADR-245 s5; F01 straight-alpha contract","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Spot heal takes the ring median of the active layer's straight RGB ignoring alpha; after 'Clean up white paper' or on an empty layer it paints a solid black disc (composite luma 0) that burns at full power"},
  {"id":"P2-2","severity":"P2","area":"image-editor","file":"src/ui/image-editor/LayersPanel.tsx","line":234,"anchor":"Contract: WORKFLOW F-L4 'every committed operation is one editor-local undo step'; ADR-246 s1 / ADR-590 one snapshot per metadata change","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Layers opacity range input records a full-document history snapshot per input event: one drag = dozens of Undo steps, each cloning every layer; on a 12 MP photo two events evict all earlier editor history"},
  {"id":"P2-3","severity":"P2","area":"image-editor","file":"src/ui/image-editor/image-editor-lifecycle.ts","line":85,"anchor":"Contract: Close title 'session is kept and resumes on reopen'; WORKFLOW F-L1 step 4; ADR-242 s5; ADR-313 s2 'same-document reopen remains resumable'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Any change to the image object after closing Studio (e.g. a 1 mm nudge) makes reopen decode fresh and silently discard the unapplied session, layers and Undo history"},
  {"id":"P2-4","severity":"P3","severity_raised":"P2","area":"image-editor","file":"src/ui/image-editor/LayersPanel.tsx","line":130,"anchor":"Contract: ADR-245 Consequences (one composite per committed op); ADR-246 s2 (selection-only changes cost no recomposite)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"LayerThumbnail's inline ref resamples every layer at full resolution on every session change, including selection-only ones; ~0.23-0.43 s per 3 MP layer and ~0.93 s per 12 MP layer under Vitest"},
  {"id":"P3-1","severity":"P3","area":"image-editor","file":"src/ui/image-editor/image-editor-store.ts","line":212,"anchor":"Twin: clearEditorLayerInPlace used by move/transform, upper-layer eraser erases alpha (ADR-245 s4); Photoshop Delete clears layers to transparency","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Delete on an upper layer fills opaque white, hiding the layers below, while move/transform clear the same layer to transparency"},
  {"id":"P3-2","severity":"P3","area":"image-editor","file":"src/core/image-adjust/gaussian-blur.ts","line":65,"anchor":"Ground truth: W3C Filter Effects 1 s9.1 'all image filters operate on premultiplied RGBA samples'; Twin: premultiplied transform resampler","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Gaussian Blur/Median/Unsharp/High Pass filter straight RGB and never alpha: black ink on a layer does not soften at all, light ink gets a dark fringe"},
  {"id":"P3-3","severity":"P3","area":"image-editor","file":"src/core/image-select/mask-morphology.ts","line":44,"anchor":"Contract: Feather/Modify labels 'this many pixels'; Ground truth: GIMP gimp_gegl_apply_feather sigma = radius/3.5 (continuous)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Feather radius is quantised (1-4 px identical, 5-7 identical, 8-10 identical; sigma 1.41 not radius/2 as commented); Border band widths are always even"},
  {"id":"P3-4","severity":"P3","area":"image-editor","file":"src/core/image-retouch/clone-stroke.ts","line":148,"anchor":"Twin: brush applies opacity once per stroke (brush-stamp.ts MAX coverage); shared Opacity/Hardness sliders","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Clone Opacity accumulates per dab (50% gives ~94% coverage vs brush 50%); Heal shows Opacity and Hardness sliders it ignores"},
  {"id":"P3-5","severity":"P3","area":"image-editor","file":"src/ui/image-editor/editor-project-document.ts","line":29,"anchor":"Contract: ADR-245 s1 'Layer count is operator-bounded, not guarded'; ADR-590 bound is saved-document validation; Twin: import 32 MP, resize dialog 8192 px edge","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Apply (including the flattened bitmap) is refused when layers exceed 128 MiB: a 32 MP import plus one Text layer, or 12 MP with 3 layers; Image/Canvas Size allow single layers that can never Apply"},
  {"id":"P3-6","severity":"P3","area":"image-editor","file":"src/ui/image-editor/EditorCanvas.tsx","line":89,"anchor":"Twin: transform-blit.ts header (preview draws the same affine as the commit); commitEditorTransform clears the source","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Free Transform preview leaves the lifted pixels visible under the floating copy while the commit clears them; eraser drag preview strokes the foreground colour"},
  {"id":"P3-7","severity":"P3","area":"image-editor","file":"src/ui/image-editor/image-editor-lifecycle.ts","line":43,"anchor":"Contract: ADR-242 s2 byte-budgeted history; ADR-245 s1 memory pressure surfaces in the trim note","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Stash keeps a full session (layers, base, up to 256 MB history) for every edited image with no global budget; kerf worker computes every cancelled request, each with a full composite copy"},
  {"id":"P3-8","severity":"P3","area":"image-editor","file":"src/ui/state/undo-stack.ts","line":35,"anchor":"Contract: ADR-242 s3 project undo is the Apply safety net; HISTORY_DEPTH 50; no ADR for the source-byte trim","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"limitProjectHistory charges each Studio editorDocument; after 2-3 Applies on a 12-20 MP photo project Undo silently collapses to the newest 1-2 steps, dropping unrelated earlier edits"},
  {"id":"P3-9","severity":"P3","area":"image-editor","file":"WORKFLOW.md","line":8103,"anchor":"Contract: WORKFLOW F-L1..F-L3, ADR-590 (crop undoable)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Doc/copy drift: no Natural/Engrave preview toggle exists; crop shows px not mm; Abort is in LiveMotionBar not the editor chrome; erase/move-fill-white predates layers; crop title says 'history clears'"},
  {"id":"K-1","severity":"P3","area":"image-editor","file":"src/ui/image-editor/AdjustDialog.tsx","line":50,"anchor":"Twin: computeAdjustPreview vs commitAdjustment","evidence":"REPRO","verdict":"PENDING","known":"features-08-14.md s13 'Not promoted' note","summary":"Adjust preview not recomputed on layer switch/Undo/History click; OK commits to the new active layer while the canvas showed the old preview"},
  {"id":"K-2","severity":"P3","area":"image-editor","file":"src/ui/image-editor/editor-shortcuts.ts","line":203,"anchor":"Twin: rubylith dimensions vs session document","evidence":"REPRO","verdict":"PENDING","known":"2026-09-05-pr301-501-audit.md #341 'unvalidated dimensions interaction not promoted'","summary":"Ctrl+Z in Quick Mask falls through to session Undo, which can undo a crop; Q off then yields a selection of the old size, mis-clipping Fill and paint"},
  {"id":"K-3","severity":"P3","area":"image-editor","file":"src/core/image-adjust/tone-luts.ts","line":15,"anchor":"Twin: engrave-stage luma-adjust.ts","evidence":"REPRO","verdict":"PENDING","known":"report 20 P3-4","summary":"Studio Brightness/Contrast and engrave-stage Brightness/Contrast apply different curves for the same numbers"},
  {"id":"K-4","severity":"P3","area":"image-editor","file":"src/ui/raster/processed-bitmap.ts","line":93,"anchor":"Twin: compile orients then dithers","evidence":"REPRO","verdict":"PENDING","known":"report 20 K-1 / 2026-07-17 F20","summary":"Save Processed Bitmap dithers the image-oriented grid, not the burned grid"},
  {"id":"K-5","severity":"P3","area":"image-editor","file":"src/ui/raster/crop-image.ts","line":31,"anchor":"Responsiveness qualification","evidence":"READ","verdict":"PENDING","known":"2026-10-15-tools-image-trace.md item 3","summary":"Crop Image / Flatten run synchronous full-grid loops with no cancellation; maximum-size latency unqualified"}
]
```
