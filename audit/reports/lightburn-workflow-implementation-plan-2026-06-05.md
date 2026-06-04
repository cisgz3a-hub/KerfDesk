# LaserForge 2.0 -- Operator Workflow Implementation Plan (LightBurn Parity)

**Date:** 2026-06-05
**Author:** Lead developer (LightBurn-dev hat), grounded against the LIVE tree at `C:/Users/Asus/LaserForge-2.0`.
**Audience:** The implementing developer (Claude or Codex) who will execute ticket-by-ticket.
**Provenance:** Every LaserForge claim below cites `file:line` that was read in the live LF2 tree on 2026-06-05. Every LightBurn behavior cites an official doc page or the in-repo `LIGHTBURN-STUDY.md` (which itself cites official docs). The disabled LaserForge 1 tree was NOT read.

---

## 0. The LightBurn ethos this plan is built on

A LightBurn developer does not ask "what feature is missing?" first. They ask "what is the operator trying to do, and what is the shortest honest path to a good burn?" Six principles drive every decision in this plan:

1. **Workflow-first, import once, decide downstream.** An image is imported one way, as a raster on an Image-mode layer. Trace is a *tool you run later*, not a fork at import. Engrave is *just the layer mode the raster already sits on*. (`LIGHTBURN-STUDY.md` Sec 1.1-1.5; docs.lightburnsoftware.com/2.0/Collections/WorkingWithImages/)
2. **Layers ARE the cut settings.** A layer is a color plus a mode (Line / Fill / Offset Fill / Image) plus the parameters that mode consumes. Mode and settings are properties of the layer, edited after the fact, never chosen at import. (docs.lightburnsoftware.com/latest/Explainers/LayerModes/)
3. **Repeatability via the Material Library.** The operator tunes once on scrap, saves the recipe, and reapplies it forever. (docs.lightburnsoftware.com/2.1/Reference/MaterialLibrary/)
4. **Honest output: preview == burn.** What the preview shows is what the laser does. No silent resampling, no hidden mode flips.
5. **Depth where it matters.** Min/Max power for grayscale variable-depth engraving; M4 dynamic power so corners do not over-burn. (docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html; github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md)
6. **Never fake hardware safety in software.** Calibration (Focus / Interval / Material tests) produces a pattern the operator burns and *reads with their own eyes*. The software never pretends it knows the right power for an uncalibrated material, and never pretends a software check replaces the laser-off-on-travel invariant the output engine already guarantees.

LF2 today is a **strong, safe output engine** (laser-off-on-travel invariant, error-terminal streamer, honest disconnect handling -- audit 7.5/10) wrapped in an **incomplete operator workflow** (parity ~6.5 vs LightBurn). This plan closes the workflow gap without touching the safety core.

---

## 1. KARPATHY-LAW CORRECTION TO THE INPUT RESEARCH (read this before anything else)

The per-area research handed to me asserted, repeatedly, that **LF2 has only three dither modes (threshold, floyd-steinberg, grayscale)** and that the fix is to "lift 13 dither modes from the trace path into the raster path," with a claimed "format mismatch (RawImageData vs Uint16Array)" as the central risk.

**This is false against the live tree. I read the code.**

- `src/core/raster/dither.ts:33-44` -- the `DitherAlgorithm` union already enumerates **eleven** modes: `threshold | floyd-steinberg | jarvis | stucki | atkinson | burkes | sierra3 | sierra2 | sierra-lite | ordered | grayscale`.
- `src/core/raster/dither.ts:67-79` -- the `dither()` dispatcher already routes every one of those modes and returns `Uint16Array` S-values directly. The error-diffusion kernels (Floyd-Steinberg, Jarvis, Stucki, Atkinson, Burkes, Sierra x3) are present and canonical (`dither.ts:215-322`), with serpentine scan (`dither.ts:178-193`).
- `src/core/scene/scene-object.ts:122-136` -- `DITHER_ALGORITHMS` const lists the same eleven; `DitherAlgorithm` is derived from it; `Layer.ditherAlgorithm` references it via `LayerDitherAlgorithm = DitherAlgorithm` (`src/core/scene/layer.ts:16`).

**Consequence:** The expensive part of the image-engrave proposal (port algorithms, bridge a type mismatch, schema-migrate the enum from 3 to 11 values) **does not exist as work.** The enum is already 11-wide; old `.lf2` files already deserialize against it. The REAL image-engrave gap is narrow and cheap:

1. The UI never lets the operator *pick* the mode after import (`LayerRow.tsx` has no dither dropdown wired to a live layer mutation -- it is at the 400-line hard cap and must be split first).
2. The default is `floyd-steinberg` (`layer.ts:62`), not Jarvis, which LightBurn recommends for photos.
3. There is genuinely no Min Power per layer, no Adjust Image tool, no per-layer DPI editing UI, no Dot Width Correction.

This is the single most important reason to **verify external claims against the live tree before coding** (CLAUDE.md hard rule). The plan below is written against what the code actually is.

A secondary correction: the research's "ten dither modes" for LightBurn (Newsprint, Halftone, Sketch) are *halftone-screen / edge-detection* modes that LF2 does not have. Those are genuinely missing, but they are lower value than the error-diffusion modes LF2 already ships. They are scoped as deferred, not Phase 1.

---

## 2. THE FOUNDATION -- what must land FIRST, and why everything depends on it

The architecture-integration area is correct on the central point: **the layer data model is the contract that every workflow feature widens.** But the audit's "split power into a `common`/`fill`/`image` sub-object tree" refactor is bigger and riskier than the workflow needs, and it breaks the flat shape that `compileJob` reads today. I am scoping the foundation tighter.

### 2.1 The single foundational change

**FOUNDATION = (a) widen `Layer` with the per-layer cut-setting fields the workflow features need, additively and flat; plus (b) add a `moveLayer` reorder primitive to `Scene`.**

Why these two, together, first:

- **Every** Phase 1 workflow feature is a new field on `Layer` consumed by `compileJob`: Min Power (image-engrave depth), per-layer DPI editing (already a field, needs a UI + budget guard), Dot Width Correction, the dither *choice* surfaced in UI. If each feature adds its own field in its own ticket, we serialize-migrate the project format N times and re-touch `LAYER_DEFAULTS`, `createLayer`, and `deserialize-project` N times. Landing the field set once, with one schema bump and one migration, is the recoverable path.
- **The cut list is the layer list.** LightBurn executes layers top-to-bottom and lets you reorder them (docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/). LF2 executes in `scene.layers` array order (`compile-job.ts:45`, confirmed) and has **no reorder function** (`scene.ts:33-50` -- `addLayer`/`updateLayer`/`removeLayer` only). `moveLayer` is the one primitive that turns "a list of layers" into "an ordered cut list." It is pure, ~8 lines, and unblocks the Cut List UI that the operator experiences as the spine of the app.

### 2.2 Concrete type/shape change (flat, additive -- NOT the sub-object tree)

In `src/core/scene/layer.ts`, extend the existing flat `Layer` type (current shape at `layer.ts:18-49`). Add these fields:

