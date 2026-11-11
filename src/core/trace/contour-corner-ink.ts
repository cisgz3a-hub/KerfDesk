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
import { fieldLuma } from './contour-corner-field';
import type { Leg } from './contour-corner-leg-runs';
import type { CrackSubPixelField } from './saddle-connectivity';
import { maxOf, minOf } from '../util';

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
  const minX = minOf(bounds.map((p) => p.x));
  const maxX = maxOf(bounds.map((p) => p.x));
  const minY = minOf(bounds.map((p) => p.y));
  const maxY = maxOf(bounds.map((p) => p.y));
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

// ——— measured apexes (ADR-439 Amendment 2) ———
//
// A measured chain is the field's iso-line at the cut, which a box-filtered
// tip recedes from by 0.25 / tan(interior / 2) px, so the dial lets a measured
// apex stand off it by that much and more (contour-corner-legs.ts), and an
// acute apex past the tight allowance only on the field's word. The two legs
// of a thin blunt end (a serif's slab, about a pixel thick) converge by a few
// degrees and meet two to four pixels past it, where a wedge that thin covers
// too little of each pixel for the field test to refuse it: rolling audit v8
// N8-P2-4 measured Line Art nodes 1.7-1.9 px and Sharp nodes 2.6 px into
// paper on anti-aliased Tinos serifs, where Potrace drew none.
//
// The field at a true apex is not paper. The tip's last pixels each hold some
// of its ink, and the bilinear field at the apex interpolates them: about 3%
// of the paper-to-ink step for a 15 degree tip, more as the tip widens. So a
// measured leg apex where the field reads paper, darker than the local paper
// level by less than MIN_APEX_INK of the local step, is dropped and the loop
// rounds that turn. The levels are the brightest and darkest field pixels
// within LEVEL_REACH_PX of the apex and of the cracks it replaces, whose ink
// side lies within a pixel. Below MIN_LEVEL_CONTRAST the field cannot say,
// and the apex stays.
//
// JPEG ringing moves the field at such an apex by more than that 2% (rolling
// audit v9 R2-P2-4: anti-aliased Tinos M at 32 px after quality 75 drew a node
// 2.5 px from any ink), so the paper level is the window's own and an apex must
// also read below the paper's noise, PAPER_NOISE_MARGIN times its spread.
const MIN_APEX_INK = 0.02;
const PAPER_NOISE_MARGIN = 3;
const LEVEL_REACH_PX = 2;
const MIN_LEVEL_CONTRAST = 48;

/** True when the field reads paper at a measured corner's apex. */
export function apexStandsInPaper(
  field: CrackSubPixelField,
  cracks: ReadonlyArray<Vec2>,
  from: number,
  skip: number,
  apex: Vec2,
  scale: number,
): boolean {
  const n = cracks.length;
  const near = [apex];
  for (let k = 0; k <= skip + 1; k += 1) near.push(cracks[(from + k) % n] as Vec2);
  const reach = LEVEL_REACH_PX * scale;
  const x0 = Math.floor(minOf(near.map((p) => p.x)) - reach);
  const x1 = Math.ceil(maxOf(near.map((p) => p.x)) + reach);
  const y0 = Math.floor(minOf(near.map((p) => p.y)) - reach);
  const y1 = Math.ceil(maxOf(near.map((p) => p.y)) + reach);
  let brightest = -Infinity;
  let ink = Infinity;
  const levels: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const luma = field.lumaAt(x, y);
      levels.push(luma);
      brightest = Math.max(brightest, luma);
      ink = Math.min(ink, luma);
    }
  }
  const contrast = brightest - ink;
  if (!(contrast >= MIN_LEVEL_CONTRAST)) return false;
  const { level: paper, noise } = paperPlateau(levels, (brightest + ink) / 2);
  const margin = Math.max(MIN_APEX_INK * contrast, PAPER_NOISE_MARGIN * noise);
  return paper - fieldLuma(field, apex.x, apex.y) < margin;
}

// The median of the levels on the paper side of the middle, and their median
// distance from it. Clean paper is one level, so both read as they always did;
// a JPEG's ringing spreads it, and its brightest pixel is not the paper's level.
function paperPlateau(
  levels: ReadonlyArray<number>,
  middle: number,
): { readonly level: number; readonly noise: number } {
  const bright = levels.filter((level) => level > middle).sort((a, b) => a - b);
  const level = bright[bright.length >> 1] as number;
  const spread = bright.map((value) => Math.abs(value - level)).sort((a, b) => a - b);
  return { level, noise: spread[spread.length >> 1] as number };
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
