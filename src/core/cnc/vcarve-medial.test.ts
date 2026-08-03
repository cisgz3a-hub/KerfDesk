import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../geometry';
import {
  flattenNormalizedPolylineTree,
  normalizeClosedPolylineTreeEvenOddChecked,
  normalizeClosedPolylinesEvenOddChecked,
} from '../geometry/polygon-difference';
import { cncPassXyPoints } from '../job';
import type { CncTool, Polyline, Vec2 } from '../scene';
import { computeVCarveMedialAxis, type VCarveMedialGraph } from './vcarve-medial-axis';
import {
  pointInOrOnVCarveRegion,
  pointInVCarveRegion,
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  vcarveMedialRegionsFromTree,
  type VCarveMedialRegion,
} from './vcarve-medial-region';
import { vcarveMedialRoutes } from './vcarve-medial-route';
import { vcarveMedialPasses } from './vcarve-medial';

const TEST_RESOLUTION_MM = 0.25;
const SIMPLIFY_TOLERANCE_MM = 0.02;
const NUMERIC_EPSILON_MM = 1e-9;

function minimumSweptConeGapSquared(
  points: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>,
  probe: Vec2,
  tanHalf: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const radius = Math.max(0, -from.z * tanHalf);
    const radiusDelta = Math.max(0, -to.z * tanHalf) - radius;
    const qx = probe.x - from.x;
    const qy = probe.y - from.y;
    const quadratic = dx * dx + dy * dy - radiusDelta * radiusDelta;
    const linear = -2 * (qx * dx + qy * dy + radius * radiusDelta);
    const constant = qx * qx + qy * qy - radius * radius;
    const values = [constant, quadratic + linear + constant];
    if (quadratic > 0) {
      const t = -linear / (2 * quadratic);
      if (t > 0 && t < 1) values.push(quadratic * t * t + linear * t + constant);
    }
    minimum = Math.min(minimum, ...values);
  }
  return minimum;
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

function onlyRegion(contours: ReadonlyArray<Polyline>): VCarveMedialRegion {
  const normalized = normalizeClosedPolylineTreeEvenOddChecked(contours);
  expect(normalized.kind).toBe('ok');
  if (normalized.kind !== 'ok') throw new Error('Expected normalized V-carve contours.');
  const regions = vcarveMedialRegionsFromTree(normalized.value);
  expect(regions).toHaveLength(1);
  const region = regions[0];
  if (region === undefined) throw new Error('Expected one normalized V-carve region.');
  return region;
}

