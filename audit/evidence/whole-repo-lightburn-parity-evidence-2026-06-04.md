# Whole-Repo LightBurn Parity Evidence - 2026-06-04

## Repo Identity

- `C:\Users\Asus\LaserForge` returned: `fatal: not a git repository`.
- `C:\Users\Asus\LaserForge-2.0` returned branch: `wip/checkpoint-2026-06-03`.
- Active repo for this audit: `C:\Users\Asus\LaserForge-2.0`.

## Local Specs Read

- `CLAUDE.md`
- `PROJECT.md`
- `DECISIONS.md`
- `WORKFLOW.md`
- Root `AUDIT.md` exists in the repo file list.
- Old `AGENTS.md`-named docs under `docs/` were not present in this checkout.

## External Sources Checked

- LightBurn UI: https://docs.lightburnsoftware.com/latest/Reference/UI/
- LightBurn File menu: https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/
- LightBurn Selection: https://docs.lightburnsoftware.com/latest/Reference/Selection/
- LightBurn Layer Modes: https://docs.lightburnsoftware.com/latest/Explainers/LayerModes/
- LightBurn Cuts/Layers: https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/
- LightBurn Fill Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/
- LightBurn Image Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- LightBurn Trace Image: https://docs.lightburnsoftware.com/latest/Reference/TraceImage/
- LightBurn Preview: https://docs.lightburnsoftware.com/latest/Reference/Preview/
- LightBurn Convert to Bitmap: https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/
- LightBurn Coordinates and Origin: https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/
- LightBurn Job Control: https://docs.lightburnsoftware.com/2.1/GetStarted/JobControl/
- GRBL interface: https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md
- GRBL realtime commands: https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Commands
- GRBL laser mode: https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md
- MDN canvas `toDataURL`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL

## Code Evidence

### GRBL error continues stream

- `src/ui/state/laser-line-handler.ts:146-148`: `cls.kind === 'error'` sets `lastError` and calls `advanceStream(set, get, safeWrite, 'error')`.
- `src/core/controllers/grbl/streamer.ts:129-153`: `onAck` consumes ok/error/alarm uniformly and increments completed state for the acknowledged line.

### Follow-up write failure disconnects streamer

- `src/ui/state/laser-line-handler.ts:166-172`: after `step`, failed `safeWrite(stepped.toSend)` sets `streamer: disconnectStreamer(acked.state)`.

### Convert to Bitmap synchronous UI path

- `src/ui/raster/vector-to-bitmap.ts:52-67`: production `buildBitmapFromVector` calls `assembleBitmap` with `lumaToBitmap`, then `rasterizeVectorToLuma`.
- `src/ui/raster/luma-bitmap.ts:37-82`: `lumaToBitmap` builds RGBA, creates a canvas, writes ImageData, and calls `canvas.toDataURL(PNG_MIME)`.

### Raster preview unguarded work

- `src/ui/workspace/draw-raster-preview.ts:85-121`: `previewCanvasFor` computes target dimensions, decodes luma, resamples, dithers, builds RGBA/ImageData, and caches a canvas.

### Direct compile before budget in Start/Frame

- `src/ui/laser/start-job-readiness.ts:94-104`: `findOriginBoundsIssue` calls `compileJob` directly.
- `src/ui/laser/JobControls.tsx:240-276`: `useFrameAction` calls `compileJob` directly for frame bounds.
- `src/io/gcode/prepare-output.ts:28-37`: the safe shared path runs `runPreEmitPreflight` before `compileJob`.

### SVG fill-only and sizing gaps

- `src/io/svg/parse-svg.ts:8-10`: comments state elements without stroke are skipped.
- `src/io/svg/parse-svg.ts:94-103`: `parseBounds` falls back to `Number.parseFloat` on `width` / `height`.
- `src/io/svg/parse-svg.test.ts:58-65`: text/fill-only no-stroke import returns `object=null`.

### Layer order and raster ETA

- `src/core/job/compile-job.ts:9-44`: compile determinism follows `scene.layers` and `scene.objects`.
- `src/core/job/estimate-duration.ts:67-122`: raster estimate models one span per row.
- `src/core/raster/emit-raster.ts:110-123`: raster emitter now supports multiple active spans per row.

## Verification Commands Observed

- `pnpm run typecheck`: passed.
- `npm.cmd run lint`: passed, with known boundaries legacy-selector warning.
- `npm.cmd run check:file-size`: passed.
- `npm.cmd run license-check`: passed.
- `pnpm test`: passed, 133 files / 979 tests.
- `npm.cmd run build`: passed. Vite warned that `src/core/scene/index.ts` and `src/ui/trace/image-loader.ts` are both statically and dynamically imported, so those dynamic imports do not split chunks.
- `git diff --check HEAD`: passed.
- `pnpm exec prettier --check .`: failed on 12 pre-existing files:
  - `audit/findings/lightburn-parity-codex-verification-2026-06-03.json`
  - `src/core/invariants/blank-feed.test.ts`
  - `src/core/job/fill-sweeps.ts`
  - `src/core/job/toolpath.test.ts`
  - `src/core/job/toolpath.ts`
  - `src/core/output/grbl-strategy.fill-power-mode.test.ts`
  - `src/core/output/grbl-strategy.property.test.ts`
  - `src/core/output/grbl-strategy.test.ts`
  - `src/io/gcode/prepare-output.test.ts`
  - `src/ui/laser/SafetyNoticeBanner.tsx`
  - `src/ui/laser/JobControls.tsx`
  - `src/ui/workspace/draw-preview.parity.test.ts`

## Notes

- The audit artifacts were written after the passing suite, so focused lint/prettier checks should be re-run on the new audit files before calling this audit branch clean.
- No production files were patched during this audit implementation step.