```typescript
export type Layer = {
  // ... all existing fields unchanged (id, color, mode, power, speed, passes,
  //     visible, output, hatchAngleDeg, hatchSpacingMm, fillOverscanMm,
  //     fillBidirectional, ditherAlgorithm, linesPerMm) ...

  readonly minPower: number;            // 0..100 percent. Default 0. Grayscale floor + M4 corner floor.
  readonly dotWidthCorrectionMm: number; // 0..linesPerMm. Default 0. Image mode only.
  readonly negativeImage: boolean;       // Default false. Image mode only.
  readonly passThrough: boolean;         // Default false. Image mode only.
};
```

Rules grounded in the live constraints:

- **All four are non-optional with a default.** `tsconfig` runs `exactOptionalPropertyTypes` (CLAUDE.md / audit). The existing `LAYER_DEFAULTS` (`layer.ts:51-64`) is `satisfies Omit<Layer,'id'|'color'>` -- it MUST provide every value or it stops compiling. Add `minPower: 0, dotWidthCorrectionMm: 0, negativeImage: false, passThrough: false`. Defaults are chosen so behavior is byte-identical to today (minPower 0 -> grayscale spans 0..power exactly as `ditherGrayscale` does now at `dither.ts:145-153`; toggles false = no-op).
- **Keep the shape FLAT.** `compileJob` reads `layer.power`, `layer.ditherAlgorithm`, `layer.linesPerMm`, `layer.fillOverscanMm` directly (`compile-job.ts:67-73, 96-110`). A `common`/`fill`/`image` sub-object tree (the architecture-integration proposal) would force a rewrite of every read site in `compile-job.ts`, `optimize-paths.ts`, `LayerRow.tsx`, `grbl-strategy.ts` for zero workflow benefit. **Reject the sub-object refactor.** Flat-additive is the LightBurn-equivalent data model and the cheap one.
- **Do NOT add `minPower`/`maxPower` rename.** `power` stays as the max. LightBurn's "Max Power" maps to existing `layer.power`; "Min Power" is the new floor. This avoids renaming a field that 8 files read.
- **Do NOT add `offset-fill` to `LayerMode` yet.** Adding a 4th literal to `LayerMode` (`layer.ts:10`) forces a new arm in every `switch (layer.mode)` and `switch (obj.kind)` exhaustiveness check (`compile-job.ts:281-301, 310-324`) with no planner behind it. Defer (Section 8).

### 2.3 RasterGroup threading (the one real wiring gap the audit caught correctly)

`RasterGroup` (`job.ts:39-59`) carries only `power: number` -- there is no `minPower`. `compileRasterGroup` (`compile-job.ts:90-125`) computes `sMax` from `layer.power` and calls `dither(..., { algorithm, sMax })`. To make Min Power real, thread it:

- Add `readonly minPowerS: number;` to `RasterGroup` (the floor in S units, computed once in compile so emit/dither stay free of percent math), OR pass `sMin` into `DitherOptions`. **Preferred: extend `DitherOptions`** (`dither.ts:54-63`) with `readonly sMin?: number;` (default 0) and have only `ditherGrayscale` honor it -- interpolate across `[sMin, sMax]` instead of `[0, sMax]`. Error-diffusion and threshold remain binary (0 or sMax) because Min Power has no meaning for a 1-bit pixel; that matches LightBurn, where Min Power only modulates grayscale and DSP corner power.
- `compileRasterGroup` computes `sMin = round((clamp(layer.minPower,0,100)/100) * device.maxPowerS)` and passes it through. This is the *only* compile-path change for Min Power.

### 2.4 `moveLayer` primitive

In `src/core/scene/scene.ts` (sits beside `updateLayer` at `scene.ts:37-46`):

```typescript
export function moveLayer(scene: Scene, layerId: string, direction: 'up' | 'down'): Scene {
  const i = scene.layers.findIndex((l) => l.id === layerId);
  if (i === -1) return scene;
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= scene.layers.length) return scene; // clamp at edges, no-op
  const next = [...scene.layers];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...scene, layers: next };
}
```

Pure, deterministic, no I/O. Execution order is `scene.layers` order (`compile-job.ts:45`); reordering the array reorders the cut list. The optimizer explicitly does NOT reorder layers (`optimize-paths.ts` header: "layer ORDER is user-controlled ... not reordered here") -- so `moveLayer` is the complete mechanism. No planner change.

### 2.5 Schema migration (one bump, done once)

