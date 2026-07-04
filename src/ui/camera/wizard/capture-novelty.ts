// Auto-capture novelty gate (ADR-108 wizard). A new detection is worth
// capturing only when the board has actually MOVED versus every capture
// already taken — repeated near-identical shots add nothing and trap the
// solver in the focal/depth ambiguity (the pose-diversity finding). Pure
// geometry on detected corners; co-located test.

import type { Vec2 } from '../../../core/scene';

// Mean corner displacement (as a fraction of the frame diagonal) below which
// two detections count as the same pose. ~8% ≈ a clear hand movement of the
// board, well above detection jitter.
const MIN_MEAN_SHIFT_FRACTION = 0.08;

/** Mean per-corner distance between two equally-sized detections, in px. */
export function meanCornerShiftPx(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i];
    const pb = b[i];
    if (pa === undefined || pb === undefined) return null;
    sum += Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }
  return sum / a.length;
}

/**
 * True when `corners` is a genuinely new pose versus every prior capture's
 * image points: mean shift of at least ~8% of the frame diagonal from each.
 */
export function isNovelPose(
  corners: ReadonlyArray<Vec2>,
  priorCaptures: ReadonlyArray<ReadonlyArray<Vec2 | null>>,
  frameWidth: number,
  frameHeight: number,
): boolean {
  const minShift = MIN_MEAN_SHIFT_FRACTION * Math.hypot(frameWidth, frameHeight);
  for (const prior of priorCaptures) {
    const priorCorners = prior.filter((p): p is Vec2 => p !== null);
    const shift = meanCornerShiftPx(corners, priorCorners);
    // Mismatched lengths mean a different detection geometry; treat as novel
    // relative to that capture rather than blocking auto-capture forever.
    if (shift !== null && shift < minShift) return false;
  }
  return true;
}
