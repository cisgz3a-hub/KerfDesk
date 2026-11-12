// The speed a K40 (Lihuiyu) burn runs at, and the dose that leaves on the part
// (ADR-703 Amendment 2, C2 verification E2-P1-1 and E2-P1-2).
//
// A speed code takes fractional mm/s, but the board has a slowest speed: the
// code's value bottoms out at 0 (lhy-speed-code.ts), 0.39 mm/s (23.5 mm/min)
// on an M2 or M3 with suffix C. A slower layer runs at that speed, and its
// burns get less energy than set.
//
// On a Y-port rotary each burn's speed moves the part's surface at the layer
// speed (surfaceMatchedFeed, ADR-127 Amendment 2). Each new speed code
// re-enters program mode, which stops the head, so the matched speeds are
// grouped into classes 5 % apart from the layer speed, as the Ruida .rd
// route groups them (ADR-127 Amendment 5). Every burn then stays within
// 2.5 % of its dose, and strokes of similar direction share one code.

import {
  surfaceFeedDoseRise,
  surfaceMatchedFeed,
  type RotaryFeedMatch,
} from '../../output/rotary-surface-feed';
import { LHY_STEPS_PER_MM, type LhyPoint } from './lhy-motion-plan';
import { lhyEquation, type LihuiyuBoard } from './lhy-speed-code';

/** The ratio between neighbouring rotary speed classes. */
export const LHY_ROTARY_SPEED_CLASS_STEP = 1.05;

/** The slowest vector speed a board's code can set, in mm/s: the speed whose
 *  code value is 0 in the slowest acceleration band. */
export function lhySlowestMmPerSec(board: LihuiyuBoard, suffixC: boolean): number {
  const { b, m } = lhyEquation(board, 1, suffixC);
  const periodMs = (65536 - b) / m;
  return 25.4 / periodMs;
}

export type LhyBurnSpeed = {
  /** The speed the code sets, in mm/s. */
  readonly runsMmPerSec: number;
  /** The energy each mm gets, as a share of the set dose. */
  readonly dose: number;
};

/** A flat-bed burn at the layer speed, held at the board's slowest speed. */
export function lhyLayerBurnSpeed(layerMmPerMin: number, slowestMmPerSec: number): LhyBurnSpeed {
  const wanted = layerMmPerMin / 60;
  const runsMmPerSec = Math.max(wanted, slowestMmPerSec);
  return { runsMmPerSec, dose: wanted / runsMmPerSec };
}

/** A rotary burn from → to (board steps): the surface-matched speed in its
 *  class, held at the board's slowest speed. */
export function lhyRotaryBurnSpeed(
  layerMmPerMin: number,
  from: LhyPoint,
  to: LhyPoint,
  match: RotaryFeedMatch,
  slowestMmPerSec: number,
): LhyBurnSpeed {
  const a = mm(from);
  const b = mm(to);
  const held = surfaceMatchedFeed(layerMmPerMin, a, b, match) / 60;
  // The speed that would move the surface at the layer speed, before any hold.
  const wanted = held * surfaceFeedDoseRise(layerMmPerMin, a, b, match);
  const runsMmPerSec = Math.max(speedClass(held, layerMmPerMin / 60), slowestMmPerSec);
  return { runsMmPerSec, dose: wanted / runsMmPerSec };
}

/** The class nearest `mmPerSec`, counted from the layer speed, so a stroke
 *  along X (every image row) keeps the layer speed exactly. */
function speedClass(mmPerSec: number, layerMmPerSec: number): number {
  const step = Math.log(LHY_ROTARY_SPEED_CLASS_STEP);
  return layerMmPerSec * Math.exp(Math.round(Math.log(mmPerSec / layerMmPerSec) / step) * step);
}

function mm(point: LhyPoint): { readonly x: number; readonly y: number } {
  return { x: point.x / LHY_STEPS_PER_MM, y: point.y / LHY_STEPS_PER_MM };
}
