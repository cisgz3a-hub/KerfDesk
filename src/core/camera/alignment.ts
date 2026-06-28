import type { Vec2 } from '../scene';
import { solveHomography, type Mat3, type PointPair } from './homography';

/**
 * The 4-point manual alignment flow as a pure state machine. The operator
 * clicks each engraved bed target in the camera view; once all the points are
 * collected we solve the camera-pixel → bed-mm homography.
 *
 * Note on the y-axis: we pair the RAW clicked camera pixels (y-down) with the
 * bed-mm targets (y-up) and let the homography absorb the camera orientation —
 * an 8-DOF homography captures any flip/rotation, so no explicit y-flip is done
 * here. Matching the camera and bed y-conventions when RENDERING the warped
 * overlay is a separate concern handled by the overlay component.
 */
export type AlignmentState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'collecting';
      readonly targets: ReadonlyArray<Vec2>;
      readonly pixels: ReadonlyArray<Vec2>;
    }
  | { readonly kind: 'aligned'; readonly homography: Mat3 }
  | { readonly kind: 'failed'; readonly reason: 'need-four-points' | 'degenerate' };

/** Start collecting clicks against the given known bed-mm targets. */
export function beginAlignment(targets: ReadonlyArray<Vec2>): AlignmentState {
  return { kind: 'collecting', targets, pixels: [] };
}

/**
 * Record one clicked camera-pixel point. Stays 'collecting' until one point
 * per target is in, then solves and transitions to 'aligned' or 'failed'.
 * Returns the state unchanged when not currently collecting.
 */
export function addAlignmentPoint(state: AlignmentState, pixel: Vec2): AlignmentState {
  if (state.kind !== 'collecting') return state;
  const pixels = [...state.pixels, pixel];
  if (pixels.length < state.targets.length) {
    return { kind: 'collecting', targets: state.targets, pixels };
  }
  return solveCollected(state.targets, pixels);
}

function solveCollected(targets: ReadonlyArray<Vec2>, pixels: ReadonlyArray<Vec2>): AlignmentState {
  const pairs: PointPair[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const src = pixels[i];
    const dst = targets[i];
    if (src === undefined || dst === undefined) {
      return { kind: 'failed', reason: 'need-four-points' };
    }
    pairs.push({ src, dst });
  }
  const result = solveHomography(pairs);
  return result.ok
    ? { kind: 'aligned', homography: result.matrix }
    : { kind: 'failed', reason: result.reason };
}