- `PROJECT_SCHEMA_VERSION` is currently `1` (`deserialize-project.ts:4`, `migrations.ts` registry empty).
- Bump to `2`. Register migrator `1` in `MIGRATORS` (`migrations.ts:39`) that injects the four new field defaults into every layer lacking them. The migrator is a pure `RawProject -> RawProject` (the registry's exact contract, `migrations.ts:18-19`).
- Snapshot-test: a hand-written v1 `.lf2` with one image layer loads, gets the defaults, and round-trips. Add to `migrations.test.ts`.
- This is the FIRST real migrator the registry has ever carried; the dispatch chain (`migrations.ts:30-50`) already supports it -- one table entry, exactly as the file's own header promised ("a single table entry rather than rewriting deserialize-project").

### 2.6 Empirical verification of the foundation (before any feature)

- **Byte-identical-output proof:** Compile a fixture scene (one image layer at default settings, one line layer) BEFORE and AFTER the foundation lands. Emitted G-code MUST be byte-identical, because every new field defaults to a no-op. This is the concrete check that proves the foundation is non-breaking. Wire it as a test that emits to string and compares to a committed golden.
- **Reorder proof:** `moveLayer(scene, L2, 'up')` on `[L1,L2,L3]` yields `[L2,L1,L3]`; recompiling produces `groups[]` in the new order; the G1/raster emission sequence reverses. Deterministic (same input -> same output).

---

## 3. PER-FEATURE PLANS

Effort key: S < 0.5 wk, M ~1 wk, L ~2 wk, XL 3+ wk. "Hardware-verify?" flags what can only be proven on the Falcon A1 Pro.

---

### 3.1 IMAGE-MODE ENGRAVING

**What LightBurn does.** Image is one of four layer modes, a property of the layer, not an import choice (docs.lightburnsoftware.com/latest/Explainers/LayerModes/). The Image-mode layer exposes dither mode (ten choices; Jarvis is the photo default), Line Interval/DPI, Scan Angle, Dot Width Correction, Negative Image, Pass-Through, and Min/Max power for grayscale variable-depth (docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html). Grayscale maps lightest->Min Power, darkest->Max Power for depth on CO2 and shading on diode. The five-step photo flow ends in the Adjust Image tool (brightness/contrast/gamma/enhance), a non-destructive live-preview modal (docs.lightburnsoftware.com/Tools/AdjustImage.html; .../Tutorials/PerfectImageEngraveSettings/). M4 dynamic power is recommended for image mode so power tracks feed at line boundaries (github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md).

**Current LaserForge.**
- Eleven dither modes ALREADY implemented and dispatched to `Uint16Array` (`dither.ts:33-79, 215-322`). NOT three. (Correcting the input research -- Section 1.)
- Default dither is `floyd-steinberg` (`layer.ts:62`); LightBurn uses Jarvis for photos.
- Raster emit already uses M4 internally and ends in M5 (`grbl-strategy.ts:172-217`, ADR-020/036). M4-for-raster is already shipped, not a new feature.
- Single power per layer; no Min Power floor (`layer.ts:22`, `job.ts:43`). `ditherGrayscale` spans `[0, sMax]` (`dither.ts:145-153`).
- `linesPerMm` is a per-layer field (`layer.ts:48`, default 10 = ~254 DPI) but there is NO UI to edit it after import.
- No Adjust Image tool, no Dot Width Correction, no Negative/Pass-Through, no Scan Angle.
- `LayerRow.tsx` is **409 lines -- over the 400 hard cap** (confirmed via wc).

**Gap.** Not algorithms. The gap is: (1) UI to choose dither per layer; (2) Jarvis default; (3) Min Power floor for grayscale depth; (4) per-layer DPI editing UI + budget guard; (5) Adjust Image modal; (6) Dot Width Correction; (7) Negative/Pass-Through toggles.

**Design (reconciled with the audit's `build-with-changes`).**

The audit's refinedApproach is right that `RasterGroup` needs Min Power threaded and that `LayerRow` must be split before fields are added. It is WRONG that a new `dither-raster.ts` module must be created to bridge a type mismatch -- there is no mismatch (Section 1). Drop that work entirely.

- **Phase 1a (depth + choice):** thread `sMin` per Section 2.3; flip default to `jarvis`; split `LayerRow.tsx` into `LayerRowCommon` / `LayerRowFill` / `LayerRowImage` subcomponents (mandatory -- file is over cap) and add, in `LayerRowImage`, a dither `<select>` (all 11 modes, Jarvis labelled "recommended for photos"), a Line Interval numeric input (range 5-25, warn > 20 per the `RasterImage.linesPerMm` comment at `scene-object.ts:155-157`), and a Min Power input. All visible only when `layer.mode === 'image'`.
- **Phase 1b (Adjust Image):** new `src/ui/raster/AdjustImageDialog.tsx`, non-destructive. Adjustment params live on the Layer (or per-image -- see Open Questions Q3) as `imageAdjustment?: { brightness; contrast; gamma; enhanceRadius; enhanceAmount; denoise }` (OPTIONAL, the one field where `exactOptionalPropertyTypes` undefined-means-none is correct). Emit applies them to luma BEFORE dither, on a copy -- source `dataUrl`/`lumaBase64` is never mutated. The pipeline point is `compileRasterGroup` (`compile-job.ts:100-107`): insert an `applyImageAdjustment(luma, layer.imageAdjustment)` before `dither(...)`.
- **Phase 2 (calibration knobs):** Dot Width Correction shortens each active span; the existing emit path is in `emit-raster.ts` (raster emit per `grbl-strategy.ts:172-176`). Negative Image inverts luma (`luma = 255 - luma`) before dither. Pass-Through skips `resampleLumaNearest` (`compile-job.ts:100`) and dithers at source density.

**File-by-file changes.**
- `src/core/scene/layer.ts` -- add `minPower`, `dotWidthCorrectionMm`, `negativeImage`, `passThrough` (foundation, Section 2.2); optional `imageAdjustment` lands with Phase 1b.
- `src/core/raster/dither.ts` -- add `sMin?: number` to `DitherOptions` (`:54-63`); `ditherGrayscale` (`:145-153`) interpolates `[sMin, sMax]`. No other algorithm changes.
- `src/core/job/compile-job.ts` -- `compileRasterGroup` (`:90`) computes `sMin`, passes to `dither`; (Phase 1b) applies `imageAdjustment` to luma before dither; (Phase 2) inverts luma if `negativeImage`, skips resample if `passThrough`.
- `src/core/job/job.ts` -- (only if NOT routing via DitherOptions) add `minPowerS` to `RasterGroup`. Preferred path keeps `job.ts` unchanged.
- `src/ui/layers/LayerRow.tsx` -- SPLIT into `LayerRow.tsx` (wrapper) + `LayerRowCommon.tsx` + `LayerRowFill.tsx` + `LayerRowImage.tsx`. Hard requirement: each stays under 400 (target < 250).
- `src/ui/raster/AdjustImageDialog.tsx` -- NEW (Phase 1b).
- `src/ui/state/scene-mutations.ts` (or `store.ts` actions) -- `updateLayerDither`, `updateLayerLinesPerMm`, `updateLayerMinPower`, `applyImageAdjustment`.
- `src/core/preflight/` pre-emit -- warn if image-layer `linesPerMm > 20`, block > 25 (reuse the existing raster budget guard noted in the high-priority-image-burn roadmap).
- `src/io/project/migrations.ts` -- the foundation migrator covers the new fields.

**Empirical verification FIRST (before coding).**
- *Min Power, emitted-output check:* dither a 2x256 vertical gradient with `grayscale`, `sMin = round(0.2*maxPowerS)`, `sMax = round(0.8*maxPowerS)`. Assert `S(luma=0) ~= sMax` and `S(luma=255) ~= sMin` (NOT 0). Today's code yields 0 at white; the change yields `sMin`. This single assertion is the proof Min Power is wired.
- *Default flip:* compile an image layer fixture; assert the chosen kernel is JARVIS (the `RasterGroup.sValues` differ from the floyd-steinberg golden on a known gradient).
- *Adjust Image non-destructive:* assert the `RasterImage.lumaBase64`/`dataUrl` bytes are identical before and after an adjustment is applied and the job compiled (adjustment lives on layer, applied to a copy).
- *Dot Width Correction:* property test -- corrected span length = original - dotWidthCorrectionMm, never negative.

**Tests.** Per-mode `Uint16Array` range `[0,sMax]` (most exist); grayscale `[sMin,sMax]` interpolation (new); M4 preamble present in raster emit (snapshot); laser-off-on-travel invariant unchanged (existing property test must still pass).

**Hardware-verify?** YES -- (a) grayscale gradient at min 20% / max 80%: confirm smooth depth without charring at max; (b) Jarvis vs Floyd-Steinberg photo A/B: confirm Jarvis quality. Mark "Hardware verification needed" in the commit + audit doc per CLAUDE.md safety-path rule. Software cannot prove burn quality.

**Effort.** Phase 1a: M. Phase 1b (Adjust Image): M. Phase 2 knobs: M. Total L.

**Dependencies.** Foundation (Section 2) for the fields. `LayerRow` split must precede any image-field addition (file over cap).

**Audit verdict.** **build-with-changes**, with TWO corrections to the audit itself: (1) no `dither-raster.ts` / no algorithm port / no enum migration -- the modes exist; (2) M4-for-raster is already shipped, do not re-claim it. The audit's exactOptionalPropertyTypes and RasterGroup-threading cautions are valid and folded in above.

---

### 3.2 LAYERS AS CUT SETTINGS + THE CUT LIST

**What LightBurn does.** The Cuts/Layers window is a vertical, reorderable list; execution is top-to-bottom; each row shows mode/speed/power/passes; settings live in the Cut Settings Editor (Common/Advanced tabs); copy/paste settings between layers; "Sort Cuts Last" orders by cutting strength (docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/; .../CutSettingsEditor/; `LIGHTBURN-STUDY.md` Sec 4.1-4.9).

**Current LaserForge.**
- `Layer` is flat with mode/power/speed/passes/visible/output + fill + image fields (`layer.ts:18-49`).
- `Scene` has add/update/remove layer but **no `moveLayer`** (`scene.ts:33-50`).
- `compileJob` iterates `scene.layers` in order, honoring `layer.output` (`compile-job.ts:45-46`).
- `LayerRow.tsx` is an inline card at 409 lines (over cap); no reorder UI, no copy/paste.
- No sub-layers, no Optimization Settings dialog.

**Gap.** Reorder UI + `moveLayer`; copy/paste settings; (later) Cut Settings Editor modal; Optimization Settings; sub-layers.

**Design (reconciled).** The audit's `build-with-changes` is right that the dither enum is split across modules but "aligned by comment" -- and it recommends a single-source-of-truth enum. I AGREE and fold it in cheaply: `DitherAlgorithm` already lives in `dither.ts` AND is re-derived from `DITHER_ALGORITHMS` in `scene-object.ts`, with `layer.ts` aliasing. That is two definitions. Make `scene-object.ts`'s `DITHER_ALGORITHMS` the single source and have `dither.ts` import the type from it (reverse the current `layer.ts -> scene-object.ts` direction so all three agree). This is a 3-file, zero-logic refactor; do it as a tiny precursor ticket so adding any future mode is one edit. **Defer the Cut Settings Editor modal and Optimization Settings to Phase 2/3** -- they are large UI surfaces and the audit flags `LayerRow` is already over cap.

Min Power, dither-choice, DPI editing UI are shared with image-engrave (Section 3.1) -- do not duplicate.

**File-by-file changes.**
- `src/core/scene/scene.ts` -- add `moveLayer` (Section 2.4).
- `src/core/scene/scene-object.ts` -- `DITHER_ALGORITHMS` becomes the single enum source; `dither.ts` imports the type from `../scene` instead of redeclaring (`dither.ts:33-44` collapses to a re-export).
- `src/ui/state/store.ts` -- add `moveLayer(layerId, direction)` action (pushes undo); `copyLayerSettings(fromId, toId)`. NOTE: `store.ts` is 404 lines (over cap) -- extract a `layer-actions` slice while adding these.
- `src/ui/layers/CutsLayersPanel.tsx` -- Up/Down buttons per row (drag-reorder deferred to polish).
- `src/ui/layers/LayerRow*.tsx` -- post-split (Section 3.1), add reorder affordance + copy/paste buttons.

**Empirical verification FIRST.** `moveLayer` reorders `scene.layers`; recompiled `Job.groups` order matches; emitted G-code group sequence reverses; deterministic. Single-source enum: `tsc --noEmit` still 0 errors and `DitherAlgorithm` resolves to one declaration (grep shows one `export type DitherAlgorithm`).

**Tests.** `moveLayer` up/down/edge-clamp (`scene.test.ts`); copy excludes id/color; undo frame captured on reorder.

**Hardware-verify?** No (pure reordering; output is deterministic and testable in software).

**Effort.** `moveLayer` + reorder UI + enum unify: M. Copy/paste: S. Cut Settings Editor modal: L (Phase 2). Optimization Settings + sub-layers: L-XL (Phase 3).

**Dependencies.** Foundation. `LayerRow` split. `store.ts` slice extraction (over cap).

**Audit verdict.** **build-with-changes.** Adopt: enum single-source-of-truth, `LayerRow` split, defer Cut Settings modal / Optimization Settings / sub-layers / Min Power UI behind device-type gate. The audit's worry that "reorder is cosmetic without Optimization Settings" is overstated for LF2 -- execution genuinely follows `scene.layers` order (`compile-job.ts:45`), so reorder is functional on day one; Optimization Settings (cut-inner-first global toggles) is an enhancement, not a prerequisite.

---

### 3.3 MATERIAL LIBRARY + MATERIAL TEST GENERATOR

**What LightBurn does.** Material Library stores named cut-setting presets keyed by material/thickness, distributed as `.clb`; Assign copies settings independently, Link syncs the layer to the entry (docs.lightburnsoftware.com/2.1/Reference/MaterialLibrary/). Material Test generates a parametric speed/power grid (default 10x10), each cell labelled, executed ascending by burn risk; operator burns it, reads it, adopts the best cell (docs.lightburnsoftware.com/latest/Reference/MaterialTest/; `LIGHTBURN-STUDY.md` Sec 7.7-7.8).

**Current LaserForge.**
- `Layer` holds per-color settings (`layer.ts:18-49`); `compileJob` applies a layer's settings uniformly to all objects of that color (`compile-job.ts:61-75`) -- there is **no per-object power/speed override**.
- `RasterGroup`/`CutGroup` carry one `power`/`speed` at the group level (`job.ts:21-59`).
- `TRACE_PRESETS` exists as a named-preset precedent (`src/core/trace/`), but there is no material library.
- Schema migration framework ready (`migrations.ts`).

**Gap.** No cross-project preset store; no `.clb`; no Material Test grid generator; AND -- the blocker the audit found -- **no per-object cut-setting overrides**, which a 10x10 test grid with distinct per-cell power/speed requires.

**Design (reconciled with the audit's `split-smaller` / `feasible:false`).** The audit is correct: a Material Test grid where each of 100 cells burns at a different power/speed is **infeasible on today's architecture** because settings live at the layer/group level, not per object (`compile-job.ts:354-370`, `job.ts:14-29`). Two honest paths:

- **Path A (guided-manual, ships now, zero architecture change):** Material Test generates a labelled grid of rectangles, all on ONE layer at a base power/speed, with text labels showing the *intended* per-cell values. The operator burns it, but since all cells share settings this only varies by... nothing -- so Path A as a single-layer grid is only useful if we put each ROW (or each cell) on its OWN layer. With LF2's color-keyed layers, a 10x10 grid = up to 100 layers. That is ugly but architecturally legal today and matches "operator reads grid, copies best settings." **Recommend Path A as N-row layers (10 layers, one per speed row, columns vary by... again blocked).** Honestly, even rows need per-column variation. So Path A degrades to: generate the grid GEOMETRY + labels, operator manually sets a handful of layers. Low value.
- **Path B (per-object overrides, the real fix):** add optional `powerScale?: number` (and/or `speedOverride`) to `SceneObject`, applied at the `CutSegment -> CutGroup` boundary in `compileJob`. This is the LightBurn "Power Scale %" Shape Property anyway (docs.lightburnsoftware.com/latest/Reference/ShapeProperties/). With per-object power scale, a Material Test grid is 100 rectangles on one layer, each with a distinct `powerScale`, and the generator is a pure function. **This is the correct foundation and it doubles as the Shape Properties power-scale feature.**

**Decision: split exactly as the audit says.** Phase G.x.a = per-object override foundation (ADR required); Phase G.x.b = Material Test generator on top; Material Library (.clb) is a separate, later track because it needs the Cut Settings Editor and a storage/format decision (Open Questions Q2).

**File-by-file changes (Phase B, per-object foundation).**
- `src/core/scene/scene-object.ts` -- add `readonly powerScale?: number` (0..100, undefined = 100%) to the shared object fields.
- `src/core/job/compile-job.ts` -- in `appendPathSegments` / `compileRasterGroup`, fold `powerScale` into the group's effective power (or carry per-segment; simplest: per-object groups when scale differs).
- `src/io/project/migrations.ts` -- additive optional field; no bump strictly required but bundle with foundation bump.
- (Phase B grid) `src/core/material-test/` -- NEW pure module: `generate-material-test.ts`, `material-test-params.ts`, `material-test-preset.ts` (diode/CO2 presets).
- `src/ui/laser/MaterialTestDialog.tsx` -- NEW.

**Empirical verification FIRST.** *Per-object override:* two rectangles on one layer, powerScale 50% and 100%; compile; assert the emitted S for the 50% object is half the 100% object's. *Grid:* generated scene -> bounds fit device bed (reuse `frame-preflight`); cells non-overlapping; deterministic geometry (snapshot the scene JSON).

**Tests.** Override math; grid alignment/bounds property tests; preset config snapshots.

**Hardware-verify?** YES for the burn itself (the whole point is reading scorch on scrap). The generator/override are software-provable; the *calibration* is hardware. Never let software claim a "correct" cell.

**Effort.** Per-object override foundation: M. Material Test generator: S. Material Library (.clb + Assign/Link + UI): L-XL, deferred.

**Dependencies.** Per-object override BEFORE Material Test. Material Library AFTER Cut Settings Editor (Section 3.2 Phase 2).

**Audit verdict.** **split-smaller** (adopt the audit verbatim). Do NOT build the 100-distinct-cell generator until per-object overrides exist. Build the override first (it is also Shape Properties power-scale), then the generator. Defer Material Library.

---

### 3.4 JOB ORIGIN / START FROM / FRAMING / COORDINATES

**What LightBurn does.** Start From: Absolute Coords / Current Position / User Origin; a 9-dot Job Origin anchor selector active for Current Position / User Origin, grayed for Absolute (docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/; `LIGHTBURN-STUDY.md` Sec 5.5). Frame traces the bounding box (or rubber-band) following the Start From / Job Origin setting (docs.lightburnsoftware.com/latest/GetStarted/FramingBeginner/).

**Current LaserForge.**
- `JobStartMode = 'absolute' | 'user-origin'` -- **no `current-position`** (`job-origin.ts:6`).
- `JobOriginAnchor` has all 9 anchors and `anchorPoint()` computes all 9 correctly (`job-origin.ts:8-79`).
- `applyJobOrigin` handles absolute (no-op) and user-origin (translate so anchor -> 0,0) (`job-origin.ts:34-40`); raster groups translate via `offsetJobBounds` (`job-origin.ts:112-114`).
- Anchor is hardcoded `front-left` in both placement constants (`job-origin.ts:24-32`); no UI picker.
- Frame + Start route through `prepareOutput` / `start-job-readiness.ts` (per the research's file:line set).

**Gap.** No Current Position mode; no Start From dropdown; no 9-dot picker UI; anchor locked to front-left. The MATH is already there.

**Design (reconciled with the audit's `build-with-changes`).** The audit's most important correction: **keep `JobOriginPlacement` opaque at the I/O boundary.** Do NOT split `PrepareOutputOptions` into `startMode + anchor` (that couples the pure-core factory to the I/O layer and duplicates the state-to-placement flow). Instead, the UI layer (`start-job-readiness.ts`) constructs the `JobOriginPlacement` from store state and hands the opaque value to `emitGcode`, exactly as today. Add a `createJobPlacement(mode, anchor)` factory in `job-origin.ts`.

For Current Position, the audit is right that `headPosition` cannot reach `prepareOutput` cleanly. Compute the offset in `start-job-readiness.ts` from `statusReport.pos`, where the head position actually lives, and either pass it as `preflightMotionOffset` or apply `applyJobOrigin` with a `headPosition` arg AFTER compile. Semantics (audit's clarity fix): **the chosen anchor of the job bounds is translated TO the current head position.**

Safety: block Start/Frame if Current Position is chosen but head position is unknown, and if User Origin is chosen but WCO is unknown (the latter gate already exists). Tooltip MUST warn: "Job will burn starting from the current head location. Move the head clear of the part before pressing Start." This honors principle 6 -- the software does not hide where the laser will fire.

**File-by-file changes.**
- `src/core/job/job-origin.ts` -- `JobStartMode` gains `'current-position'`; add `createJobPlacement(mode, anchor='front-left')`; `applyJobOrigin` gains optional `headPosition` for the current-position branch.
- `src/ui/state/laser-store.ts` -- `jobOriginStartMode`, `jobOriginAnchor`, setters.
- `src/ui/laser/JobControls.tsx` -- `StartFromRow` (dropdown) + 9-dot `JobOriginPicker` (disabled when Absolute).
- `src/ui/laser/start-job-readiness.ts` -- resolve mode from store, build placement via factory, compute current-position offset from `statusReport.pos`, extend preflight to gate unknown head position.

**Empirical verification FIRST (deterministic, no hardware).**
- Absolute: centered 50x30 raster on 400x400 bed -> bounds unchanged.
- User Origin, front-left, WCO (10,20): emitted bounds offset to ~X10..60, Y20..50.
- Current Position, center anchor, head (100,150): emitted job bounds center at ~(100,150). Concretely: head (100,100), job [0,0]-[50,50], center anchor -> output bounds [75,75]-[125,125]. This exact assertion is the Karpathy proof and runs every build.
- Preflight blocks: User Origin + unknown WCO; Current Position + unknown head; any mode whose adjusted bounds exceed the bed.

**Tests.** `start-job-readiness.test.ts` -- the matrix above plus blocked cases with clear messages.

**Hardware-verify?** YES, narrowly: that the Falcon A1 Pro, in Current Position mode, physically starts at the head's location. The translation math is software-proven; the physical correspondence is hardware.

**Effort.** M.

**Dependencies.** None on the foundation -- this is self-contained in `job-origin.ts` + laser UI. Can proceed in parallel with the foundation. (It does NOT need the layer model change.)

**Audit verdict.** **build-with-changes.** Adopt the audit's two key corrections (keep `JobOriginPlacement` opaque; compute head offset in `start-job-readiness`, not `prepareOutput`) and the explicit Current-Position semantics. Defer rubber-band framing.

---

### 3.5 IMPORT-ONCE MODEL + TRACE (VECTOR-ONLY) + CONVERT TO BITMAP

**What LightBurn does.** Import is one action -> raster on an Image-mode layer. Trace is a TOOL (Tools -> Trace, Alt+T) producing plain vectors; source kept by default (docs.lightburnsoftware.com/latest/Reference/TraceImage/). Trace controls are a brightness band: Cutoff/Threshold/Ignore Less Than/Smoothness/Optimize/Sketch (`LIGHTBURN-STUDY.md` Sec 1.3). Convert to Bitmap (Ctrl+Shift+B) is vector->raster with Render Type (Outlines/Fill All/Use Cut Settings) + DPI; result on an Image-mode layer (docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/).

**Current LaserForge.**
- Trace presets are `numberOfColors` + Otsu/median/despeckle (`src/core/trace/trace-image.ts`); Photo/Detailed presets do multi-layer posterization -- a paradigm mismatch with LightBurn's single-layer vector trace.
- `compileJob` carries a `'traced-image'` SceneObject arm (`compile-job.ts:288-289, 317-318`) -- LightBurn's trace output is plain vectors, not a special kind.
- Convert to Bitmap is synchronous, hardcoded DPI + dither, no dialog (per research file:line; budget guard tracked as P1-A).
- Default raster layer color is `#808080` grey, divergent from LightBurn black, documented as a deliberate anti-collision choice (`scene-object.ts:178-183`).

**Gap.** Trace control vocabulary mismatch; Convert to Bitmap has no dialog/budget; `TracedImage` is a structural special-case; grey-vs-black divergence undocumented as ADR.

**Design (reconciled with the audit's `build-with-changes`, three staged PRs).** Adopt the audit's split exactly:
- **PR 1 (Trace vocabulary):** add Cutoff/Threshold/Ignore Less Than/Smoothness/Optimize to the trace dialog; keep Line Art/Centerline/Smooth/Sharp; **do NOT remove Photo/Detailed yet** (no engrave-image alternative until the operator understands Image mode is the photo path). This is UI + `TraceOptions`, no data-model change.
- **PR 2 (Convert to Bitmap dialog):** reuse the budget guard; add `ConvertToBitmapDialog.tsx` with DPI slider + Render Type radiogroup (ship Fill All; disable Outlines/Use Cut Settings with "coming soon"); keep the source vector (do not delete).
- **PR 3 (structural):** eliminate `TracedImage` kind -> trace output becomes a plain vector object tagged with `sourceImageId`; requires the schema bump + migrator (fold into the foundation bump or a dedicated one); change `DEFAULT_RASTER_LAYER_COLOR` to black ONLY with an ADR recording why (the grey anti-collision rationale at `scene-object.ts:178-183` must be explicitly overridden). This PR is the riskiest -- it touches the `SceneObject` union and `compile-job.ts` exhaustiveness arms.

**File-by-file changes.** PR1: `src/core/trace/trace-image.ts`, `src/ui/trace/*`. PR2: `src/ui/raster/ConvertToBitmapDialog.tsx` (new), `src/ui/raster/vector-to-bitmap.ts`, `src/ui/state/ui-store.ts`, `src/ui/common/Toolbar.tsx`. PR3: `src/core/scene/scene-object.ts` (drop `traced-image`), `src/core/job/compile-job.ts` (merge arms), `src/io/project/migrations.ts` (migrator), `src/ui/state/scene-mutations.ts`.

**Empirical verification FIRST.** PR1: Line Art/Centerline/Smooth/Sharp still emit clean vectors on a fixture logo (perceptual before/after). PR2: a rotated square at 254 DPI -> expected pixel dimensions; budget guard rejects a 300x300mm vector. PR3: a v1 `.lf2` containing a traced image opens in v2 and emits byte-identical G-code (the migration is lossless).

**Tests.** Trace preset output snapshots; convert dimension/budget tests; migration round-trip + golden G-code equality.

**Hardware-verify?** Trace/Convert are vector/raster software ops -- software-provable. Only the eventual *engraved photo quality* (shared with Section 3.1) is hardware.

**Effort.** PR1: M. PR2: M. PR3: L (structural + migration). Total L.

**Dependencies.** PR3's migration should ride the foundation schema bump (Section 2.5) or a dedicated bump after it. Convert-to-Bitmap budget guard (P1-A) should land first.

**Audit verdict.** **build-with-changes** -- adopt the 3-PR split; require an ADR for the grey->black change; do not remove Photo/Detailed until Image mode is the documented photo path; perceptual fixtures mandatory for PR1/PR3.

---

### 3.6 VECTOR TOOLING / SHAPE DESIGN

**What LightBurn does.** Shape primitives, Node editing, Boolean (Union/Subtract/Intersect/Weld), Offset, Align/Distribute, Grid/Circular Array, Measure, Path-Text, Convert to Path, Shape Properties (docs.lightburnsoftware.com/latest/Reference/EditNodes/, .../BooleanTools/, .../OffsetShapes/, .../GridArray/, .../CircularArray/; `LIGHTBURN-STUDY.md` Sec 6).

**Current LaserForge.** SVG import + Text only; no primitives, no node editing, no boolean, no align/distribute/array, no measure, no Shape Properties (audit gap list; `LIGHTBURN-STUDY.md` Sec 8.4). Boolean would need a polygon-clipping library (Vatti 1992; Clipper2 / polygon-clipping).

**Gap.** Essentially the entire vector-design toolset.

**Design.** **GOVERNANCE-GATED -- DO NOT SCHEDULE CODE.** This area is explicitly out-of-scope per `PROJECT.md` / `DECISIONS.md` and marked governance-blocked in the remaining-work roadmap. Per CLAUDE.md's stop-and-ask rule and the off-roadmap contract, this requires an explicit maintainer ADR (proposed ADR-041) to enter scope BEFORE any implementation. The research's 6-phase plan (V.1-V.6) is a RESEARCH FRAMEWORK only.

If approved later, the audit's `defer` verdict prescribes the correct entry: Phase 0 (governance + design doc: node representation, `PrimitiveShape` fields, selection model, Boolean closure spec), then micro-phased V.1 (primitives + numeric transform), each micro-phase under the file/function caps, with hardware verification (calipers on a burned rectangle) before V.2.

**File-by-file changes.** None scheduled. (Future, if approved: `src/core/shapes/`, `src/core/geometry/`, `src/ui/workspace/` -- all deferred.)

**Empirical verification FIRST.** N/A until greenlit. (Future: burned primitive measured with calipers matches transform values.)

**Tests.** N/A.

**Hardware-verify?** Yes, eventually (no vector primitive has ever been burned on the Falcon).

**Effort.** XL. **Not scheduled.**

**Dependencies.** Maintainer ADR-041 approval + a separate design doc. Per-object Shape Properties (power-scale) from Section 3.3 Phase B is the one tiny piece that legitimately overlaps and is justified by Material Test, so it may proceed under that ticket only.

**Audit verdict.** **defer.** Do not write code. Surface to the maintainer as a stop-and-ask (Section 5).

---

## 4. THE BUILD ORDER -- what gets coded FIRST, and why (defensible from the dependency graph)

The ordering is not vibes; it is the topological sort of the dependency graph plus the strict "foundation before consumers" rule.

### 4.1 Dependency graph (edges = "must land before")

```
                         [F] FOUNDATION
        (Layer +minPower/dotWidth/negative/passThrough; moveLayer;
              DitherOptions.sMin; schema v2 + migrator)
                 |            |            |             |
        +--------+      +-----+-----+      +------+      +-----------+
        v               v           v             v                  v
 [1] Image depth  [2] Cut-list   [3b] Per-obj   [5-PR3] Trace     (enum single-
  (Jarvis default, reorder        powerScale     structural        source-of-truth
   Min Power, DPI  (moveLayer UI, foundation      migration         precursor, tiny)
   UI; needs       enum unify)    (Shape Prop +   (rides F's bump)
   LayerRow split) |              Material Test)        |
        |          |                  |                 |
        v          v                  v                 v
 [1b] Adjust    [2b] Cut       [3b'] Material    [5-PR1/2] Trace vocab +
   Image modal   Settings        Test generator    Convert-to-Bitmap dialog
        |        Editor (L)          |             (independent of F; PR2 needs
        v        [defer]             v              budget guard P1-A)
 [2 image knobs] [3 Optimization] [3 Material Library .clb] [defer]
 (DotWidth,      [defer]          [defer -- needs Cut Settings Editor + format ADR]
  Negative,
  PassThrough)

 [4] ORIGIN / START FROM  --- NO EDGE TO F --- can run fully in parallel.

 [6] VECTOR TOOLING --- GOVERNANCE-GATED --- not in graph; needs ADR-041.
```

### 4.2 The answer: CODE THIS FIRST

**FIRST TO CODE = the FOUNDATION (Section 2): the flat-additive `Layer` field set (`minPower`, `dotWidthCorrectionMm`, `negativeImage`, `passThrough`) + `DitherOptions.sMin` threading in `compileRasterGroup` + the `moveLayer` primitive + the schema v2 bump and its single migrator.**

Rationale, strictly from the graph:
1. It is the only node with **no inbound edges and four outbound edges** (image depth, cut-list, per-object foundation's migration bundle, trace structural migration). Every Phase 1 workflow feature reads a field it adds. Landing it once = one schema bump, one migration, one `LAYER_DEFAULTS` edit; landing features first = N bumps and N re-touches of the same three files.
2. It is **provably non-breaking** before any feature rides it: the byte-identical-output golden test (Section 2.6) proves every new field defaults to a no-op. That makes it the safest possible first commit -- it changes the contract without changing behavior.
3. `moveLayer` turns the layer list into the cut list, which is the spine the operator experiences; bundling it with the field widening means the very next UI ticket (`LayerRow` split + reorder + dither dropdown) has everything it needs.

**Within the foundation, the precise first commit** is the pure-core slice: `layer.ts` fields + `LAYER_DEFAULTS` + `scene.ts` `moveLayer` + `dither.ts` `sMin` + `compile-job.ts` `sMin` threading + the migrator, with the golden-output test. No UI. This keeps the first commit inside pure-core, deterministic, and verifiable without a browser -- exactly the kind of change the test runner and `tsc --noEmit` gate cleanly.

### 4.3 Then, in order

1. **`LayerRow.tsx` split** (mechanical, unblocks all image/layer UI; file is over the 400 cap TODAY so this is also a standing lint debt fix).
2. **Image depth + choice** (Jarvis default, Min Power input, dither dropdown, DPI input + budget guard) -- Section 3.1 Phase 1a.
3. **Cut-list reorder UI + enum single-source precursor + `store.ts` slice extraction** (`store.ts` also over cap) -- Section 3.2.
4. **Origin / Start From** -- Section 3.4. (No edge to foundation; can start in parallel with step 1 if a second developer exists.)
5. **Adjust Image modal** -- Section 3.1 Phase 1b.
6. **Trace vocab (PR1) + Convert-to-Bitmap dialog (PR2)** -- Section 3.5. (PR2 needs the P1-A budget guard.)
7. **Per-object `powerScale` foundation, then Material Test generator** -- Section 3.3 Phase B (ADR for the override).
8. **Image calibration knobs** (Dot Width, Negative, Pass-Through) -- Section 3.1 Phase 2.
9. **Trace structural (PR3): drop `TracedImage`, grey->black + ADR** -- Section 3.5 PR3.

**Deferred (explicit):** Cut Settings Editor modal, Optimization Settings, sub-layers, Material Library `.clb`, Offset Fill mode, Scan Angle / Angle Increment, rubber-band framing, Newsprint/Halftone/Sketch dither, and ALL vector tooling.

### 4.4 Quick unblockers (separate from the feature graph -- note, do not bundle)

The CEO/eng framing mentions a "format gate" and a "resume try/catch" as quick unblockers. These are NOT on the workflow dependency graph and must not be bundled into foundation commits (one-ticket-per-commit, CLAUDE.md). If they correspond to live defects:
- **Convert-to-Bitmap pre-budget guard (P1-A):** a standalone safety/UX fix; land before Section 3.5 PR2. One commit.
- **Any streamer resume/disconnect try/catch hardening:** a safety-path change -- separate commit, "Hardware verification needed" note, reviewed against all `safetyOff()`/pause/resume callers (CLAUDE.md safety bar). Do NOT fold into workflow work.

These ride their own tickets, ahead of or beside the workflow stream, exactly because they are independent of the layer model.

---

## 5. OPEN QUESTIONS / DECISIONS NEEDED FROM THE MAINTAINER (before coding)

1. **Vector tooling scope (BLOCKING for Section 3.6).** It is governance-gated and out-of-scope today. Approve an ADR-041 to bring it into scope (and on what tier/phase), or confirm it stays deferred? No code until answered. This is the formal stop-and-ask.
2. **Material recipe / `.clb` schema.** Implement our own JSON preset store, or attempt LightBurn `.clb` compatibility? And: do presets live per-user (e.g. `Documents/LaserForge/Materials`) or embedded in the project? This blocks Material Library (not Material Test). Recommendation: our own versioned JSON, per-user, deferred until the Cut Settings Editor exists.
3. **Adjust Image params: per-layer or per-image?** LightBurn's Adjust Image is per-image; LF2's compile reads layer settings as the winner over per-image (`compile-job.ts:105-106`). Storing adjustment on the Layer is simpler and consistent; storing per-image matches LightBurn and survives re-assigning an image to a different layer. Recommendation: per-image (`RasterImage.imageAdjustment?`), applied in `compileRasterGroup`. Confirm.
4. **Unify trace and raster dither code?** Both `src/core/trace/dither-trace.ts` (RawImageData output, for vectorize preprocessing) and `src/core/raster/dither.ts` (Uint16Array output, for engrave) carry error-diffusion kernels. They serve different outputs and both are tested. Unifying into one kernel module is a clean refactor but pure cleanup with regression risk. Recommendation: leave separate; only adopt the cheap single-source-of-truth for the *enum* (Section 3.2). Confirm you do not want the deeper kernel unification now.
5. **Min Power UI exposure on GRBL.** On GRBL, Min Power only meaningfully modulates grayscale image mode (and M4 corner behavior); for line/fill cuts it is inert. Show the Min Power input only for image-mode layers (recommended), or always with a tooltip? Confirm.
6. **`offset-fill` mode.** Add the 4th `LayerMode` literal now as a stub (forces new exhaustiveness arms, preflight "not supported") for parity optics, or omit until a hatcher exists? Recommendation: omit (Section 2.2). Confirm.
7. **Grey -> black default raster layer color.** Section 3.5 PR3 proposes matching LightBurn black, overriding the documented anti-collision rationale at `scene-object.ts:178-183`. This needs an ADR and your sign-off because it changes a deliberate divergence. Approve?

---

## 6. RESEARCH BIBLIOGRAPHY

### LightBurn official documentation (workflow behavior claims)
- Layer Modes (four modes; mode is a layer property): docs.lightburnsoftware.com/latest/Explainers/LayerModes/
- Working With Images (import once, then downstream choice): docs.lightburnsoftware.com/2.0/Collections/WorkingWithImages/
- Cut Settings -- Image (dither modes, Line Interval, Scan Angle, Dot Width, Negative, Pass-Through, Min/Max power): docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html
- Five Steps to Perfect Image Engraving (Jarvis photo default; Interval/Dot-Width calibration; Adjust Image): docs.lightburnsoftware.com/Tutorials/PerfectImageEngraveSettings/index.html
- Adjust Image (non-destructive brightness/contrast/gamma/enhance): docs.lightburnsoftware.com/Tools/AdjustImage.html
- Trace Image (vectorize TOOL; Cutoff/Threshold/Ignore Less Than/Smoothness/Optimize): docs.lightburnsoftware.com/latest/Reference/TraceImage/
- Convert to Bitmap (Render Type + DPI; result on Image layer): docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/
- Interval Test: docs.lightburnsoftware.com/latest/Reference/IntervalTest/
- Material Test: docs.lightburnsoftware.com/latest/Reference/MaterialTest/
- Material Library (.clb; Assign vs Link): docs.lightburnsoftware.com/2.1/Reference/MaterialLibrary/
- Cuts/Layers Window (reorderable list; top-to-bottom execution): docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/
- Cut Settings Editor (Common/Advanced tabs): docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/
- Coordinates / Origin (Start From modes; 9-dot Job Origin): docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/
- Framing (Beginner): docs.lightburnsoftware.com/latest/GetStarted/FramingBeginner/
- Optimization Settings: docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/
- Shape Properties (Power Scale, Lock, per-image tone): docs.lightburnsoftware.com/latest/Reference/ShapeProperties/
- Boolean Tools / Offset Shapes / Edit Nodes / Grid Array / Circular Array / Arrangement / Distribute / Convert to Path: docs.lightburnsoftware.com/latest/Reference/{BooleanTools,OffsetShapes,EditNodes,GridArray,CircularArray,ArrangementToolbar,Distribute,ConvertToPath}/

### Books / standards (technical grounding)
- Ulichney, R. A. (1987). *Digital Halftoning*. MIT Press. -- error-diffusion theory; Jarvis-Judice-Ninke, Stucki, ordered/Bayer screens.
- Floyd, R. W., & Steinberg, L. (1976). "An adaptive algorithm for spatial greyscale." *Proc. SID* 17(2), 75-77. -- Floyd-Steinberg kernel.
- Vatti, B. R. (1992). "A generic solution to polygon clipping." *CACM* 35(7), 56-63. -- boolean/clipping foundation (vector tooling, deferred).
- GRBL laser mode (M3 constant vs M4 dynamic power): github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md

### In-repo study + audits (all under C:/Users/Asus/LaserForge-2.0)
- LIGHTBURN-STUDY.md -- Sec 1 (image pipeline), 4 (Cuts/Layers + Cut Settings Editor), 5 (Laser window, Start From), 6 (vector tooling), 7 (Material Library/Test, Adjust Image), 8 (LF2-vs-LightBurn gap ledger; ADR-027 LightBurn-as-source-of-truth).
- audit/reports/karpathy-lightburn-rating-audit-2026-06-04.md -- the 7.5/10 rating, P1 findings (Trace UI, Convert-to-Bitmap dialog).
- audit/reports/high-priority-image-burn-roadmap-plan-2026-06-03.md -- P0-P2 phases, image-import DPI metadata, raster budget (P1-A).
- audit/reports/image-trace-bitmap-deep-research-2026-06-04.md -- Convert-to-Bitmap pre-budget guard, modal-shortcut suppression.
- audit/reports/set-origin-user-origin-audit-2026-06-01.md -- origin model root-cause; WCO caching.
- audit/reports/lightburn-parity-audit-2026-06-02.md and whole-repo-lightburn-parity-audit-2026-06-04.md -- parity matrix.

### LaserForge code references (file:line read live on 2026-06-05)
- src/core/scene/layer.ts:10 (LayerMode 3 literals), :16 (LayerDitherAlgorithm alias), :18-49 (flat Layer shape), :51-64 (LAYER_DEFAULTS, floyd-steinberg default), :66-77 (createLayer).
- src/core/scene/scene.ts:33-50 (addLayer/updateLayer/removeLayer; NO moveLayer).
- src/core/scene/scene-object.ts:122-136 (DITHER_ALGORITHMS = 11 modes), :138-176 (RasterImage; dither + linesPerMm fields; lumaBase64; role marker), :178-183 (DEFAULT_RASTER_LAYER_COLOR grey, documented divergence).
- src/core/raster/dither.ts:33-44 (DitherAlgorithm = 11 modes), :54-63 (DitherOptions), :67-79 (dispatcher -> Uint16Array), :145-153 (ditherGrayscale [0,sMax]), :215-322 (canonical kernels).
- src/core/job/job.ts:14-29 (CutSegment/CutGroup, group-level power), :39-59 (RasterGroup, single power, no minPower).
- src/core/job/compile-job.ts:43-78 (layer-order iteration, output gate, mode dispatch), :90-125 (compileRasterGroup; sMax from layer.power; dither call), :281-301 & :310-324 (SceneObject exhaustiveness arms incl. traced-image).
- src/core/job/job-origin.ts:6 (JobStartMode lacks current-position), :8-79 (9 anchors + anchorPoint), :34-40 (applyJobOrigin), :112-114 (raster translate).
- src/core/job/optimize-paths.ts header (layer order user-controlled, not reordered) -- confirms moveLayer needs no planner change.
- src/core/output/grbl-strategy.ts:32-38 (M3 S0 preamble), :172-217 (raster M4 internal + M5; cut=M3, fill=M4 mode-flip per ADR-036) -- confirms M4-for-raster already shipped.
- src/io/project/migrations.ts:18-50 (Migrator contract + dispatch; empty registry, ready) and deserialize-project.ts:4,42-55 (PROJECT_SCHEMA_VERSION = 1).
- src/ui/layers/LayerRow.tsx -- 409 lines (over the 400 hard cap; split required before adding fields).
- src/ui/state/store.ts -- 404 lines (over cap; extract a layer-actions slice when adding moveLayer/copy actions).

---

**Bottom line.** Build the FOUNDATION first (flat-additive Layer fields + sMin threading + moveLayer + schema v2/migrator), proven non-breaking by a byte-identical-output golden test. It is the only graph node with no inbound dependencies and the one every Phase 1 feature consumes. The image-engrave "13-dither-port" is a phantom -- the modes already exist and emit Uint16Array; the real work is UI exposure, a Jarvis default, and a Min Power floor. Vector tooling stays governance-gated until the maintainer signs an ADR.
