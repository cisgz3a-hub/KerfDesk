// collapseTinySegments — drop consecutive vertices spaced closer than a minimum
// so degenerate near-coincident points never reach the G-code emitter.
//
// Why this exists: the kerf offset (Clipper miter, run at the emitter's 1µm
// precision) emits near-coincident vertex PAIRS at near-collinear input
// vertices. Rounded to the emitter's 3-decimal (1µm) grid, those become ±1µm
// back-and-forth "needle" segments with ~180° reversals that a controller
// stutters through (field report: a traced part offset profile-outside emitted
// ~14% of its moves as sub-micron needles). A router with a finite step
// resolution (~10-50µm) cannot position a sub-micron feature anyway, so
// collapsing them is loss-free.

import type { Polyline, Vec2 } from '../scene';

// Minimum kept segment length on an offset ring, in mm. Well above the 1µm emit
// grid (so it catches the rounding needles) and well below both machine step
// resolution and any feature a real cutter can make, so no cuttable geometry is
// lost.
export const MIN_OFFSET_SEGMENT_MM = 0.005;

const MIN_CLOSED_POINTS = 3;
const MIN_OPEN_POINTS = 2;

function farEnough(a: Vec2, b: Vec2, minSq: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy >= minSq;
}

/**
 * Remove consecutive vertices closer than `minSegmentMm`. For a closed ring the
 * result stays closed (last vertex repeats the first) and the closure seam is
 * de-needled too. A ring that would collapse below a triangle — or an open path
 * below two points — is returned unchanged rather than destroyed.
 */
export function collapseTinySegments(polyline: Polyline, minSegmentMm: number): Polyline {
  const minSq = minSegmentMm * minSegmentMm;
  const src = polyline.points;
  if (src.length < MIN_OPEN_POINTS) return polyline;

  // Drop an exact repeated closing vertex so the seam is handled once, not twice.
  const first = src[0] as Vec2;
  const last = src[src.length - 1] as Vec2;
  const openRing = first.x === last.x && first.y === last.y ? src.slice(0, -1) : src;

  const kept: Vec2[] = [];
  for (const point of openRing) {
    const prev = kept[kept.length - 1];
    if (prev === undefined || farEnough(prev, point, minSq)) kept.push(point);
  }

  if (polyline.closed) {
    // Collapse a tiny seam segment between the last kept vertex and the first.
    while (
      kept.length > MIN_CLOSED_POINTS &&
      !farEnough(kept[kept.length - 1] as Vec2, kept[0] as Vec2, minSq)
    ) {
      kept.pop();
    }
    if (kept.length < MIN_CLOSED_POINTS) return polyline;
    return { closed: true, points: [...kept, kept[0] as Vec2] };
  }

  if (kept.length < MIN_OPEN_POINTS) return polyline;
  return { closed: false, points: kept };
}
