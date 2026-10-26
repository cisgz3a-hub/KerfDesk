import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import type { Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Polyline,
  type Scene,
  type Vec2,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { conicalRadialEnvelope, radialEnvelopeDepthMm } from './radial-envelope';
import { vcarvePlanningAngleDeg } from './vcarve-angle';
import { vcarveMedialPasses } from './vcarve-medial';
import type { VCarveOptions } from './vcarve-plan';
import {
  coneRemovedDepth,
  distanceToLine,
  emittedFeedChords,
  flatRemovedDepth,
  sourceContains,
  sourceEdges,
  type RemovalChord,
} from './vcarve-removal.test-support';

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
    if (pass.kind !== 'path3d') throw new Error(`Unaudited V-carve pass kind: ${pass.kind}`);
    for (const point of pass.points) {
      points += 1;
      const distance = nearestBoundaryDistance(point, boundary);
      const inside = boundary.filter((loop) => pointInPolygon(point, loop.points)).length % 2 === 1;
      expect(inside || distance <= MAX_OVER_DEPTH_MM, 'V-carve point is outside the region').toBe(
        true,
      );
      const allowedMm = Math.min(options.maxDepthMm, radialEnvelopeDepthMm(envelope, distance));
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

// Under-cut property (CNC audit v1 F1-P3-1). The over-depth audit above cannot
// see stock a program leaves standing. This one compiles each shape, emits its
// G-code and sweeps the cutters along every emitted feed move with the
// independent removal oracle (no production simulator or planner geometry).
// Wherever the depth law asks for material to go, what is left must stay within
// the scallop between two pointed-bit floor passes one 0.1 mm automatic floor
// pitch apart (ADR-319 §6), plus the 0.01 mm emitted-footprint tolerance and
// 0.001 mm XYZ rounding. A flat core squared off short of an inside corner left
// a 0.17-0.55 mm fin there (ADR-285 Amendment 1).

const END_MILL: CncTool = {
  id: 'em3',
  name: '3.175 mm end mill',
  kind: 'end-mill',
  diameterMm: 3.175,
};
const V90_SMALL: CncTool = { ...V90, id: 'v90-3', name: '90° V-bit, 3.175 mm', diameterMm: 3.175 };
const FLOOR_PITCH_MM = 0.1;
const HEIGHT_FIELD_CELL_MM = 0.05;
const BUCKET_MM = 1;

type UnderCutCase = {
  readonly name: string;
  readonly shape: ReadonlyArray<Polyline>;
  readonly tool: CncTool;
  readonly floorMm?: number;
  readonly clear?: CncTool;
};

const UNDER_CUT_CASES: ReadonlyArray<UnderCutCase> = [
  { name: 'L junction, 60° bit, 1 mm floor', shape: SHAPES[1]?.[1] ?? [], tool: V60, floorMm: 1 },
  { name: 'L junction, 90° bit, 1 mm floor', shape: SHAPES[1]?.[1] ?? [], tool: V90, floorMm: 1 },
  {
    name: 'slab with island, 90° bit, 1 mm floor',
    shape: SHAPES[3]?.[1] ?? [],
    tool: V90,
    floorMm: 1,
  },
  {
    name: 'square with a 0.8 mm island, flowing 90° bit',
    shape: [rectangle(0, 0, 10, 10), rectangle(4.6, 4.6, 5.4, 5.4)],
    tool: V90_SMALL,
  },
  {
    name: 'wide L, 90° bit after an end-mill clearing stage, 1 mm floor',
    shape: [
      polygon([
        { x: 0, y: 0 },
        { x: 14, y: 0 },
        { x: 14, y: 14 },
        { x: 8, y: 14 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
      ]),
    ],
    tool: V90,
    floorMm: 1,
    clear: END_MILL,
  },
];

function compileUnderCutCase(c: UnderCutCase): Job {
  const scene: Scene = {
    objects: [
      {
        kind: 'imported-svg',
        id: 'source',
        source: 'source.svg',
        bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: c.shape }],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'carve', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: c.tool.id,
          vCarveFlatDepthEnabled: c.floorMm !== undefined,
          depthMm: c.floorMm ?? 1,
          depthPerPassMm: 10,
          vResolutionMm: 0,
          ...(c.clear === undefined ? {} : { vClearToolId: c.clear.id }),
        },
      },
    ],
  };
  const tools = c.clear === undefined ? [c.tool] : [c.tool, c.clear];
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools,
    toolId: c.tool.id,
  });
}