describe('vector V-carve medial planning', () => {
  it('builds one connected center route for a simple rectangle', () => {
    const region = onlyRegion([rectangle(0, 0, 12, 4)]);
    const segments = vcarveBoundarySegments(region);
    const axis = computeVCarveMedialAxis(region, TEST_RESOLUTION_MM);

    expect(axis.failed).toBe(false);
    expect(axis.budgetLimited).toBe(false);
    expect(axis.graph.nodes.length).toBeGreaterThan(1);
    expect(Math.max(...axis.graph.nodes.map((node) => node.clearanceMm))).toBeCloseTo(2, 6);
    expect(axis.graph.nodes.every((node) => pointInOrOnVCarveRegion(node, region, segments))).toBe(
      true,
    );
    const routes = vcarveMedialRoutes(axis.graph, region, segments, SIMPLIFY_TOLERANCE_MM);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.points.length).toBeGreaterThan(1);
  });

  it('keeps nodes and full graph chords outside an enclosed hole', () => {
    const region = onlyRegion([rectangle(0, 0, 12, 10), rectangle(4, 3, 8, 7)]);
    const segments = vcarveBoundarySegments(region);
    const acrossHole = vcarveChordInsideRegion({ x: 2, y: 5 }, { x: 10, y: 5 }, region, segments);

    expect(region.holes).toHaveLength(1);
    expect(acrossHole).toBe(false);
    const axis = computeVCarveMedialAxis(region, TEST_RESOLUTION_MM);
    expect(axis.failed).toBe(false);
    expect(axis.graph.nodes.every((node) => pointInOrOnVCarveRegion(node, region, segments))).toBe(
      true,
    );
    axis.graph.adjacency.forEach((neighbors, index) => {
      const from = axis.graph.nodes[index];
      if (from === undefined) return;
      for (const neighbor of neighbors) {
        const to = axis.graph.nodes[neighbor];
        if (to !== undefined) {
          expect(vcarveChordInsideRegion(from, to, region, segments)).toBe(true);
        }
      }
    });
  });

  it.each([0, 0.5, 1])(
    'preserves the emitted cone footprint through a localized 0.1 mm wall at Detail %s',
    (resolutionMm) => {
      const wallMidY = 14.8925;
      const contours = [rectangle(0, 0, 10.34, 28.181), rectangle(0.1, 3.233, 7.848, 26.552)];
      const plan = vcarveMedialPasses(contours, {
        tool: {
          id: 'v90-local-wall',
          name: '90 degree V-bit',
          kind: 'v-bit',
          diameterMm: 6,
          tipAngleDeg: 90,
        },
        maxDepthMm: 20,
        depthPerPassMm: 20,
        resolutionMm,
      });

      expect(plan.offsetFailed).toBe(false);
      expect(plan.thinResidual).toBe(false);
      expect(plan.passLimited).toBe(false);
      expect(plan.passes).toHaveLength(1);
      const pass = plan.passes[0];
      expect(pass?.kind).toBe('path3d');
      if (pass?.kind !== 'path3d') throw new Error('Expected one connected local-wall route.');
      expect(
        minimumSweptConeGapSquared(pass.points, { x: 0.01, y: wallMidY }, 1),
      ).toBeLessThanOrEqual(NUMERIC_EPSILON_MM);
    },
  );

  it('does not simplify away the swept cone footprint at an L-shaped junction', () => {
    const lShape: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 7, y: 10 },
        { x: 7, y: 3 },
        { x: 0, y: 3 },
      ],
    };
    const plan = vcarveMedialPasses([lShape], {
      tool: {
        id: 'v90-l-junction',
        name: '90 degree V-bit',
        kind: 'v-bit',
        diameterMm: 6,
        tipAngleDeg: 90,
      },
      maxDepthMm: 20,
      depthPerPassMm: 20,
      resolutionMm: 0,
    });

    expect(plan.offsetFailed).toBe(false);
    expect(plan.thinResidual).toBe(false);
    expect(plan.passLimited).toBe(false);
    expect(plan.passes).toHaveLength(1);
    const pass = plan.passes[0];
    expect(pass?.kind).toBe('path3d');
    if (pass?.kind !== 'path3d') throw new Error('Expected one connected L-shaped route.');
    expect(minimumSweptConeGapSquared(pass.points, { x: 9.999, y: 2.305 }, 1)).toBeLessThanOrEqual(
      NUMERIC_EPSILON_MM,
    );
  });

  it('keeps corner-touching filled contours as three independent carved regions', () => {
    const contours = [
      rectangle(0, 0, 10, 10),
      rectangle(10, 10, 20, 20),
      rectangle(20, 20, 30, 30),
    ];
    const normalized = normalizeClosedPolylineTreeEvenOddChecked(contours);
    expect(normalized.kind).toBe('ok');
    if (normalized.kind !== 'ok') throw new Error('Expected normalized V-carve contours.');
    const regions = vcarveMedialRegionsFromTree(normalized.value);

    expect(regions).toHaveLength(3);
    expect(
      regions.map(({ outer }) => Math.min(...outer.points.map(({ x }) => x))).sort((a, b) => a - b),
    ).toEqual([0, 10, 20]);

    const plan = vcarveMedialPasses(contours, {
      tool: {
        id: 'v90',
        name: '90 degree V-bit',
        kind: 'v-bit',
        diameterMm: 6,
        tipAngleDeg: 90,
      },
      maxDepthMm: 3,
      depthPerPassMm: 3,
      resolutionMm: 0.1,
    });
    expect(plan.passes).toHaveLength(3);
    expect(plan.passes.map((pass) => Math.min(...cncPassXyPoints(pass).map(({ x }) => x)))).toEqual(
      [0, 10, 20],
    );
    const emittedX = plan.passes.flatMap((pass) => cncPassXyPoints(pass).map(({ x }) => x));
    expect(Math.min(...emittedX)).toBeLessThan(10);
    expect(Math.max(...emittedX)).toBeGreaterThan(20);
  });

  it('keeps touching Clipper holes void instead of promoting them to filled roots', () => {
    const contours = [
      rectangle(6, 0, 8, 8),
      rectangle(9, 0, 13, 3),
      rectangle(0, 6, 3, 8),
      rectangle(6, 0, 13, 5),
      rectangle(5, 9, 6, 16),
      rectangle(8, 8, 9, 11),
      rectangle(4, 4, 10, 11),
    ];
    const normalized = normalizeClosedPolylinesEvenOddChecked(contours);
    const tree = normalizeClosedPolylineTreeEvenOddChecked(contours);
    expect(normalized.kind).toBe('ok');
    expect(tree.kind).toBe('ok');
    if (normalized.kind !== 'ok' || tree.kind !== 'ok') return;
    expect(flattenNormalizedPolylineTree(tree.value)).toHaveLength(normalized.value.length);

    const plan = vcarveMedialPasses(contours, {
      tool: {
        id: 'v90',
        name: '90 degree V-bit',
        kind: 'v-bit',
        diameterMm: 6,
        tipAngleDeg: 90,
      },
      maxDepthMm: 3,
      depthPerPassMm: 3,
      resolutionMm: 0.1,
    });
    const cuttingPoints = plan.passes.flatMap((pass) =>
      pass.kind === 'path3d' ? pass.points.filter(({ z }) => z < 0) : [],
    );
    expect(cuttingPoints.length).toBeGreaterThan(0);
    expect(
      cuttingPoints.every((point) =>
        normalized.value.reduce(
          (inside, contour) => (pointInPolygon(point, contour.points) ? !inside : inside),
          false,
        ),
      ),
    ).toBe(true);
  });

  it('rejects a concave chord even when both endpoints and its midpoint are inside', () => {
    const notched: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 7, y: 10 },
        { x: 7, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const region = onlyRegion([notched]);
    const segments = vcarveBoundarySegments(region);
    const from = { x: 1, y: 5 };
    const midpoint = { x: 5, y: 5 };
    const to = { x: 9, y: 5 };

    expect(pointInVCarveRegion(from, region)).toBe(true);
    expect(pointInVCarveRegion(midpoint, region)).toBe(true);
    expect(pointInVCarveRegion(to, region)).toBe(true);
    expect(vcarveChordInsideRegion(from, to, region, segments)).toBe(false);
  });

  it('is byte-structure deterministic for repeated graph and route planning', () => {
    const region = onlyRegion([rectangle(0, 0, 12, 10), rectangle(4, 3, 8, 7)]);
    const segments = vcarveBoundarySegments(region);
    const firstAxis = computeVCarveMedialAxis(region, TEST_RESOLUTION_MM);
    const secondAxis = computeVCarveMedialAxis(region, TEST_RESOLUTION_MM);
    const firstRoutes = vcarveMedialRoutes(
      firstAxis.graph,
      region,
      segments,
      SIMPLIFY_TOLERANCE_MM,
    );
    const secondRoutes = vcarveMedialRoutes(
      secondAxis.graph,
      region,
      segments,
      SIMPLIFY_TOLERANCE_MM,
    );

    expect(JSON.stringify(secondAxis)).toBe(JSON.stringify(firstAxis));
    expect(JSON.stringify(secondRoutes)).toBe(JSON.stringify(firstRoutes));
  });

  it('routes a long thin region without exhausting the JavaScript call stack', () => {
    const region = onlyRegion([rectangle(0, 0, 400, 1)]);
    const segments = vcarveBoundarySegments(region);
    const nodeCount = 12_001;
    const graph: VCarveMedialGraph = {
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        x: 0.01 + (399.98 * index) / (nodeCount - 1),
        y: 0.5,
        clearanceMm: 0.5,
      })),
      adjacency: Array.from({ length: nodeCount }, (_, index) =>
        [index > 0 ? index - 1 : -1, index + 1 < nodeCount ? index + 1 : -1].filter(
          (neighbor) => neighbor >= 0,
        ),
      ),
    };

    expect(graph.nodes.length).toBeGreaterThan(10_000);
    const routes = vcarveMedialRoutes(graph, region, segments, SIMPLIFY_TOLERANCE_MM);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.points.length).toBeGreaterThan(1);
  });

  it('keeps a smooth dot as one structurally valid cutting pass', () => {
    const center = { x: 5, y: 5 };
    const circle: Polyline = {
      closed: true,
      points: Array.from({ length: 32 }, (_, index) => {
        const angle = (index / 32) * Math.PI * 2;
        return { x: center.x + Math.cos(angle), y: center.y + Math.sin(angle) };
      }),
    };
    const tool: CncTool = {
      id: 'v90',
      name: '90 degree V-bit',
      kind: 'v-bit',
      diameterMm: 6,
      tipAngleDeg: 90,
    };
    const plan = vcarveMedialPasses([circle], {
      tool,
      maxDepthMm: Number.POSITIVE_INFINITY,
      depthPerPassMm: 2,
      resolutionMm: 0.1,
    });

    expect(plan.passes).toHaveLength(1);
    const pass = plan.passes[0];
    expect(pass?.kind).toBe('path3d');
    if (pass?.kind !== 'path3d') throw new Error('Expected one variable-depth dot pass.');
    expect(pass.points.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...pass.points.map((point) => point.z))).toBeLessThan(-0.9);
    expect(
      pass.points.every(
        (point) => Math.hypot(point.x - center.x, point.y - center.y) <= 1 + NUMERIC_EPSILON_MM,
      ),
    ).toBe(true);
  });

  it('keeps a supported acute-angle circular carve out of the microblock regime', () => {
    const center = { x: 5.00049, y: 5.00049 };
    const circle: Polyline = {
      closed: true,
      points: Array.from({ length: 64 }, (_, index) => {
        const angle = (index / 64) * Math.PI * 2;
        return { x: center.x + Math.cos(angle), y: center.y + Math.sin(angle) };
      }),
    };
    const tool: CncTool = {
      id: 'v15',
      name: '15 degree V-bit',
      kind: 'v-bit',
      diameterMm: 6,
      tipAngleDeg: 15,
    };
    const plan = vcarveMedialPasses([circle], {
      tool,
      maxDepthMm: Number.POSITIVE_INFINITY,
      depthPerPassMm: 100,
      resolutionMm: 0.1,
    });
    const pointCount = plan.passes.reduce(
      (sum, pass) => sum + (pass.kind === 'path3d' ? pass.points.length : 0),
      0,
    );

    expect(plan.passes).toHaveLength(1);
    expect(pointCount).toBeLessThan(1_000);
  });

  it('reports a locally unrepresentable 179 degree V-bit wall instead of false-clean output', () => {
    const widthMm = 0.2;
    const contours = [
      rectangle(0, 0, 10, 10),
      rectangle(widthMm, widthMm, 10 - widthMm, 10 - widthMm),
    ];
    const plan = vcarveMedialPasses(contours, {
      tool: {
        id: 'v179',
        name: '179 degree V-bit',
        kind: 'v-bit',
        diameterMm: 6,
        tipAngleDeg: 179,
      },
      maxDepthMm: Number.POSITIVE_INFINITY,
      depthPerPassMm: 20,
      resolutionMm: 0,
    });

    expect(plan.passes).toHaveLength(1);
    expect(plan.thinResidual).toBe(false);
    expect(plan.passLimited).toBe(true);
  });
});
