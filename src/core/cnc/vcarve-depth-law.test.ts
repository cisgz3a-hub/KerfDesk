import { describe, expect, it } from 'vitest';
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import type { CncTool, Polyline, Vec2 } from '../scene';
import { conicalRadialEnvelope, radialEnvelopeDepthMm } from './radial-envelope';
import { vcarvePlanningAngleDeg } from './vcarve-angle';
import { vcarveMedialPasses } from './vcarve-medial';
import type { VCarveOptions } from './vcarve-plan';

// End-to-end depth-law property (audit 2026-10-18). The planner's certificate
// is built from many modules; this test holds the one physical invariant they
// all serve, independently of how they are arranged: at every emitted XYZ point
// of every pass, the cutter cone r(h) = r0 + h·tan(A/2) stays inside the
// artwork, so -z never exceeds min(maxDepth, h(nearest boundary distance)).
// Depth stepping may only shallow a point, and no pass may go deeper than the
// cutter's flank allows. Any over-depth here is a gouge past the outline.

const MAX_OVER_DEPTH_MM = 1e-6;

const V60: CncTool = {
  id: 'v60',
  name: '60° V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 60,
};
const V90: CncTool = {
  id: 'v90',
  name: '90° V-bit',
  kind: 'v-bit',
  diameterMm: 12.7,
  tipAngleDeg: 90,
};
const V20: CncTool = {
  id: 'v20',
  name: '20° V-bit',
  kind: 'v-bit',
  diameterMm: 3.175,
  tipAngleDeg: 20,
};
const FLAT_TIP: CncTool = {
  id: 'e30',
  name: '30° engraving, 0.5 mm tip',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.5,
};

function polygon(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points: [...points] };
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return polygon([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]);
}

function circle(cx: number, cy: number, r: number, count = 64): Polyline {
  return polygon(
    Array.from({ length: count }, (_, i) => ({
      x: cx + r * Math.cos((2 * Math.PI * i) / count),
      y: cy + r * Math.sin((2 * Math.PI * i) / count),
    })),
  );
}

const SHAPES: ReadonlyArray<readonly [string, ReadonlyArray<Polyline>]> = [
  [
    'acute spike',
    [
      polygon([
        { x: 0, y: 0 },
        { x: 10, y: 1 },
        { x: 0, y: 2 },
      ]),
    ],
  ],
  [
    'L junction',
    [
      polygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 7, y: 10 },
        { x: 7, y: 3 },
        { x: 0, y: 3 },
      ]),
    ],
  ],
  ['ring (letter O)', [circle(20, 20, 10), circle(20, 20, 6)]],
  ['slab with island', [rectangle(0, 0, 30, 8), rectangle(10, 3, 12, 5)]],
  [
    'star with reflex corners',
    [
      polygon(
        Array.from({ length: 10 }, (_, i) => {
          const r = i % 2 === 0 ? 12 : 5;
          const a = (Math.PI * i) / 5;
          return { x: 15 + r * Math.cos(a), y: 15 + r * Math.sin(a) };
        }),
      ),
    ],
  ],
  [
    'narrow bridge',
    [rectangle(0, 0, 10, 10), rectangle(10, 4.7, 20, 5.3), rectangle(20, 0, 30, 10)],
  ],
];

const DEPTHS: ReadonlyArray<readonly [number, number]> = [
  // [maxDepthMm, depthPerPassMm]
  [20, 20],
  [1, 1],
  [5, 0.7],
];

function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function nearestBoundaryDistance(point: Vec2, loops: ReadonlyArray<Polyline>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const loop of loops) {
    const points = loop.points;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      nearest = Math.min(nearest, pointToSegmentDistance(point, a, b));
    }
  }
  return nearest;
}

type DepthAudit = {
  readonly points: number;
  readonly worstOverDepthMm: number;
  readonly deepestMm: number;
  readonly passes: number;
};

function auditDepthLaw(shape: ReadonlyArray<Polyline>, options: VCarveOptions): DepthAudit {
  const angleDeg = vcarvePlanningAngleDeg(options.tool);
  if (angleDeg === null) throw new Error('Expected a plannable V-carve tool.');
  const envelope = conicalRadialEnvelope(options.tool, angleDeg);
  if (envelope === null) throw new Error('Expected a conical radial envelope.');
  // The planner carves the normalized region, so touching or nested input
  // contours are measured against their unioned outline, not their seams.
  const normalized = normalizeClosedPolylinesEvenOddChecked(shape);
  if (normalized.kind !== 'ok') throw new Error('Expected a normalizable V-carve region.');
  const boundary = normalized.value;
  const plan = vcarveMedialPasses(shape, options);
  let points = 0;
  let worstOverDepthMm = Number.NEGATIVE_INFINITY;
  let deepestMm = 0;
  for (const pass of plan.passes) {
    if (pass.kind !== 'path3d') continue;
    for (const point of pass.points) {
      points += 1;
      const allowedMm = Math.min(
        options.maxDepthMm,
        radialEnvelopeDepthMm(envelope, nearestBoundaryDistance(point, boundary)),
      );
      worstOverDepthMm = Math.max(worstOverDepthMm, -point.z - allowedMm);
      deepestMm = Math.max(deepestMm, -point.z);
    }
  }
  return { points, worstOverDepthMm, deepestMm, passes: plan.passes.length };
}

describe('V-carve depth law across the whole planner', () => {
  describe.each([V60, V90, V20, FLAT_TIP])('$name', (tool) => {
    describe.each(SHAPES)('%s', (_name, shape) => {
      it.each(DEPTHS)(
        'maxDepth %s mm, %s mm per pass: no emitted point gouges',
        (maxDepthMm, depthPerPassMm) => {
          const audit = auditDepthLaw(shape, { tool, maxDepthMm, depthPerPassMm, resolutionMm: 0 });
          expect(audit.points).toBeGreaterThan(0);
          expect(audit.worstOverDepthMm).toBeLessThanOrEqual(MAX_OVER_DEPTH_MM);
        },
      );
    });
  });

  it('caps every pass at the cutter flank when the flat depth is deeper than the flank', () => {
    const envelope = conicalRadialEnvelope(FLAT_TIP, 30);
    if (envelope === null) throw new Error('Expected a conical radial envelope.');
    const flankMm = (envelope.outerRadiusMm - envelope.tipRadiusMm) / envelope.tanHalf;
    const audit = auditDepthLaw(SHAPES[3]?.[1] ?? [], {
      tool: FLAT_TIP,
      maxDepthMm: 20,
      depthPerPassMm: 20,
      resolutionMm: 0,
    });
    expect(audit.deepestMm).toBeLessThanOrEqual(flankMm + MAX_OVER_DEPTH_MM);
    expect(audit.deepestMm).toBeGreaterThan(flankMm - 0.01);
  });

  it('keeps the cone law at a coarse requested resolution', () => {
    for (const resolutionMm of [0.5, 1]) {
      const audit = auditDepthLaw(SHAPES[0]?.[1] ?? [], {
        tool: V60,
        maxDepthMm: 20,
        depthPerPassMm: 20,
        resolutionMm,
      });
      expect(audit.worstOverDepthMm).toBeLessThanOrEqual(MAX_OVER_DEPTH_MM);
    }
  });
});
