// Cumulative step lengths for arc-length lookup, memoized on the steps array's
// identity (PRF, extending ADR-050's caching; same pattern as
// core/job/raster-luma-decode.ts).
//
// sliceToolpath runs once per animation frame while the preview scrubber plays,
// and it found the cut by walking and summing every step ahead of it — O(n) per
// frame, which a million-step worker route cannot absorb at 60 fps. The prefix
// sums depend only on the step lengths, steps are immutable, and a rebuild
// produces a new array, so array identity is a sound key: a real edit replaces
// the array and misses naturally. Identity-keyed and GC-bounded.

import { packedStepLength } from './packed-toolpath';
import { packedToolpathOf } from './packed-toolpath-steps';
import type { ToolpathStepList } from './toolpath-steps';

const cumulativeLengthCache = new WeakMap<ToolpathStepList, Float64Array>();

/** Running sum of step lengths: entry i is the arc length at the END of step i. */
export function toolpathCumulativeLengths(steps: ToolpathStepList): Float64Array {
  const cached = cumulativeLengthCache.get(steps);
  if (cached !== undefined) return cached;
  const cumulative = new Float64Array(steps.length);
  const packed = packedToolpathOf(steps);
  let total = 0;
  for (let index = 0; index < steps.length; index += 1) {
    total += packed === null ? (steps.at(index)?.length ?? 0) : packedStepLength(packed, index);
    cumulative[index] = total;
  }
  cumulativeLengthCache.set(steps, cumulative);
  return cumulative;
}

/**
 * Index of the first step ending strictly beyond `length` — the step the cut
 * lands inside. Returns `cumulative.length` when the cut is at or past the end.
 */
export function stepIndexAtLength(cumulative: Float64Array, length: number): number {
  let low = 0;
  let high = cumulative.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const end = cumulative[mid];
    if (end !== undefined && end > length) high = mid;
    else low = mid + 1;
  }
  return low;
}
