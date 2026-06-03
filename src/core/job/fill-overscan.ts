import type { Vec2 } from '../scene';

export type FillOverscanRun = {
  readonly leadStart: Vec2;
  readonly burnStart: Vec2;
  readonly burnEnd: Vec2;
  readonly leadEnd: Vec2;
};

export function expandFillHatchWithOverscan(
  polyline: ReadonlyArray<Vec2>,
  overscanMm: number,
): FillOverscanRun | null {
  const burnStart = polyline[0];
  const burnEnd = polyline[1];
  if (burnStart === undefined || burnEnd === undefined || polyline.length !== 2) return null;

  const dx = burnEnd.x - burnStart.x;
  const dy = burnEnd.y - burnStart.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;

  const runway = Math.max(0, overscanMm);
  const ux = dx / length;
  const uy = dy / length;
  return {
    leadStart: { x: burnStart.x - ux * runway, y: burnStart.y - uy * runway },
    burnStart,
    burnEnd,
    leadEnd: { x: burnEnd.x + ux * runway, y: burnEnd.y + uy * runway },
  };
}

// Below this multiple of the per-side overscan, the laser-off runway (2×
// overscan total) would be longer than the burn itself, so it dominates the
// motion. A traced-image fill fragments each scanline into thousands of such
// short runs; carrying the full runway on every one was the bulk of the
// ~2h-vs-LightBurn-~5min burn (audit 2026-06-03). Short runs skip overscan and
// lose its accel/decel edge-evening on those runs only — a deliberate
// speed/quality tradeoff (DECISIONS.md ADR-033).
const OVERSCAN_MIN_BURN_RATIO = 2;

// The overscan to actually apply to a hatch run: the configured value when the
// burn is long enough to be worth a runway, otherwise 0 (skip). Single source
// of truth so the emitter, the planner ETA, and the preview scrubber agree on
// which runs get a runway.
export function effectiveOverscanMm(polyline: ReadonlyArray<Vec2>, overscanMm: number): number {
  if (overscanMm <= 0) return 0;
  const a = polyline[0];
  const b = polyline[1];
  if (a === undefined || b === undefined || polyline.length !== 2) return 0;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 0) return 0;
  return length < OVERSCAN_MIN_BURN_RATIO * overscanMm ? 0 : overscanMm;
}
