// viewer3d-reveal — arc-length bookkeeping for revealing the toolpath.
//
// Scrubbing must not rebuild geometry. LineSegmentsGeometry is an
// InstancedBufferGeometry, so capping `instanceCount` hides the tail of a batch
// for free — no buffer upload, no allocation, no shader recompile. All this
// module does is answer "how many segments of this batch has the tool passed?"
//
// The count is per BATCH, and a batch is one move kind. Segments enter a batch
// in program order (buildToolpathLines walks moves in order and appends only
// that kind's), so each batch's arc-length list is non-decreasing and a binary
// search is valid. That property is asserted in the tests, not assumed.
//
// PURE: numbers in, numbers out. No three import.

import type { Move3d, Move3dKind } from '../../core/toolpath3d';

/**
 * Arc-length position of each segment's END, in the order the segments are
 * emitted into that kind's batch.
 *
 * Within a move the position is interpolated by CHORD fraction against the
 * move's own `lengthMm`, because on arcs and helices the declared length
 * deliberately exceeds the sampled chord sum.
 *
 * @param moves 3D moves in program order.
 * @param kind The move kind whose batch is being measured.
 * @returns One arc-length value per segment, non-decreasing.
 */
export function segmentEndsMm(moves: ReadonlyArray<Move3d>, kind: Move3dKind): number[] {
  const ends: number[] = [];
  for (const move of moves) {
    if (move.kind !== kind) continue;
    const chords = chordLengths(move);
    const total = chords.reduce((sum, value) => sum + value, 0);
    let walked = 0;
    for (const chord of chords) {
      walked += chord;
      const fraction = total === 0 ? 1 : walked / total;
      ends.push(move.startMm + move.lengthMm * fraction);
    }
  }
  return ends;
}

/**
 * How many segments of a batch the tool has fully passed.
 *
 * @param endsMm Non-decreasing segment end positions, from segmentEndsMm.
 * @param atMm Arc-length position of the tool, in mm from the job start.
 * @returns The instance count to draw; 0 hides the batch entirely.
 */
export function revealedSegmentCount(endsMm: ReadonlyArray<number>, atMm: number): number {
  let low = 0;
  let high = endsMm.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    // Non-null assertions are banned outside tests, so read defensively. `mid`
    // is always in range; treating a hole as "already passed" keeps the search
    // total rather than letting it diverge.
    if ((endsMm[mid] ?? Number.NEGATIVE_INFINITY) <= atMm) low = mid + 1;
    else high = mid;
  }
  return low;
}

function chordLengths(move: Move3d): number[] {
  const lengths: number[] = [];
  for (let index = 1; index < move.points.length; index += 1) {
    const from = move.points[index - 1];
    const to = move.points[index];
    if (from === undefined || to === undefined) continue;
    lengths.push(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z));
  }
  return lengths;
}
