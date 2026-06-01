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
