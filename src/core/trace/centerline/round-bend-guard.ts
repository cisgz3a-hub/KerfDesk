// Centreline-only guard that keeps a rounded bend round.
//
// The sharpener rebuilds a bend as the corner its two straight legs point
// at. Where the stroke was drawn round a sharp corner, that corner is where
// the pen went: thinning cut inside it, and the rebuilt vertex sits on the
// pen's path with the stroke's full width of ink around it. Where the stroke
// was drawn round a curve, the chain already follows the pen, so the rebuilt
// vertex stands off the path toward the bend's outer edge, and the ink
// around it is thinner by about as much as it stands off.
// A thick stroke's gentle bend (a wave bottom, the shoulder of a letter) has
// legs straight enough and a turn concentrated enough to pass every shape
// gate, so this reads the ink instead of the shape.
//
// Only Centerline asks for it (keepRoundedBends): outlines are fitted by the
// contour tracer's own corner dial and never reach the sharpener.

import type { Vec2 } from '../../scene';
import { vertexOffset, type BendVertex } from './bend-geometry';
import { interpolatedRadius } from './distance-field';

// Chain length read on each leg, just outside the bend window, for the radius
// the stroke carries into the bend; the median ignores a stray pixel. It is
// read by arc length so the guard stays inside the stretch a ring scan cuts
// around its candidate: the widest arm (12 px) plus this is within the reach
// every gate is given (bendGateReachPx, 27 px).
const LEG_SAMPLE_PX = 12;
// The pixel-centre distance field reads a drawn corner's own apex up to
// ~0.6 px short of the legs' radius (measured on 3-4 px corners), so a
// shortfall this small never counts against a corner.
const INK_TOLERANCE_PX = 0.6;
// Half is where the choice breaks even. The ink a vertex lost says how far it
// stands off the pen's path; the rest of its offset is how far the chain
// does. A vertex that lost less than half its offset is the nearer of the
// two, so rebuilding it helps. Measured on 290 synthetic bends: where the
// rebuilt vertex was the nearer, it lost at most 0.21 of its offset (4-12 px
// strokes; 3 px ones stay under the tolerance above); where it was not, a
// median 0.54-0.86. A lower cut caught more curves in that set but also
// rounded the pointed tops of the capital A and N in a real logo.
const MAX_OUTWARD_SHARE = 0.5;
// A bend turning more than this is a letter's apex or a hairpin, where the
// ink thins toward the tip whatever the pen did, so the ink cannot tell a
// drawn point from a round one. Measured on the corpus waves and the arch
// house logo: the bends the guard should keep round turned 40 to 94 degrees,
// and the apexes of the logo's A and N, which it would have rounded, 138 to
// 147 degrees.
const MAX_ROUNDED_TURN_RAD = (120 * Math.PI) / 180;

/**
 * True when the corner rebuilt at `bend.vertex` from the legs
 * `pts[.. headEnd - 1]` and `pts[tailStart ..]` would stand outside a rounded
 * bend rather than on a drawn corner: the bend turns no more than 120 degrees,
 * and the ink at the vertex is thinner than the legs by more than the lattice
 * tolerance and by more than half the vertex's offset from the chain.
 */
export function bendIsRounded(
  pts: ReadonlyArray<Vec2>,
  headEnd: number,
  tailStart: number,
  bend: BendVertex,
  distSq: Float64Array,
  width: number,
): boolean {
  if (bend.turnRad > MAX_ROUNDED_TURN_RAD) return false;
  const { vertex } = bend;
  const legRadius = Math.min(
    medianLegRadius(pts, headEnd - 1, -1, distSq, width),
    medianLegRadius(pts, tailStart, 1, distSq, width),
  );
  const shortfall = legRadius - interpolatedRadius(distSq, width, vertex.x, vertex.y);
  const offset = vertexOffset(vertex, pts, headEnd, tailStart);
  return shortfall > Math.max(INK_TOLERANCE_PX, MAX_OUTWARD_SHARE * offset);
}

function medianLegRadius(
  pts: ReadonlyArray<Vec2>,
  start: number,
  step: -1 | 1,
  distSq: Float64Array,
  width: number,
): number {
  const radii: number[] = [];
  let travelled = 0;
  for (let k = start; k >= 0 && k < pts.length; k += step) {
    const p = pts[k] as Vec2;
    const previous = pts[k - step];
    if (k !== start && previous !== undefined) {
      travelled += Math.hypot(p.x - previous.x, p.y - previous.y);
      if (travelled > LEG_SAMPLE_PX) break;
    }
    radii.push(interpolatedRadius(distSq, width, p.x, p.y));
  }
  radii.sort((a, b) => a - b);
  return radii[Math.floor(radii.length / 2)] ?? 0;
}
