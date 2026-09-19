import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { applyJobOriginOffset } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { tileJobs } from './tile-plan';

type Xyz = Vec2 & { readonly z: number };

function loop(points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}

function compile(source: ReadonlyArray<Polyline>, tool: CncTool, clearing = false) {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'shape',
    operationIds: ['carve'],
    source: 'containment.svg',
    bounds: { minX: 0, minY: 0, maxX: 25, maxY: 25 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#2563eb', polylines: source }],
  };
  const clearTool: CncTool = { id: 'clear', name: 'Clear', kind: 'end-mill', diameterMm: 2 };
  return compileCncJob(
    {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'carve', color: '#2563eb' }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            toolId: tool.id,
            vCarveFlatDepthEnabled: clearing,
            depthMm: 0.7,
            depthPerPassMm: 100.0004,
            vResolutionMm: 0.3,
            ...(clearing ? { vClearToolId: clearTool.id } : {}),
          },
        },
      ],
    },
    DEFAULT_DEVICE_PROFILE,
    { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: tool.id, tools: [tool, clearTool] },
  );
}

// Independent text parser and signed distance oracle: do not use the production
// coordinate/cutter/boundary helpers whose certificate these tests exercise.
function cuttingSegments(gcode: string): ReadonlyArray<readonly [Xyz, Xyz]> {
  const segments: Array<readonly [Xyz, Xyz]> = [];
  let point: Xyz | null = null;
  let motion = 0;
  for (const sourceLine of gcode.split('\n')) {
    const line = sourceLine.split(';')[0] ?? '';
    const words = new Map(
      [...line.matchAll(/([GXYZ])(-?(?:\d+(?:\.\d*)?|\.\d+))/g)].map((word) => [
        word[1]!,
        word[2]!,
      ]),
    );
    const g = words.get('G');
    if (g === '0' || g === '1') motion = Number(g);
    if (!['X', 'Y', 'Z'].some((axis) => words.has(axis))) continue;
    const next = pointForWords(words, point);
    if (motion === 1 && point !== null && Math.min(point.z, next.z) < 0)
      segments.push([point, next]);
    point = next;
  }
  return segments;
}

function pointForWords(words: ReadonlyMap<string, string>, previous: Xyz | null): Xyz {
  return {
    x: Number(words.get('X') ?? previous?.x ?? 0),
    y: Number(words.get('Y') ?? previous?.y ?? 0),
    z: Number(words.get('Z') ?? previous?.z ?? 0),
  };
}

function signedClearance(point: Vec2, loops: ReadonlyArray<Polyline>): number {
  let inside = false,
    nearest = Infinity;
  for (const contour of loops) {
    for (let j = 0; j < contour.points.length; j++) {
      const a = contour.points[j]!,
        b = contour.points[(j + 1) % contour.points.length]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
      if (a.y > point.y !== b.y > point.y && point.x < a.x + ((point.y - a.y) * dx) / dy)
        inside = !inside;
    }
  }
  return inside ? nearest : -nearest;
}

function machineSource(source: ReadonlyArray<Polyline>, offset: Vec2): ReadonlyArray<Polyline> {
  return source.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => ({
      x: point.x + offset.x,
      y: DEFAULT_DEVICE_PROFILE.bedHeight - point.y + offset.y,
    })),
  }));
}

function expectContained(gcode: string, source: ReadonlyArray<Polyline>, tool: CncTool): number {
  const segments = cuttingSegments(gcode);
  const slope = Math.tan((tool.tipAngleDeg! * Math.PI) / 360);
  const tipRadius = (tool.tipDiameterMm ?? 0) / 2;
  for (const [a, b] of segments) {
    for (let step = 0; step <= 32; step++) {
      const t = step / 32;
      const depth = -(a.z + (b.z - a.z) * t);
      if (!(depth > 0)) continue;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const clearance = signedClearance(point, source);
      expect(
        tipRadius + depth * slope - clearance,
        JSON.stringify({ a, b, t, clearance, depth }),
      ).toBeLessThanOrEqual(1e-8);
    }
  }
  return segments.length;
}