function emittedChordsByCutter(job: Job, clearToolId: string | undefined) {
  const cone: RemovalChord[] = [];
  const flat: RemovalChord[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const program = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    (group.toolId === clearToolId ? flat : cone).push(...emittedFeedChords(program));
  }
  return { cone, flat };
}

function bucketIndex(mm: number): number {
  return Math.floor(mm / BUCKET_MM);
}

/** Lists each chord in every 1 mm bucket its pointed cone can reach. */
function chordBuckets(chords: ReadonlyArray<RemovalChord>, slope: number, outerRadiusMm: number) {
  const buckets = new Map<string, RemovalChord[]>();
  for (const chord of chords) {
    const [a, b] = chord;
    const reachMm = Math.min(outerRadiusMm, Math.max(-a.z, -b.z) * slope);
    const lastX = bucketIndex(Math.max(a.x, b.x) + reachMm);
    const lastY = bucketIndex(Math.max(a.y, b.y) + reachMm);
    for (let ix = bucketIndex(Math.min(a.x, b.x) - reachMm); ix <= lastX; ix += 1)
      for (let iy = bucketIndex(Math.min(a.y, b.y) - reachMm); iy <= lastY; iy += 1) {
        const list = buckets.get(`${ix},${iy}`);
        if (list === undefined) buckets.set(`${ix},${iy}`, [chord]);
        else list.push(chord);
      }
  }
  return buckets;
}

function shapeCells(shape: ReadonlyArray<Polyline>): Vec2[] {
  const xs = shape.flatMap((loop) => loop.points.map((point) => point.x));
  const ys = shape.flatMap((loop) => loop.points.map((point) => point.y));
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const cells: Vec2[] = [];
  for (let y = minY + HEIGHT_FIELD_CELL_MM / 2; y < maxY; y += HEIGHT_FIELD_CELL_MM)
    for (let x = minX + HEIGHT_FIELD_CELL_MM / 2; x < maxX; x += HEIGHT_FIELD_CELL_MM)
      if (sourceContains({ x, y }, shape)) cells.push({ x, y });
  return cells;
}

function auditUnderCut(c: UnderCutCase) {
  const angleDeg = c.tool.tipAngleDeg ?? 0;
  const slope = Math.tan((angleDeg * Math.PI) / 360);
  const capMm = Math.min(c.floorMm ?? Number.POSITIVE_INFINITY, c.tool.diameterMm / 2 / slope);
  const chords = emittedChordsByCutter(compileUnderCutCase(c), c.clear?.id);
  const buckets = chordBuckets(chords.cone, slope, c.tool.diameterMm / 2);
  const edges = sourceEdges(c.shape);
  let worstShortfallMm = Number.NEGATIVE_INFINITY;
  let worstOverMm = Number.NEGATIVE_INFINITY;
  for (const cell of shapeCells(c.shape)) {
    const clearanceMm = Math.min(...edges.map(([a, b]) => distanceToLine(cell, a, b)));
    const targetMm = Math.min(capMm, clearanceMm / slope);
    const machine = toMachineCoords(cell, DEFAULT_DEVICE_PROFILE);
    const near = (buckets.get(`${bucketIndex(machine.x)},${bucketIndex(machine.y)}`) ?? []).filter(
      ([a, b]) => distanceToLine(machine, a, b) < Math.max(-a.z, -b.z) * slope,
    );
    const coneMm = coneRemovedDepth(machine, near, angleDeg);
    const flatMm =
      c.clear === undefined ? 0 : flatRemovedDepth(machine, chords.flat, c.clear.diameterMm);
    const removedMm = Math.max(coneMm, flatMm);
    worstShortfallMm = Math.max(worstShortfallMm, targetMm - removedMm);
    worstOverMm = Math.max(worstOverMm, removedMm - targetMm);
  }
  return { worstShortfallMm, worstOverMm, slope, flatChords: chords.flat.length };
}

describe('V-carve leaves no more than the floor scallop standing', () => {
  it.each(UNDER_CUT_CASES)(
    '$name',
    (c) => {
      const audit = auditUnderCut(c);
      const scallopMm = FLOOR_PITCH_MM / (2 * audit.slope);
      const representationMm = 0.01 / audit.slope + 0.002;
      if (c.clear !== undefined) expect(audit.flatChords).toBeGreaterThan(0);
      expect(audit.worstShortfallMm).toBeLessThanOrEqual(scallopMm + representationMm);
      expect(audit.worstOverMm).toBeLessThanOrEqual(0.002);
    },
    60_000,
  );
});
