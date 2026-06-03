# Trace Provenance Cleanup - 2026-06-03

Status: closed for KF-023 after source comparison and comment cleanup.

## Scope

This audit checked whether the LaserForge 2.0 trace pipeline conflicts with ADR-002, which says the 2.0 repo is a clean rewrite and no code carries over from LaserForge 1. The concern came from production comments that used broad phrases like "LF1 port" and "ported from LaserForge 1".

This was not a runtime trace behavior change. The lane was provenance cleanup only.

## LF1 Sources Located

Local LF1 source files found under `C:\Users\Asus\LaserForge`:

- `src/core/image/ImageProcessing.ts`
- `src/import/Dithering.ts`
- `src/import/trace/ImageTracerAdapter.ts`
- `src/import/trace/PotraceCurveMath.ts`
- `src/import/trace/PotracePathScanner.ts`
- `src/import/trace/PotracePolygonMath.ts`
- `src/import/trace/PotraceTraceBackend.ts`
- `src/import/trace/PotraceTracer.ts`
- `src/import/trace/trace.worker.ts`
- `src/import/trace/TraceBitmap.ts`

No matching dither source was found in `C:\Users\Asus\_old-laserforge-1-quarantine`; the active LF1 comparison source was `C:\Users\Asus\LaserForge\src\import\Dithering.ts`.

## Classification

### `src/core/trace/raster-prep.ts`

Classification: LF1 math parity, rewritten implementation.

Evidence:

- LF1 `ImageProcessing.ts` operates on `Uint8Array` byte buffers with abort checks.
- LF2 `raster-prep.ts` operates on `RawImageData` RGBA buffers, applies per-channel transforms, preserves alpha, and shares a `mapRgb` helper.
- The formulas match LF1:
  - brightness: `v + brightness * 2.55`
  - contrast: `(v - 128) * (1 + contrast / 100) + 128`
  - gamma: `(v / 255) ** (1 / gamma) * 255`
  - invert: `255 - v`

Decision: ADR-002 does not need changing. Comments now say LF1 math parity, not LF1 port.

### `src/core/trace/dither-trace.ts`

Classification: LF1 catalogue/coefficient parity, rewritten implementation.

Evidence:

- LF1 `Dithering.ts` defines the same 13 dither mode IDs and common error-diffusion kernels.
- LF2 converts RGBA to a luma plane, returns `RawImageData`, splits dispatcher/kernel helpers for complexity caps, and keeps pure-core constraints.
- The common kernels, Bayer matrix, blue-noise tile size, and deterministic LCG constants are retained as behavior parity.

Decision: ADR-002 does not need changing. Comments now say parity with LF1 catalogue and coefficients, not ported source code.

### `src/core/trace/trace-to-paths.ts`

Classification: LF1-informed behavior parity, clean LF2 implementation.

Evidence:

- LF1 `ImageTracerAdapter.ts` calls `imagedataToTracedata`, walks ImageTracer segments, converts Q segments to cubic Potrace-like `CURVE` items, and returns contour item lists.
- LF2 `trace-to-paths.ts` calls `imagedataToTracedata`, but converts ImageTracer segments directly into LaserForge 2.0 `ColoredPath[]`/polyline scene data. Q segments are sampled into polylines, then cleaned for small trace artifacts.
- The LF2 data shape, cleanup, and polyline output are not LF1 code.

Decision: ADR-002 does not need changing. Comments now say the LF1 lesson was the tracedata route; LF2 is its own polyline implementation.

### UI/worker wrappers

Classification: LF2-only wrapper code.

Evidence:

- `src/ui/trace/ImportImageDialog.tsx`, `src/ui/trace/AdjustmentControls.tsx`, and `src/ui/trace/trace-worker.ts` describe the current LF2 dialog/worker flow.
- Their old "LF1-port" wording was provenance noise, not evidence of copied implementation.

Decision: comments now say direct tracedata path, LF1-compatible controls, and worker responsiveness without calling the worker an LF1 port stage.

## ADR-002 Impact

No ADR-002 change is required. The audit found behavior parity targets, common algorithm constants, and LF1-informed settings, but did not find a copied LF1 trace subsystem in the current LaserForge 2.0 trace code reviewed for this lane.

## Applied Cleanup

Comment-only production edits were applied to:

- `src/core/trace/trace-to-paths.ts`
- `src/core/trace/raster-prep.ts`
- `src/core/trace/dither-trace.ts`
- `src/core/trace/index.ts`
- `src/core/trace/trace-image.ts`
- `src/ui/trace/trace-worker.ts`
- `src/ui/trace/ImportImageDialog.tsx`
- `src/ui/trace/AdjustmentControls.tsx`
- `src/core/trace/raster-prep.test.ts`
- `src/core/trace/dither-trace.test.ts`

## Verification Plan

- Grep trace source for broad "LF1 port" / "ported from" wording.
- Run focused trace tests to prove comment-only cleanup did not disturb trace behavior.
- Run typecheck, lint, and diff whitespace checks before closing the ledger item.
