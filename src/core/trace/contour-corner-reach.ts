// Binary leg apexes on a short leg are held to the chain's reach (ADR-439
// Amendment 4).
//
// A binary leg apex that leaves no pixel centre on the wrong side
// (contour-corner-ink.ts) can still stand well off the true outline. Where a
// narrow stroke ends in a flat cut a pixel or two wide (a foot, a serif's end,
// the flat top of a W's middle peak), the corner's two legs converge and meet
// two to four pixels past the cut, and the needle between them threads
// between rows of paper centres. A true acute tip, its pixels sampled the
// same way, stands as far past its last ink: pixel centres cannot tell the two
// apart. On 72 glyph images Line Art drew 11 such nodes 1 to 2 px off the
// outline, Sharp 5; Potrace 1.16 drew none.
//
// What separates them is how far the apex is extrapolated from how much leg.
// A true corner whose shorter leg is under SHORT_LEG_CRACKS cracks stood at
// most 1.07 px past the chain (true acute tips have long legs on both sides:
// 11 cracks or more), while every such needle stood 1.14 to 2.65 px past it
// on a leg of 5 to 8 cracks: the short leg is the cut itself, or a serif's
// face, and its direction comes from a run too short to place a tip that far.
// So an apex further than SHORT_LEG_STANDOFF_PX past the chain from a leg that
// short keeps its corner, but on the longer leg, the better-determined line,
// at the farthest point the chain's own cracks reach along it. Beyond that
// point only the short leg's direction claims ink. The loop keeps its sharp
// turn where the pixels end; withdrawing the corner instead let the binary
// tail round the end of a thin bar and tilt its long side (a 3 px bar's area
// error rose from 0.8% to 18.6% on Smooth).

import type { Vec2 } from '../scene';
import type { Leg } from './contour-corner-leg-runs';
import { distanceToGap } from './contour-corner-legs';

const SHORT_LEG_CRACKS = 10;
const SHORT_LEG_STANDOFF_PX = 1.1;

/** The corner a reach bound reads: its crack span, its leg extents in cracks
 *  and its apex. */
export type ReachCorner = {
  readonly from: number;
  readonly skip: number;
  readonly legBack: number;
  readonly legAhead: number;
  readonly apex: Vec2;
};

/** The apex held to the chain's reach along its longer leg when its shorter
 *  leg is too short to place it as far past the chain as it stands; otherwise
 *  the apex itself (the same object). `legs` are the lines the apex lies on. */
export function apexWithinChainReach(
  cracks: ReadonlyArray<Vec2>,
  corner: ReachCorner,
  legs: { readonly back: Leg; readonly ahead: Leg },
  scale: number,
): Vec2 {
  const { from, skip, legBack, legAhead, apex } = corner;
  if (Math.min(legBack, legAhead) >= SHORT_LEG_CRACKS * scale) return apex;
  if (distanceToGap(cracks, from, skip, apex) <= SHORT_LEG_STANDOFF_PX * scale) return apex;
  const n = cracks.length;
  const alongBack = legBack >= legAhead;
  const leg = alongBack ? legs.back : legs.ahead;
  // Unit direction from the apex into the longer leg (the back leg runs
  // toward the apex, the ahead leg away from it).
  const ux = alongBack ? -leg.dx : leg.dx;
  const uy = alongBack ? -leg.dy : leg.dy;
  // The longer leg's last crack, the skipped cracks and the shorter leg's
  // cracks: how close to the apex the chain comes along the longer leg.
  const first = alongBack ? from : from - legBack + 1;
  const last = alongBack ? from + skip + legAhead : from + skip + 1;
  let reach = Infinity;
  for (let i = first; i <= last; i += 1) {
    const p = cracks[((i % n) + n) % n] as Vec2;
    reach = Math.min(reach, (p.x - apex.x) * ux + (p.y - apex.y) * uy);
  }
  if (!(reach > 0)) return apex;
  // From the apex's foot on the longer leg's line, so the new apex lies on it.
  const foot = (apex.x - leg.cx) * leg.dx + (apex.y - leg.cy) * leg.dy;
  const sign = alongBack ? -1 : 1;
  const t = foot + sign * reach;
  return { x: leg.cx + t * leg.dx, y: leg.cy + t * leg.dy };
}
