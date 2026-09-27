import type { Vec2 } from '../scene';
import type { FillOverscanRun } from './fill-overscan';

export type FillRunwayLengths = {
  readonly leadInMm: number;
  readonly leadOutMm: number;
  /** Canonical meeting point shared with the adjacent sweep, when present. */
  readonly sharedLeadStart?: Vec2;
  readonly sharedLeadEnd?: Vec2;
};

export function expandFillHatchWithRunways(
  polyline: ReadonlyArray<Vec2>,
  lengths: FillRunwayLengths,
): FillOverscanRun | null {
  const burnStart = polyline[0];
  const burnEnd = polyline[1];
  if (burnStart === undefined || burnEnd === undefined || polyline.length !== 2) return null;

  const dx = burnEnd.x - burnStart.x;
  const dy = burnEnd.y - burnStart.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;

  const leadInMm = Math.max(0, lengths.leadInMm);
  const leadOutMm = Math.max(0, lengths.leadOutMm);
  const ux = dx / length;
  const uy = dy / length;
  return {
    leadStart: lengths.sharedLeadStart ?? {
      x: burnStart.x - ux * leadInMm,
      y: burnStart.y - uy * leadInMm,
    },
    burnStart,
    burnEnd,
    leadEnd: lengths.sharedLeadEnd ?? {
      x: burnEnd.x + ux * leadOutMm,
      y: burnEnd.y + uy * leadOutMm,
    },
  };
}
