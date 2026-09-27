// Recentre a width-carrying Line + fill stroke on its ink (ADR-454). The
// Centerline lane's skeleton runs through pixel centres, so an even-width
// line's centre line sits half a pixel off the true centre. A hairline never
// showed that; a round-pen outline of the stroke's width burns it as a
// quarter-width error. Each cross-section of the width measurement already
// knows how far the ink's true centre lies along its normal; every vertex and
// control point moves by the local median of those offsets.

import type { CurveSubpath, PathSegment, Polyline, Vec2 } from '../../scene';
import { registerTraceCurve } from '../trace-curves';
import type { CrossSection } from './stroke-width';

// Offsets are smoothed over the cross-sections within this distance (px).
const SMOOTH_RADIUS_PX = 3;
// No stroke moves further than this (px): the bias is at most half a pixel
// plus the fit's drift, and a larger offset is another line's ink.
const MAX_SHIFT_PX = 1;

type Recentrable = { readonly curve: CurveSubpath; readonly polyline: Polyline };

export function recentredStroke<T extends Recentrable>(
  stroke: T,
  sections: ReadonlyArray<CrossSection>,
): T {
  if (sections.length === 0) return stroke;
  const smoothed = sections.map((section) => smoothedOffset(section, sections));
  const shift = (v: Vec2): Vec2 => {
    let best = 0;
    let bestD = Infinity;
    sections.forEach((s, i) => {
      const d = (s.p.x - v.x) ** 2 + (s.p.y - v.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const section = sections[best];
    const offset = smoothed[best] ?? 0;
    if (section === undefined) return v;
    return { x: v.x + section.normal.x * offset, y: v.y + section.normal.y * offset };
  };
  const points = stroke.polyline.points.map(shift);
  const curve: CurveSubpath = {
    ...stroke.curve,
    start: shift(stroke.curve.start),
    segments: stroke.curve.segments.map((segment) => shiftSegment(segment, shift)),
  };
  registerTraceCurve(points, curve);
  return { ...stroke, curve, polyline: { ...stroke.polyline, points } };
}

function smoothedOffset(section: CrossSection, sections: ReadonlyArray<CrossSection>): number {
  const r2 = SMOOTH_RADIUS_PX * SMOOTH_RADIUS_PX;
  const near = sections
    .filter((s) => (s.p.x - section.p.x) ** 2 + (s.p.y - section.p.y) ** 2 <= r2)
    // A neighbour whose normal points the other way (a hairpin's far side)
    // measures the offset with the opposite sign.
    .map((s) =>
      s.normal.x * section.normal.x + s.normal.y * section.normal.y >= 0 ? s.offsetPx : -s.offsetPx,
    )
    .sort((a, b) => a - b);
  const median = near[Math.floor(near.length / 2)] ?? 0;
  return Math.max(-MAX_SHIFT_PX, Math.min(MAX_SHIFT_PX, median));
}

function shiftSegment(segment: PathSegment, shift: (v: Vec2) => Vec2): PathSegment {
  if (segment.kind === 'cubic') {
    return {
      ...segment,
      control1: shift(segment.control1),
      control2: shift(segment.control2),
      to: shift(segment.to),
    };
  }
  return { ...segment, to: shift(segment.to) };
}
