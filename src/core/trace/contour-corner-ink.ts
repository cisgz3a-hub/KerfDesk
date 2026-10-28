// Binary leg apexes bounded by the ink (ADR-439 Amendment 1).
//
// A binary crack chain is the mid-crack staircase: it says on which side of
// every crack the ink lies, not where a corner's tip lies beyond it. The dial
// extrapolates that tip from the corner's two straight legs, up to
// (0.9 + 0.5 / sin(interior / 2)) px off the chain, and on a short or curved
// leg (a serif, a slanted terminal, the join of a bowl) the extrapolation
// overshoots: quality audit Q4-P2-2 measured Line Art nodes 1 to 3.4 px off
// the true outline on 8 of 15 glyph images, where Potrace drew none.
//
// The pixels bound a tip the way they bound any outline. Pixel-centre
// sampling puts every ink centre inside the drawn shape and every paper
// centre outside it, so the region a convex corner adds may hold no paper
// centre, and the region a reflex corner removes no ink centre. A true acute
// tip passes however far it stands off the ink, because its wedge holds only
// paper the sampling never saw; an overshoot fails as soon as it covers a
// centre. The region lies between the cracks the corner replaces and the
// apex. The outline reaches the apex along the leg lines or, where the fit
// cuts across, along the chords from those cracks, so both count. A leg
// fitted to a staircase locates its edge only to about LEG_FIT_SLACK_PX: the
// correct corners a slack-free test refused (rotated squares, triangle tips)
// claimed centres 0.03 to 0.09 px outside the true edge.

import type { Vec2 } from '../scene';
import type { Leg } from './contour-corner-leg-runs';

const LEG_FIT_SLACK_PX = 0.1;

/** True when the corner's apex would change the class of a source pixel
 *  centre. `inkAt` reads the mask at a working pixel. */
export function apexContradictsInk(
  cracks: ReadonlyArray<Vec2>,
  from: number,
  skip: number,
  apex: Vec2,
  legs: { readonly back: Leg; readonly ahead: Leg },
  scale: number,
  inkAt: (x: number, y: number) => boolean,
): boolean {
  const n = cracks.length;
  const gap: Vec2[] = [];
  for (let k = 0; k <= skip + 1; k += 1) gap.push(cracks[(from + k) % n] as Vec2);
  const before = gap[0] as Vec2;
  const after = gap[gap.length - 1] as Vec2;
  // Ink lies right of travel; an apex on the ink side is a reflex corner.
  const claimsInk =
    (apex.x - before.x) * (after.y - before.y) - (apex.y - before.y) * (after.x - before.x) < 0;
  const chords = [...gap, apex];
  const legTriangle = [apex, footOn(legs.ahead, after), footOn(legs.back, before)];
  const slack = LEG_FIT_SLACK_PX * scale;
  const bounds = [...chords, ...legTriangle];
  const minX = Math.min(...bounds.map((p) => p.x));
  const maxX = Math.max(...bounds.map((p) => p.x));
  const minY = Math.min(...bounds.map((p) => p.y));
  const maxY = Math.max(...bounds.map((p) => p.y));
  // SOURCE pixel centres; on a supersampled mask the working pixel under each.
  for (let y = (Math.ceil(minY / scale - 0.5) + 0.5) * scale; y < maxY; y += scale) {
    for (let x = (Math.ceil(minX / scale - 0.5) + 0.5) * scale; x < maxX; x += scale) {
      if (inkAt(Math.floor(x), Math.floor(y)) !== claimsInk) continue;
      if (!insidePolygon(chords, x, y) && !insidePolygon(legTriangle, x, y)) continue;
      if (lineDistance(legs.back, x, y) < slack || lineDistance(legs.ahead, x, y) < slack) continue;
      return true;
    }
  }
  return false;
}

function footOn(leg: Leg, p: Vec2): Vec2 {
  const t = (p.x - leg.cx) * leg.dx + (p.y - leg.cy) * leg.dy;
  return { x: leg.cx + t * leg.dx, y: leg.cy + t * leg.dy };
}

function lineDistance(leg: Leg, x: number, y: number): number {
  return Math.abs((x - leg.cx) * leg.dy - (y - leg.cy) * leg.dx);
}

// Even-odd point in polygon.
function insidePolygon(ring: ReadonlyArray<Vec2>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const p = ring[i] as Vec2;
    const q = ring[j] as Vec2;
    if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
  }
  return inside;
}
