# KerfDesk Image Studio — research and implementation roadmap

Date: 2026-07-21
Repository: `C:\Users\Asus\LaserForge-2.0`
Research branch: `claude/photoshop-feature-research-e52de4`
Status: research + plan only. No implementation in this document's PR. Governing artifacts proposed here (ADR-242, PROJECT.md Phase L, WORKFLOW.md F-L flows) require maintainer ratification before any code.

## Executive verdict

The request: a full, high-quality, Photoshop-grade raster editor inside KerfDesk, so a traced image can be repaired and reshaped without leaving the app — explicitly including **add lines, delete lines, change lines, and change selected areas**.

The verdict after mapping the codebase and the market:

1. **Build it in-house, pure TypeScript, on the existing `core/raster` foundations. Adopt zero new runtime dependencies for the first three phases.** Every candidate library is either license-hostile (GPL), bundle-hostile (OpenCV.js ≈ 8 MB against our < 1 MB budget), unmaintained (glfx.js, CamanJS), or too shallow to matter (toast-ui, Filerobot). The algorithms we need (brush stamping, scanline flood fill, selection masks, separable Gaussian, unsharp mask, levels/curves, halftone screens) are classical, small, and match the house style of self-implemented pure-core algorithms (`fill-hatching.ts`, the trace engine, `dither.ts` precedents).
2. **The editor is a full-screen overlay workspace** (`Viewer3DDialogShell` mounting precedent), with its own ephemeral Zustand store (`camera-wizard-store` precedent), its own tile-based undo/redo (the project store's whole-`Project` snapshot undo cannot absorb per-brushstroke history), and a bake-on-Apply contract back into the existing `RasterImage` scene object. Compile/preview/emit pipelines are untouched.
3. **Phase 1 is the line-work cluster, not photo adjustments** — brush/pencil/eraser/line tool plus the full selection model (marquee, lasso, wand) with delete/fill/move. That is the maintainer's stated core need and the highest-value gap: LightBurn itself cannot paint or select pixels, and routes users to external editors.
4. **The closed edit→re-trace loop is the differentiator.** ADR-026 already keeps the trace source; `tools.retrace-original` already exists. Edit pixels → re-trace becomes a one-screen loop no competitor in the GRBL space has.
5. **"Anything Photoshop can do" is mapped honestly into four tiers.** Tiers 1–3 (line work, selections, adjustments, filters, retouch, background removal, text stamps) are planned and phased below. Tier 4 (layer stacks, blend modes, adjustment layers) is designed-for but deferred behind its own ADR. A final tier — color management/CMYK, smart objects, cloud/generative AI, plugins — is **out, permanently**: it conflicts with PROJECT.md non-negotiable #8 (no network calls, ever), the < 1 MB bundle budget, and the out-of-scope list (no plugins/scripting). Full Photoshop parity is a decade of product; this roadmap delivers the laser-relevant 90%.

## 1. Requirement mapping — what "photoshop a traced image" means in KerfDesk terms

A traced "line" exists in two representations, and the maintainer's four verbs map onto both:

| Need | Pixel world (this feature) | Vector world (already shipped) |
|---|---|---|
| Add a line | Brush / pencil / line tool onto the source bitmap; re-trace picks it up | Pen tool + shape tools (ADR-051) draw new vector paths directly |
| Delete a line | Eraser or select-and-clear on the bitmap; re-trace drops it | Node mode edits/deletes path geometry (ADR-159/164 bounded node editing) |
| Change a line | Erase + redraw, move a selection, clone over it | Node/Bezier editing of canonical curves (schema v2, ADR-159) |
| Change a selected area | Selection model (marquee/lasso/wand) + fill / delete / adjust / transform inside it | Marquee-select whole objects; no region-of-a-path editing exists |

The Image Studio owns the pixel column. The vector column already exists and is out of scope here — but the two connect through the loop:

**The loop:** import image → trace (source kept, ADR-026) → open Image Studio on the kept source → paint/erase/select-edit → Apply → re-trace from source (`tools.retrace-original`, `src/ui/commands/command-raster-family.ts`) → updated vectors. For raster-scan engraving (ADR-235/238 machinery) the edited bitmap feeds the engrave directly. If the source was deleted (opt-in delete-after-trace) or the artwork is vector-only, **Convert to Bitmap** (Phase F.4, ADR-029) manufactures an editable raster — that fallback closes every entry path.

## 2. Research baseline

Full external-evidence file with every source URL: [`2026-07-21-image-editor-web-research.md`](./2026-07-21-image-editor-web-research.md) (same folder). Sections below summarize it plus in-repo research.

### 2.1 LightBurn (the reference product — rule: match, then exceed deliberately)

Current LightBurn is **2.1.03 (2026-06-30); no 2.2 exists**. Verified via in-repo research (RESEARCH_LOG.md 2026-06-04; ADR-030) plus this session's web sweep (docs + forum citations below):

- **Adjust Image dialog** (`docs.lightburnsoftware.com/latest/Reference/AdjustImage/`): dual-pane original/processed live preview; Layer Settings (the Image-mode cut settings previewed in-dialog) + Image Settings = **Brightness, Contrast, Gamma, Enhance Amount, Enhance Radius** (Enhance = unsharp masking / high-pass sharpening, per Shape Properties docs and dev forum answer), **Invert Display**, and presets (built-ins "Basic" and "Black Paint on White", plus user presets with import/export). Our `AdjustImageDialog` covers brightness/contrast/gamma + negative — **the Enhance (unsharp) pair and the preset import/export are named parity gaps**.
- **Image mode** (`.../Reference/CutSettingsEditor/ImageMode/`): exactly **10 modes** — Threshold, Ordered, Atkinson, Dither, Stucki, Jarvis, Newsprint, Halftone (with **cells-per-inch + screen-angle** params), Sketch, Grayscale (Min/Max power tone mapping). We ship 11 algorithms (`DITHER_ALGORITHMS`, `src/core/scene/scene-object.ts:228`) — more error-diffusion variants than LightBurn — but lack the three screen/edge modes: **Newsprint, Halftone, Sketch**.
- **Trace dialog**: Cutoff/Threshold band vocabulary — already realigned per ADR-030's design; the same ADR (§3, Proposed) directs brightness/contrast/gamma **out of** Trace toward "a dedicated Adjust-Image surface." The Image Studio is that surface, grown to full size; ADR-242 should absorb ADR-030 §3.
- **Bitmap editing beyond adjustments** (Tools-menu reference + forum, all verified): Trace, Multi-File Trace (2.0 Labs), Apply Mask to Image / Crop Image (mask-first; no one-drag rect crop), Convert to Bitmap, Save Processed Bitmap, image compositing. **LightBurn has no pixel painting, no eraser, no selections, no clone/heal, no levels/curves, and no background removal — staff literally point users at remove.bg** (`forum.lightburnsoftware.com/t/132960`), and photo-prep threads route tonal work to GIMP/Photoshop/Imag-R (`forum.../t/77799`). 2.1's image-adjacent additions were 16-bit depth-map engraving (galvo) and an Undo History window — not pixel editing.

Rule-3 note (CLAUDE.md): everything in this roadmap beyond LightBurn's surface is a **deliberate, ADR-recorded divergence** — additive capability in LightBurn's UX shape, like ADR-029 — not an accidental one.

### 2.2 Competitor snapshot (web-verified 2026-07-21)

- **xTool Creative Space / xTool Studio** — the strongest bundled editor in the category: AI Cutout (background removal), AI Expand, Magic Eraser (color-similarity erase with fuzziness), Magic Wand selection, stylistic filters, brightness/contrast/temperature/saturation/sharpness (`support.xtool.com/article/1022`, `/article/605`). Cloud-assisted AI — which our offline non-negotiable #8 deliberately refuses; our counter is local-first + the trace loop.
- **Glowforge** — premium-gated AI generation (Magic Canvas) and photo-engrave presets; no conventional pixel-editing suite found in docs (absence beyond listed tools UNVERIFIED).
- **MillMage** (the direct threat per the 2026-07-07 competitive audit) — LightBurn-lineage adjustment-only image machinery; prerelease docs, dither list unretrievable (UNVERIFIED specifics).
- **EZCAD2** — primitive: invert, 256-gray, dither, brightness; no editing tools.

No GRBL-space competitor ships an integrated paint-grade editor; only xTool comes close and it is cloud-dependent. First-mover surface for KerfDesk.

### 2.3 Build vs buy

Constraints: MIT-compatible only (ADR-017/120, GPL rejected), web bundle < 1 MB compressed total (PROJECT.md), fully offline (non-negotiable #8), TypeScript strict, pure core (no DOM in `core/`).

| Candidate | License | Verdict |
|---|---|---|
| OpenCV.js | Apache-2.0 | ≈ 7.6–8 MB wasm (≈ 4.2 MB trimmed) — kills the bundle budget. Rejected; lazy-load re-evaluation only if GrabCut/inpaint-class features are ever committed. |
| photon-rs (wasm) | Apache-2.0 | Capable, but wasm toolchain + payload for ops we can write in ~30–150 LOC each. Not now; re-evaluate at Tier 4. |
| wasm-vips | **LGPL-2.1** | License-hostile in a statically-bundled wasm + ≈ 4.6 MB. Rejected outright. |
| glfx.js / CamanJS / WebGLImageFilter | MIT | Dead (glfx last substantive commit 2013). Use as MIT shader references only. |
| Jimp / image-js | MIT | Alive but 40–50× slower than needed for an interactive loop; analysis-oriented. Rejected. |
| miniPaint | MIT | Actively maintained (v4.14.3, 2026-04) and genuinely full-featured — but a vanilla-JS monolith application, no TS, architecture incompatible with strict-TS/pure-core/size rules. **Feature checklist + algorithm reference, not a dependency.** |
| Photopea | closed | Inspiration only — existence proof that browser JS + selective WebGL reaches Photoshop-grade. |
| toast-ui / Filerobot / Pintura | MIT/MIT/commercial | Dead (tui, ~2022) / crop-widget scope / paid+closed. Rejected. |
| tldraw | custom (watermark or ~$6k/yr) | Wrong domain (vector whiteboard) + license friction. Rejected. |
| Graphite | Apache-2.0 | Most important newcomer (Rust/wasm raster+vector), but an application, raster still experimental. Watch only. |
| onnxruntime-web + ML background removal | runtime MIT/Apache; **RMBG weights non-commercial**; MODNet / U-2-Net Apache-2.0 | Rejected for now: multi-MB weights vs offline posture + bundle budget. If ML matting is ever wanted, **MODNet/U-2-Net are the commercial-safe weights, never RMBG**. Classical border-flood + color-distance removal needs zero dependencies. |

**Verdict: self-implement, zero new runtime deps through Tier 3.** This matches the Phase F kickoff precedent in RESEARCH_LOG (scanline fill: "no maintained MIT library does this; every CAM tool self-implements"). A RESEARCH_LOG kickoff-survey entry recording this table should land with ADR-242.

### 2.4 Technique notes (for the implementing sessions)

- **Brush engine**: stamp-based — a hardness-falloff disc stamped along the pointer polyline at a spacing fraction of diameter; **flow** accumulates per stamp while **opacity** caps the whole stroke (the Photoshop/Substance semantics — Adobe Substance paint-brush docs). Pressure via PointerEvents `pressure` when present.
- **Selections**: 1-bit mask buffer + cached bounds; marching ants rendered by extracting mask boundary loops (the canonical losingfight.com wand/ants implementation pair) — candidate reuse of the trace engine's boundary walker (`traceBoundaryLoops`, `src/core/trace/contour-boundary.ts`) which already turns bitmaps into loops (verify fit at build time); ant animation is a dash-offset tick on the overlay canvas.
- **Magic wand**: tolerance-based region grow via **scanline flood fill** (fill whole runs, push neighbor-run endpoints), contiguous and global modes; luma tolerance first, color distance later.
- **Filters**: separable Gaussian (two 1-D passes), unsharp mask on top of it (this is exactly LightBurn's Enhance Amount/Radius), median 3×3/5×5 (a `despeckle`/`medianFilter` already exists in `src/core/trace/preprocess.ts` — lift/share, do not duplicate), levels/curves as composed 256-entry LUTs, histogram as a pure reduction.
- **Halftone/Newsprint/Sketch**: Halftone/Newsprint as angled clustered-dot/line screens (Halftone parameterized by cells-per-inch + screen angle, matching LightBurn); Sketch as high-pass/edge extraction (our Canny edge-trace machinery is prior art in-repo). All land in `core/raster/` beside the existing kernels and double as engrave-parity wins outside the editor. Kernel reference: Tanner Helland's canonical dither survey.
- **Undo**: 256×256-px copy-on-write tiles; each committed op snapshots only touched tiles under a byte budget (shipping-editor precedent: MediBang's MDP format stores layers as sparse 128×128 tile grids). The only history design compatible with our snapshot-averse constraints.

## 3. Current architecture — what exists to build on

Full maps were produced by two exploration passes on this branch; load-bearing facts:

| Concern | Today | Files |
|---|---|---|
| Image object | `RasterImage`: original PNG/JPG bytes as `dataUrl` **plus** derived grayscale `lumaBase64`, `pixelWidth/Height`, mm `bounds`+`transform`, `dither`, `linesPerMm`, `brightness/contrast/gamma`, `imageMaskId`, `role:'trace-source'` | `src/core/scene/scene-object.ts:244-291` |
| Import | PNG/JPG/JPEG only; decode caps 8192 px edge / 32 MP; DPI default 254 | `src/ui/trace/image-loader.ts`, `src/ui/common/image-import.ts` |
| Engrave pipeline | decode luma → adjust → invert → resample (nearest-neighbor only — known photo-quality P2) → mask → dither (11 algorithms) → per-pixel S-modulation emit; measured budgets per ADR-202 | `src/ui/raster/processed-bitmap.ts`, `src/core/raster/*` |
| Trace engine | in-house contour/centerline/edge engine, worker-hosted, latest-request-wins (F-E1) | `src/core/trace/*`, `src/ui/trace/*` |
| Existing "editing" | brightness/contrast/gamma dialog (10-file split — the size-discipline template), geometry-mask crop, negative, convert-to-bitmap | `src/ui/raster/AdjustImageDialog.*`, `crop-image.ts`, `image-mask.ts` |
| Re-trace | `tools.retrace-original` command exists | `src/ui/commands/command-raster-family.ts` |
| Workers | two precedents with Vite `new Worker(new URL(...))` + protocol files + OffscreenCanvas use | `src/ui/trace/trace-worker.ts`, `src/ui/raster/convert-bitmap-worker.*` |
| Full-screen mounting | no router; fixed-inset overlay dialogs with load/dispose lifecycle | `src/ui/relief-viewer/Viewer3DDialogShell.tsx` |
| Session store | ephemeral Zustand step-machine store precedent | `src/ui/camera/wizard/camera-wizard-store.ts` |
| Undo | whole-`Project` snapshot stacks, depth 50; **modal-open suppresses global Ctrl+Z** | `src/ui/state/store.ts:207`, `src/ui/app/use-shortcuts.ts:105` |
| Perceptual harness | render-and-diff with analytic truth masks, IoU metrics, opt-in PNG artifacts | `src/__fixtures__/perceptual/` (ADR-025) |
| Persistence | `.lf2` inline base64 (pixels stored twice: dataUrl + luma); luma length validator | `src/io/project/*`, `project-raster-luma-validator.ts` |

**Gap list a paint editor must fill** (none of these exist): non-nearest resampling; any color-aware pipeline (everything collapses to luma at import); curves/levels/filter primitives; selections/brushes/clone; per-image edit history (project-snapshot undo would copy base64 blobs per brushstroke); GPU/wasm compute; in-canvas raster interaction layer.

## 4. Product design

**Working name:** Image Studio. (Menu label: `Edit Image…`.)

**Entry points** (all gated on a raster selection, `hasRasterSelection` precedent): a primary button in `SelectedObjectProperties`/`SelectedImageAdjustments`; a registered command `tools.edit-image` (menu/toolbar/shortcut for free via the command registry); canvas double-click on a `raster-image` object (the `handleCanvasDoubleClick` comment at `src/ui/workspace/Workspace.tsx:350` invites exactly this).

**Layout** (fixed-inset overlay above `--lf-z-dialog`): left vertical tool strip (kit `IconButton`s, mirroring the app's `ToolStrip`); top tool-options bar (new surface — per-tool size/hardness/opacity/tolerance/feather controls); center editor canvas stack (checkerboard, document, selection-ants overlay, brush cursor) with cursor-anchored zoom/pan/fit reusing the `view-transform.ts` math pattern; right panel column: Adjustments, Histogram, History (Tier 4 adds Layers); bottom status row: zoom %, cursor px + mm, document px @ DPI, view toggle.

**View toggle — the laser-native feature Photoshop lacks:** Natural (RGBA) ⇄ **Engrave preview** (the real `buildProcessedRasterBitmap` output at current layer settings — the dither the machine will burn) ⇄ **Trace overlay** (Tier 2: live re-trace of the working bitmap, debounced, latest-wins like F-E1). The operator paints while watching what the laser/tracer will actually see.

**Session model — guard-rule-compliant by construction (CLAUDE.md #7):** opening creates an in-memory edit session for that object; **closing the editor never asks anything** — the session is simply kept, keyed by object id, and reopening resumes it. `Apply` bakes into the scene object (one project-undo entry); `Revert session` is an explicit button. There is no "discard changes?" dialog anywhere — nothing is lost on close, so nothing needs confirming. Sessions are in-memory only in Tiers 1–3 (an app reload drops unapplied edits; Apply is cheap and undoable, and autosave/recovery of sessions is a named Tier-4 item).

**Keyboard:** the overlay registers via `useRegisterModal`, so all app shortcuts (including global Ctrl+Z) are suppressed — therefore the editor ships its own keymap and its own undo/redo from day one: Photoshop-familiar `B/E/M/L/W/C/V` tool keys, `[`/`]` brush size, `Ctrl+Z`/`Ctrl+Shift+Z` editor history, `Ctrl+D` deselect, `Ctrl+Shift+I` invert selection, `Ctrl+0/+/-` zoom, space-drag pan, Esc = cancel current op → Select tool → close (session kept).

## 5. Architecture

### 5.1 Data model

- **Working space: RGBA at source resolution** (decoded from `dataUrl`, inside the existing 8192 px / 32 MP caps). Rationale: the color source already survives in `dataUrl`; editing in RGBA keeps eyedropper/wand color fidelity and future color tools open, while the laser pipeline keeps consuming derived luma. Grayscale-leaning ops just act uniformly on RGB.
- **`EditSession`** (ephemeral store state): `baseRgba` (immutable), ordered committed `EditOp[]`, `workingRgba` (baked current state), `selection` (1-bit mask + bounds + feather), tile-CoW history stacks, viewport, active tool state.
- **`EditOp` is a discriminated union** (`stroke`, `line`, `fill-region`, `clear-selection`, `adjust`, `filter`, `crop`, `resize`, `rotate`, `flip`, …) with `assertNever` dispatch — the house state style, and the future hook for persistable/re-playable sessions.
- **Purity:** every op is a pure function `(RgbaBuffer, params) → RgbaBuffer | in-place-on-cloned-tiles` in `core/`; no `Date.now`, no RNG without an injected seed, no DOM. Canvas/ImageBitmap conversion happens only in `ui/`.

### 5.2 Editor-local undo/redo

Tile-based copy-on-write: the document is tiled 256×256; committing an op snapshots only touched tiles onto the undo stack under a byte budget (`EDITOR_HISTORY_BYTE_BUDGET`, ~256 MB, oldest-evicted, all tunable named constants). Project-store undo is untouched until Apply (exactly one entry). This is the design answer to the mapped trap: whole-`Project` snapshots carry the base64 blobs and cannot absorb per-stroke history.

### 5.3 Apply contract

Bake `workingRgba` → PNG via async `toBlob` in a worker (the `convert-bitmap-worker` pattern; never sync `toDataURL` — RESEARCH_LOG 2026-06-04) → patch the `RasterImage`: new `dataUrl`, re-extracted `lumaBase64`, updated `pixelWidth/Height` on crop/resize (mm `bounds` preserved unless the user crops/resizes, in which case mm follows the same DPI so physical scale never silently changes), `validateRasterLumaBase64` invariant maintained. One undo entry. Layer settings (mode/dither/linesPerMm) untouched. `role:'trace-source'` objects keep working with `tools.retrace-original`. Engrave resolution is unaffected by any preview downsampling (ADR-202 principle: preview budgets never reduce applied resolution — Apply always bakes full-res).

### 5.4 Modules (all new files unless noted; barrels ≤ 20 exports — split barrels if the surface grows)

```
src/core/image-edit/            pure pixel engine (new module, index.ts barrel)
  rgba-buffer.ts                RgbaBuffer type + clone/blit/convert helpers
  tiles.ts / history.ts         tile split/merge, CoW history under byte budget
  brush-stamp.ts / stroke.ts    falloff disc stamps along a polyline (spacing/hardness/flow)
  line-op.ts                    straight/45°-constrained line raster
  selection-mask.ts             1-bit mask + bounds + feather (separable blur on mask)
  wand-fill.ts                  scanline flood fill w/ tolerance (wand + paint-bucket share it)
  lasso.ts / marquee.ts         polygon + rect/ellipse mask writers
  mask-outline.ts               mask → boundary loops for marching ants (candidate: reuse trace walker)
  clear-fill.ts                 delete-to-white / fill-color inside mask
  transform-region.ts           move (T1) then scale/rotate (T2) of selection contents
  adjust-luts.ts / histogram.ts levels, curves, brightness/contrast/gamma as LUTs + histogram
  filter-blur.ts / filter-sharpen.ts / filter-median.ts
src/core/raster/  (additions)
  resample-bilinear.ts          bilinear + area-average (also the standing NN-photo-resample fix)
  dither halftone/newsprint     new clustered-dot screens beside existing kernels (engrave parity)
src/ui/image-editor/            overlay workspace (new folder)
  image-editor-store.ts         ephemeral Zustand session store (camera-wizard precedent)
  ImageEditorOverlay.tsx        fixed-inset shell (Viewer3DDialogShell precedent, rAF focus override)
  EditorCanvas.tsx / editor-draw.ts / editor-pointer.ts   canvas stack, on-change draw, pointer-captured tool dispatch
  EditorToolStrip.tsx / ToolOptionsBar.tsx / panels/ (Adjustments, Histogram, History)
  editor-worker.ts + client + protocol    filters/bake off-thread, latest-wins + cancel
  editor-shortcuts.ts           editor-local keymap
```

UI↔core boundary stays clean (`ui` imports the `core/image-edit` barrel only); the editor chunk is **lazy-loaded** (`await import`, the ADR-102 three.js precedent) so cold-start < 2 s and the < 1 MB budget are untouched for non-users.

### 5.5 Performance budgets (named constants, all tunable)

Interactive strokes render main-thread into the visible canvas (target 60 fps at 4096²) with tile commits deferred; filters/adjust previews run in the worker with progress + cancellation and a downsampled live preview above 4 MP (bake always full-res); worst-case memory bounded ≈ working RGBA (≤ 128 MB at the 32 MP cap) + history budget. No WebGL in Tiers 1–3; a WebGL2/wasm acceleration lane is a named Tier-4 ADR if profiling demands it.

## 6. Feature inventory and phasing

Tier legend: **T1–T3 planned below; T4 designed-for/deferred; OUT permanent.** Each phase = a stack of individually-reviewable PRs (tight-leash rule), each with tests + perceptual evidence before the next starts.

### Phase IE-1 — "Line work & selections" (the core ask)

Open/close/resume/Apply plumbing; zoom/pan/fit; **brush + pencil + eraser** (size/hardness/opacity, black/white/gray + eyedropper; erase-to-white — white is "no burn"/"no trace"); **line tool** (drag, Shift = 45°); **selection model**: rect/ellipse marquee, freehand + polygonal lasso, magic wand (tolerance/contiguous), select all/none/invert, feather; **selection ops**: delete (→ white), fill (black/white/gray), paint-clipped-to-selection, **move selection contents**; crop tool; editor undo/redo + History panel; Apply → optional immediate re-trace (existing command); Engrave-preview view toggle.

Suggested PR stack (~12): (0) governance docs → (1) `RgbaBuffer`+tiles+history core → (2) brush/stroke/line core → (3) selection mask+marquee+ants core → (4) wand/lasso core → (5) overlay shell+store+canvas+zoom/pan → (6) brush/pencil/eraser tools+options bar → (7) line tool → (8) selections UI+ants → (9) selection ops+move → (10) crop → (11) Apply/bake+re-trace hook+engrave view → (12) polish/shortcuts/help. Steps 1–4 are pure-core PRs with property tests; UI lands only after its core exists.

### Phase IE-2 — "Adjust & filters" (absorbs ADR-030 §3)

Levels + histogram (the #1 documented reason laser users leave for GIMP/Photoshop), curves, brightness/contrast/gamma (bake-time), threshold/posterize preview, invert; Gaussian blur, **unsharp mask exposed as Enhance Amount/Radius (closes the named LightBurn Adjust-Image parity gap)**, median/despeckle; **every adjustment applies through the active selection**; transform selection contents (scale/rotate); Image Size / Canvas Size with bilinear/area resampling; arbitrary-angle rotate; **Halftone (cells-per-inch + screen angle) + Newsprint + Sketch modes** (completes LightBurn's 10-mode set — engrave parity beyond the editor); **live Trace overlay view** (the loop's killer feature); relationship contract with `AdjustImageDialog` (below).

### Phase IE-3 — "Retouch & content"

Clone stamp; dodge/burn; despeckle brush; **one-click background removal** (border flood + color distance — classical, dependency-free; the feature LightBurn staff outsource to remove.bg and xTool headline as "AI Cutout"); text stamp (raster text via bundled `opentype.js` fonts); gradient fill (grayscale ramps → engraving); paste-external-image into session; spot-heal as **masked median/edge-aware blend** — a PatchMatch-class healing brush is explicitly deferred: PatchMatch sits under active Adobe patents (content-aware fill family), so any patch-synthesis implementation needs a patent review first (flagged in the risk table).

### Phase IE-4 — deferred, each its own ADR

Layer stack + blend modes + masks + adjustment layers (non-destructive); session persistence into `.lf2` (schema revision + size strategy for original-vs-edited dedupe); WebGL2/wasm acceleration; 16-bit depth; perspective/warp; session autosave.

### OUT — permanent (grounded in PROJECT.md)

Cloud/AI generative editing and any network-assisted feature (non-negotiable #8); ML background removal under non-commercial weights; color management/CMYK/print; smart objects; plugins/scripting/macros (out-of-scope list); video/3D/RAW.

## 7. Cross-feature contracts

- **`AdjustImageDialog` stays.** It edits the *live engrave-stage* scalars (brightness/contrast/gamma consumed at compile — LightBurn's Adjust Image parity). The Studio's adjustments are *bake-time pixel ops*. Both existing surfaces remain; the Studio's Adjustments panel notes "applies to pixels on Apply". No two-sources-of-truth: scalars stay on the object, bakes replace pixels.
- **Image mask / crop:** geometry masks (`imageMaskId`) keep working on the edited bitmap; Studio crop commits pixels (like `cropMaskedRasterImage` today) and never mutates masks silently.
- **Engrave NN-resample fix is a separate PR** outside the Studio: switching `resampleLumaNearest` → bilinear in the burn path changes emitted S-values ⇒ G-code snapshot diffs ⇒ needs its own acknowledged snapshot change + hardware note. The Studio must not smuggle that change in.
- **Determinism:** identical session ops on identical input bake byte-identical PNGs (property-tested); dither/G-code determinism (non-negotiable #5) is unaffected because the pipeline downstream of `RasterImage` is untouched.
- **`.lf2`:** no schema change in Tiers 1–3 (Apply rewrites existing fields; the luma-length validator keeps holding). Session persistence is the Tier-4 schema decision.

## 8. Verification plan (Karpathy's law applies in full)

Green structural tests will not prove a paintbrush feels right or a wand selects sanely. Per increment:

1. **Instrument-first** (ADR-025 discipline): golden math tests for every op (stamp coverage counts, LUT endpoints, flood-fill region sizes) before any UI.
2. **Perceptual fixtures**: extend `src/__fixtures__/perceptual/` with editor-loop fixtures — *draw a stroke → re-trace contains the new contour; erase a speck → contour count drops; wand-delete a region → IoU vs analytic expectation*. Opt-in PNG artifacts for eyeballing.
3. **Rendered-PNG review**: every UI increment ships before/after PNGs (scratchpad recipe from the font-fairing sessions) in the PR description.
4. **Side-effect-free live verification** (collab rule 4): drive throwaway buffers/canvases, never the maintainer's real scene; full-app import walkthroughs are the maintainer's call.
5. **Playwright**: the overlay's open/tool/apply happy path joins the `*.e2e.ts` browser-smoke suite (separate workflow — run it for UI changes).
6. **Stated non-verification**: hardware burns are unaffected until the engrave-resample PR; that PR carries its own hardware note.

## 9. Risks and traps

| Risk | Mitigation |
|---|---|
| File/complexity caps (250/400 lines, cc ≤ 12) | Folder-per-surface decomposition from day 1 (`AdjustImageDialog.*` and `job-review/` templates); kernel tables not branches |
| Global shortcuts dead while modal open | Editor-local keymap + own undo from PR #5 onward (mapped: `use-shortcuts.ts:105`) |
| Whole-project snapshot undo × base64 blobs | Editor-local tile history; project undo only at Apply |
| Guard-rule violation via "unsaved changes?" dialog | Resumable-session close design — no confirmation surface exists to review |
| Memory blowups on large photos | Existing 8192/32 MP caps + tile budget constants + worker bake |
| Worker preview races | Latest-request-wins + bounded timeout, the F-E1 pattern verbatim |
| Barrel cap (new barrels ≤ 20 exports) | `core/image-edit` starts with a curated barrel; split (`/selection`) if it nears 20 |
| Bundle/cold-start regression | Lazy-loaded editor chunk (ADR-102 precedent); zero new deps |
| Silent physical-size change on resize | DPI-preserving Apply contract; mm bounds change only with explicit crop/resize, shown in the dialog |
| Duplicating median/despeckle already in `core/trace` | Lift shared primitives once, in a tidy-first refactor PR, if reuse is confirmed at build time |
| Adobe PatchMatch / content-aware-fill patents | Ship spot-heal as masked median/edge-aware blend only; any patch-synthesis healing needs a patent review first (see web-research report §D2) |
| EOL/prettier doc traps | This doc + governance PRs are new files (LF); `.md` is prettier-ignored per repo convention |

## 10. Governance to ratify (in order, before any code)

1. **ADR-242 — "Image Studio: in-app raster editing of `RasterImage` sources"**. Records: deliberate LightBurn-exceeding divergence; zero-dependency in-house engine; RGBA bake-on-Apply model; editor-local undo; resumable-session/no-confirm design; ADR-030 §3 absorbed; the OUT list; the engrave-resample separation. Draft lives in this document's sections 4–7 — lift verbatim.
2. **PROJECT.md revision**: new phase block (suggested: **Phase L — v0.11 "Image Studio"**, staged IE-1…IE-4 like Phase K's S-table), plus a "Future feature notes" cleanup pointing here.
3. **WORKFLOW.md**: F-L1 (open/edit/apply success), F-L2 (selection editing), F-L3 (edit→re-trace loop), F-L4 (error/empty/edge: no raster selected → Convert-to-Bitmap path; oversize image; worker failure), each with success/error/empty/edge per house format.
4. **RESEARCH_LOG.md**: kickoff-survey entry (the §2.3 table + LightBurn URLs), zero-adoption outcome recorded.

## 11. Open decisions for the maintainer

1. **Ratify Phase IE-1 scope + the name** ("Image Studio" recommended; "Edit Image…" as the verb everywhere).
2. **RGBA working space** (recommended) vs luma-only (smaller, but forecloses color-aware selection/eyedropper and future color ops).
3. **Ship the engrave NN→bilinear resample fix now as its own snapshot-acknowledged PR** (recommended) or defer until IE-2.
4. **Halftone/Newsprint dithers**: land early inside IE-2 (recommended — engrave parity win independent of the editor) or hold for the editor.

**Recommended action:** ratify ADR-242 + the PROJECT.md Phase L block from this document, then green-light the Phase IE-1 PR stack starting with PR 0 (governance docs) and PR 1 (`core/image-edit` buffer/tiles/history with property tests).
