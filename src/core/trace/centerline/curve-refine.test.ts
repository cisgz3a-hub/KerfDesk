// Corner-vs-fillet pinning at the spline-break decision. Potrace's published
// corner criterion pairs a sharp angle with STRAIGHT legs; a hard turn whose
// neighbour keeps turning the same direction is a drawn fillet that
// Douglas-Peucker collapsed to one vertex — pinning it renders a rounded
// terminal as an angular beak (Arch House "still some sharp corners").

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { refineChainForOutput } from './curve-refine';

function turnDegAt(points: ReadonlyArray<Vec2>, target: Vec2): number {
  const i = points.findIndex((p) => Math.hypot(p.x - target.x, p.y - target.y) < 1e-6);
  if (i <= 0 || i >= points.length - 1) return 0;
  const prev = points[i - 1]!;
  const at = points[i]!;
  const next = points[i + 1]!;
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  const dot =
    ((at.x - prev.x) / inLen) * ((next.x - at.x) / outLen) +
    ((at.y - prev.y) / inLen) * ((next.y - at.y) / outLen);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

// Walk a heading sequence into points (segment length 6px — well above the
// near-point epsilon, comparable to post-DP spacing on glyphs).
function chainFromHeadings(headingsDeg: number[]): Vec2[] {
  const points: Vec2[] = [{ x: 0, y: 0 }];
  let heading = 0;
  for (const turn of headingsDeg) {
    heading += (turn * Math.PI) / 180;
    const last = points[points.length - 1]!;
    points.push({ x: last.x + 6 * Math.cos(heading), y: last.y + 6 * Math.sin(heading) });
  }
  return points;
}

describe('refineChainForOutput corner pinning', () => {
  it('keeps a genuine corner (hard turn between straight legs) exact', () => {
    // straight, straight, +70° corner, straight, straight
    const points = chainFromHeadings([0, 0, 70, 0, 0]);
    const corner = points[2]!;
    const refined = refineChainForOutput(points, false);
    expect(turnDegAt(refined, corner)).toBeGreaterThanOrEqual(55);
  });

  it('lets the spline round a collapsed fillet (hard turn with a turning neighbour)', () => {
    // straight, +65° then +30° same direction = fillet remnant, then straight
    const points = chainFromHeadings([0, 0, 65, 30, 0, 0]);
    const fillet = points[2]!;
    const refined = refineChainForOutput(points, false);
    expect(turnDegAt(refined, fillet)).toBeLessThan(55);
  });

  it('lets a needle-sharp turn with a clearly curving flank smooth (rounded hook tips)', () => {
    // The Arch House A-apex class: a drawn hook whose rounded tip collapses
    // to one ~120-150° vertex. Unmarked + curving flank = rounding, not a
    // corner; genuine needle tips carry sharpener ink evidence and arrive
    // via drawnCorners instead.
    const points = chainFromHeadings([0, 0, 120, 35, 0, 0]);
    const tip = points[2]!;
    const refined = refineChainForOutput(points, false);
    expect(turnDegAt(refined, tip)).toBeLessThan(100);
  });

  it('pins an unmarked needle-sharp turn between straight flanks', () => {
    const points = chainFromHeadings([0, 0, 120, 0, 0, 0]);
    const tip = points[2]!;
    const refined = refineChainForOutput(points, false);
    expect(turnDegAt(refined, tip)).toBeGreaterThanOrEqual(100);
  });

  it('requires stronger flank curvature to unpin a needle-sharp turn than a moderate one', () => {
    // 25° flank turn unpins a 65° candidate but NOT a 120° one — the
    // sharper the turn, the more evidence needed to call it a rounding.
    const points = chainFromHeadings([0, 0, 120, 25, 0, 0]);
    const tip = points[2]!;
    const refined = refineChainForOutput(points, false);
    expect(turnDegAt(refined, tip)).toBeGreaterThanOrEqual(100);
  });

  it('keeps tiny-glyph apexes pinned (continuation legs below geometry scale)', () => {
    // Same turning-neighbour shape but at ~1.5px segments: at small-glyph
    // scale every neighbour "turns" from quantization, so continuation
    // evidence must not fire (the small-glyph fidelity instrument's case).
    const points = chainFromHeadings([0, 0, 120, 35, 0, 0]).map((p) => ({
      x: p.x / 4,
      y: p.y / 4,
    }));
    const tip = points[2]!;
    const refined = refineChainForOutput(points, false);
    expect(turnDegAt(refined, tip)).toBeGreaterThanOrEqual(100);
  });

  it('still pins sharpener-marked drawn corners regardless of neighbours', () => {
    const points = chainFromHeadings([0, 0, 65, 30, 0, 0]);
    const marked = points[2]!;
    const refined = refineChainForOutput(points, false, new Set([marked]));
    expect(turnDegAt(refined, marked)).toBeGreaterThanOrEqual(55);
  });
});
