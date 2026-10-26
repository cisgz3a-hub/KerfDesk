import type { Polyline } from '../scene';
import type { AdaptivePocketSequence } from './adaptive-pocket-sequences';
import {
  buildVCarveSourceRegionLayout,
  vcarveSourceRegionRankFromLayout,
} from './vcarve-region-order';

/**
 * Put the sequences in the order the program cuts them: one source region
 * after another (ADR-270), each region's sequences in planned order. An island
 * plan's cleanup rings join the last sequence of their own region, so each one
 * runs only once all the clearing beside it is done. The verifier certifies
 * this order and the emitter cuts it as it stands (ADR-154 Amendment 4); the
 * emitter used to sort after verification, and an island plan's cleanup,
 * joined to the last planned sequence, then slotted a nested or second pocket's
 * wall before clearing it (CNC audit v1 F2-P2-1).
 */
export function orderAdaptivePocketSequences(
  sourceContours: ReadonlyArray<Polyline>,
  sequences: ReadonlyArray<AdaptivePocketSequence>,
  cleanupRings: ReadonlyArray<Polyline> = [],
): ReadonlyArray<AdaptivePocketSequence> {
  const layout = buildVCarveSourceRegionLayout(sourceContours);
  const ranked = sequences
    .map((sequence, sourceIndex) => ({
      sequence,
      sourceIndex,
      rank: vcarveSourceRegionRankFromLayout(sequence.entryCenter, layout),
    }))
    .sort((a, b) => a.rank - b.rank || a.sourceIndex - b.sourceIndex);
  const ordered = ranked.map(({ sequence }) => sequence);
  for (const ring of cleanupRings) {
    const rank = vcarveSourceRegionRankFromLayout(ring.points[0], layout);
    // A ring whose region no sequence matched runs after everything.
    let index = ordered.length - 1;
    while (index > 0 && ranked[index]?.rank !== rank) index -= 1;
    if (ranked[index]?.rank !== rank) index = ordered.length - 1;
    const host = ordered[index];
    if (host !== undefined) ordered[index] = { ...host, finishRings: [...host.finishRings, ring] };
  }
  return ordered;
}
