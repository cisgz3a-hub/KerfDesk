import { describe, expect, it, vi } from 'vitest';
import * as segmentContainment from '../geometry/segment-contained-in-polygon';
import { DEFAULT_CNC_LAYER_SETTINGS, type Polyline, type Vec2 } from '../scene';
import { helicalPocketPassesBySourceRegion } from './cnc-helical-pocket-passes';
import { planHelicalPocketPasses } from './helical-entry';
import { pocketToolpathRings } from './pocket-paths';

const helix = { minDiameterMm: 1, maxDiameterMm: 2, angleDeg: 5 };
const concave: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 24 },
    { x: 30, y: 24 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
  ],
};

function mapped(polyline: Polyline, map: (point: Vec2) => Vec2): Polyline {
  return { ...polyline, points: polyline.points.map(map) };
}

const transforms = [
  { name: 'original', map: (p: Vec2): Vec2 => p },
  { name: 'rotated and translated', map: (p: Vec2): Vec2 => ({ x: 80 - p.y, y: 40 + p.x }) },
  { name: 'mirrored', map: (p: Vec2): Vec2 => ({ x: 60 - p.x, y: p.y }) },
];

describe('helical pocket boundary containment', () => {
  it('bounds full-boundary containment work for separated dense rings', () => {
    const paths: Polyline[] = Array.from({ length: 4 }, (_, ring) => ({
      closed: true,
      points: Array.from({ length: 256 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 256;
        return { x: (100 - ring * 10) * Math.cos(angle), y: (100 - ring * 10) * Math.sin(angle) };
      }),
    }));
    const completeChecks = vi.spyOn(segmentContainment, 'segmentContainedInPolygon');
    try {
      const plan = planHelicalPocketPasses(paths, [-1], helix);
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.passes).toHaveLength(paths.length);
      // This is a work bound, not a machine-speed threshold: distant segments
      // must not each rescan the whole boundary. The real predicate still runs.
      expect(completeChecks.mock.calls.length).toBeLessThanOrEqual(paths.length * 2);
    } finally {
      completeChecks.mockRestore();
    }
  });

  it.each(transforms)('accepts nested concave rings: $name', ({ map }) => {
    const source = mapped(concave, map);
    const paths = pocketToolpathRings([source], 2, 40);
    expect(paths).toHaveLength(3);

    const plan = planHelicalPocketPasses(paths, [-1, -2], helix);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.passes).toHaveLength(6);
    expect(
      helicalPocketPassesBySourceRegion(
        { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket', helixEntry: helix },
        [source],
        paths,
        [-1, -2],
      ),
    ).toEqual(plan.passes);
  });

  it('rejects a closing edge crossing the notch even with every vertex and centroid inside', () => {
    // The centroid (10 2/3, 4) is in the bottom arm. All three vertices are
    // inside too, but the closing diagonal crosses the notch at y > 6.
    const crossing: Polyline = {
      closed: true,
      points: [
        { x: 2, y: 8 },
        { x: 2, y: 2 },
        { x: 28, y: 2 },
      ],
    };
    expect(planHelicalPocketPasses([concave, crossing], [-1], helix)).toMatchObject({
      ok: false,
      reason: 'Helical entry currently requires one island-free pocket per layer.',
    });
  });

  it('allows a contour on the enclosing boundary, including a repeated closing point', () => {
    const duplicate = {
      ...concave,
      points: [...concave.points, concave.points[0]!],
    };
    const plan = planHelicalPocketPasses([concave, duplicate], [-1], helix);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.passes).toHaveLength(2);
  });

  it('accepts tangency and an enclosing boundary appearing after its inner ring', () => {
    const boundary: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    };
    const tangent: Polyline = {
      closed: true,
      points: [
        { x: 10, y: 0 },
        { x: 15, y: 5 },
        { x: 10, y: 10 },
        { x: 5, y: 5 },
      ],
    };
    const plan = planHelicalPocketPasses([tangent, boundary], [-1], helix);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.passes).toHaveLength(2);
  });

  it('still rejects a disconnected ring and an opposite-winding island', () => {
    const inside: Polyline = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
    };
    const outside = mapped(inside, (point) => ({ x: point.x + 40, y: point.y }));
    const island = { ...inside, points: [...inside.points].reverse() };
    for (const unsupported of [outside, island]) {
      expect(planHelicalPocketPasses([concave, unsupported], [-1], helix)).toMatchObject({
        ok: false,
        reason: 'Helical entry currently requires one island-free pocket per layer.',
      });
    }
  });
});
