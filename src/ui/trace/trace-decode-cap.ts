// Decode caps shared by the trace loader and the commit-grid policy.
//
// Cap on the longest image edge after decode, in pixels. Two competing
// forces: trace runtime is O(width × height × colors) (imagetracerjs and
// potrace both), so an unbounded decode makes tracing a large photo crawl;
// but a cap that is too LOW throws away the resolution small features —
// especially small TEXT — need, so they trace as faceted, wavy curves: the
// "langebaan" small-text defect (docs/research/burn-perfection-small-text.md
// Cause B; ADR-037). 2048 (was 1024) doubles the linear resolution — 4× the
// pixels, ~4× the trace time — recovering small-feature fidelity while staying
// interactive on modest hardware in the trace Worker.
//
// RAISING this is registration- and size-safe because every trace result carries
// the actual working grid used by its paths. The imported burn bitmap may retain
// a larger grid (up to BURN_MAX_EDGE_PX); placement maps trace-grid coordinates
// across the bitmap's physical bounds, and boundary boxes are remapped from the
// burn grid to this working grid. Only recovered detail density changes.
// We intentionally do NOT upscale BELOW the source's own size: bilinear-
// upscaling deliberate pixel art (the Sharp preset) would blur the very
// notches the user wants kept. Larger inputs are downsampled proportionally.
const MAX_EDGE_PX = 2048;
// The live preview keeps this cap so it stays interactive. A committed trace
// and a Multi-File batch no longer share it: they decode the grid
// planTraceCommitGrid (trace-commit-grid.ts, ADR-401) chooses from the
// physical output and a memory budget, which is never coarser than this one.
// Their size controls are converted so they drop what the preview dropped.
export const PREVIEW_MAX_EDGE_PX = MAX_EDGE_PX;

// Exported for unit testing the cap math directly (decodeImage needs a real
// browser canvas, so the cap behaviour is verified here as a pure function).
export function scaleToCap(
  width: number,
  height: number,
  cap: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= cap) return { width, height };
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
