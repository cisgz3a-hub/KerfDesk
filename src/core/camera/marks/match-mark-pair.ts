// Which two found marks are the design's two Print and Cut targets (ADR-443).
// A printer scales a sheet by a fraction of a percent at most, so the two
// marks sit almost exactly as far apart on the bed as the targets do in the
// design: every pair of found marks within that spacing is a candidate, and
// among them the pair lying closest to where the design puts its targets
// wins. That also picks which mark is target 1, since the same pair taken the
// other way round lies half a turn off. Pure core.

import type { FoundMark, Point } from './find-marks';

export type MarkPair = {
  readonly first: FoundMark;
  readonly second: FoundMark;
  /** Measured spacing over the design's spacing. */
  readonly scale: number;
  /** Turn from the design's target line to the marks' line, degrees, y down. */
  readonly rotationDeg: number;
  /** How far the found marks lie from the design's targets on average, mm. */
  readonly offsetMm: number;
  /** Other pairs that also fit the spacing. */
  readonly otherPairs: number;
};

export type MarkPairResult =
  | { readonly kind: 'found'; readonly pair: MarkPair }
  | { readonly kind: 'none'; readonly marksFound: number };

/** Spacing may differ from the design's by this share, as print scaling does. */
export const MAX_SCALE_ERROR = 0.02;

export function matchMarkPair(
  targets: readonly [Point, Point],
  marks: ReadonlyArray<FoundMark>,
): MarkPairResult {
  const [t1, t2] = targets;
  const designed = Math.hypot(t2.x - t1.x, t2.y - t1.y);
  if (!(designed > 0)) return { kind: 'none', marksFound: marks.length };
  const candidates: MarkPair[] = [];
  for (const first of marks) {
    for (const second of marks) {
      if (first === second) continue;
      const dx = second.centre.x - first.centre.x;
      const dy = second.centre.y - first.centre.y;
      const scale = Math.hypot(dx, dy) / designed;
      if (Math.abs(scale - 1) > MAX_SCALE_ERROR) continue;
      const turn = Math.atan2(dy, dx) - Math.atan2(t2.y - t1.y, t2.x - t1.x);
      candidates.push({
        first,
        second,
        scale,
        rotationDeg: wrapped((turn * 180) / Math.PI),
        offsetMm:
          (Math.hypot(first.centre.x - t1.x, first.centre.y - t1.y) +
            Math.hypot(second.centre.x - t2.x, second.centre.y - t2.y)) /
          2,
        otherPairs: 0,
      });
    }
  }
  if (candidates.length === 0) return { kind: 'none', marksFound: marks.length };
  const best = candidates.reduce((a, b) => (b.offsetMm < a.offsetMm ? b : a));
  // Each unordered pair appears twice (both ways round); count the others once.
  return { kind: 'found', pair: { ...best, otherPairs: candidates.length / 2 - 1 } };
}

/** `deg` folded into (-180, 180]. */
function wrapped(deg: number): number {
  let folded = deg % 360;
  if (folded > 180) folded -= 360;
  if (folded <= -180) folded += 360;
  return folded;
}
