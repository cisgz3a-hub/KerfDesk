import { describe, expect, it } from 'vitest';
import { contourSegments, segmentPoint, segmentStart } from '../../geometry/trim-curve-split';
import type { CurveSubpath } from '../../scene';
import { createPolygon } from './create-polygon';
import { createStar } from './create-star';
import { starToPolylines } from './star';

function midpoints(curve: CurveSubpath) {
  const contour = contourSegments(curve, true);
  return contour.segments.map((segment, index) =>
    segmentPoint(segmentStart(contour, index), segment, 0.5),
  );
}

describe('bulged polygons and stars', () => {
  it('bows a square outward into half circles and inward by the same sagitta', () => {
    const r = 10;
    const apothem = r * Math.cos(Math.PI / 4);
    const side = 2 * r * Math.sin(Math.PI / 4);
    const out = createPolygon({
      id: 'p',
      color: '#000',
      spec: { sides: 4, radiusMm: r, bulge: 1 },
    });
    for (const mid of midpoints(out.paths[0]?.curves?.[0] as CurveSubpath)) {
      expect(Math.hypot(mid.x - r, mid.y - r)).toBeCloseTo(apothem + side / 2, 6);
    }
    const inward = createPolygon({
      id: 'q',
      color: '#000',
      spec: { sides: 4, radiusMm: r, bulge: -0.5 },
    });
    for (const mid of midpoints(inward.paths[0]?.curves?.[0] as CurveSubpath)) {
      expect(Math.hypot(mid.x - r, mid.y - r)).toBeCloseTo(apothem - side / 4, 6);
    }
    // Bounds follow the arcs, not the vertices: the square stands on a corner,
    // so each half circle's centre sits apothem x cos 45 deg off-centre in x.
    expect(out.bounds.maxX - out.bounds.minX).toBeCloseTo(
      2 * (apothem * Math.SQRT1_2 + side / 2),
      6,
    );
    const straight = createPolygon({ id: 's', color: '#000', spec: { sides: 4, radiusMm: r } });
    expect(straight.paths[0]?.curves?.[0]?.segments.every((s) => s.kind === 'line')).toBe(true);
  });

  it('alternates the star tips between the outer radius and the second radius', () => {
    const [polyline] = starToPolylines({
      points: 6,
      outerRadiusMm: 10,
      innerRadiusRatio: 0.3,
      alternateRadiusRatio: 0.6,
    });
    const tips = (polyline?.points ?? []).filter((_, index) => index % 2 === 0).slice(0, 6);
    const radii = tips.map((point) => Math.hypot(point.x - 10, point.y - 10));
    radii.forEach((radius, index) => expect(radius).toBeCloseTo(index % 2 === 0 ? 10 : 6, 9));
    const star = createStar({
      id: 'st',
      color: '#000',
      spec: { points: 5, outerRadiusMm: 10, innerRadiusRatio: 0.5, bulge: 0.3 },
    });
    expect(star.paths[0]?.curves?.[0]?.segments.every((s) => s.kind === 'elliptical-arc')).toBe(
      true,
    );
  });
});