describe('final ordinary and tiled V-carve containment', () => {
  const sources = [
    [
      loop([
        [10, 10],
        [24, 10],
        [14.1, 19.7],
      ]),
    ],
    [
      loop([
        [10, 10],
        [24, 10],
        [24, 24],
        [10, 24],
      ]),
      loop([
        [14, 14],
        [20, 14],
        [20, 20],
        [14, 20],
      ]),
    ],
  ];
  it.each([1, 30, 90, 150, 179])(
    'contains complete final chords after half-grid placement and tile splits at %s degrees',
    (angle) => {
      for (const flatDiameter of [0, 0.4]) {
        const tool: CncTool = {
          id: 'cone',
          name: 'Cone',
          kind: flatDiameter ? 'engraving' : 'v-bit',
          diameterMm: 6,
          tipAngleDeg: angle,
          ...(flatDiameter ? { tipDiameterMm: flatDiameter } : {}),
        };
        for (const source of sources) {
          const job = compile(source, tool);
          for (const offset of [
            { x: 0, y: 0 },
            { x: -0.0005, y: -0.0005 },
            { x: 0.0005, y: 0.0005 },
          ]) {
            const placed = applyJobOriginOffset(job, offset);
            const expected = machineSource(source, offset);
            expect(
              expectContained(cncGrblStrategy.emit(placed, DEFAULT_DEVICE_PROFILE), expected, tool),
            ).toBeGreaterThan(0);
            const tiled = tileJobs(placed, {
              tileWidthMm: 8.3333,
              tileHeightMm: 9.3333,
              overlapMm: 2.2222,
              registrationHoles: false,
            });
            expect(tiled.kind).toBe('ready');
            if (tiled.kind !== 'ready') throw new Error('Expected tiles');
            for (const { tile, job: tileJob } of tiled.tiles) {
              const shifted = expected.map((contour) => ({
                ...contour,
                points: contour.points.map((point) => ({
                  x: point.x - tile.rect.minX,
                  y: point.y - tile.rect.minY,
                })),
              }));
              expectContained(cncGrblStrategy.emit(tileJob, DEFAULT_DEVICE_PROFILE), shifted, tool);
            }
          }
        }
      }
    },
    60_000,
  );

  it('keeps represented rest-finishing fragments conservative after placement', () => {
    const source = [
      loop([
        [10, 10],
        [24, 10],
        [24, 24],
        [10, 24],
      ]),
    ];
    const tool: CncTool = {
      id: 'cone',
      name: 'Cone',
      kind: 'engraving',
      diameterMm: 6,
      tipAngleDeg: 30,
      tipDiameterMm: 0.4,
    };
    const job = compile(source, tool, true);
    const finish = {
      ...job,
      groups: job.groups.filter((group) => group.kind === 'cnc' && group.cutType === 'v-carve'),
    };
    const offset = { x: -0.0005, y: 0.0005 };
    expect(
      expectContained(
        cncGrblStrategy.emit(applyJobOriginOffset(finish, offset), DEFAULT_DEVICE_PROFILE),
        machineSource(source, offset),
        tool,
      ),
    ).toBeGreaterThan(0);
  });

  it('emits no negative exterior material for the audited microscopic triangle', () => {
    const source = [
      loop([
        [0, 0],
        [0.01, 0.007],
        [0.01, 0.009],
      ]),
    ];
    for (const angle of [1, 30]) {
      const tool: CncTool = {
        id: 'cone',
        name: 'Cone',
        kind: 'v-bit',
        diameterMm: 6,
        tipAngleDeg: angle,
      };
      expectContained(
        cncGrblStrategy.emit(compile(source, tool), DEFAULT_DEVICE_PROFILE),
        machineSource(source, { x: 0, y: 0 }),
        tool,
      );
    }
  });
});
