// CW-02: 2D passes rapid down to just above the cut an earlier pass of their
// group left. Cutting every earlier pass of the group in a stock simulation
// must leave nothing the bit would touch with its tip at a pass's floor,
// anywhere along that pass (the ADR-489 claim), for every kind of 2D job.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { sampleCircularArcPoints } from '../geometry/circular-arc';
import type { CncGroup, CncPass } from '../job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TOOLS,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncTool,
  type ImportedSvg,
  type Scene,
  type Vec2,
} from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import { compileCncJob } from './compile-cnc-job';

type Point = { readonly x: number; readonly y: number; readonly z: number };

function shape(id: string, color: string, loops: Vec2[][], closed = true): ImportedSvg {
  const xs = loops.flat().map((p) => p.x);
  const ys = loops.flat().map((p) => p.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: loops.map((points) => ({ closed, points })) }],
  };
}

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const circle = (cx: number, cy: number, r: number, n = 48): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }));

function scene(objects: ImportedSvg[], cnc: Partial<CncLayerSettings>): Scene {
  const layer = {
    ...createLayer({ id: '#ff0000', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return { objects, layers: [layer] };
}

const MACHINE = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 12, widthMm: 300, heightMm: 300 },
};

function toolOf(group: CncGroup): CncTool {
  const tool = DEFAULT_CNC_TOOLS.find((candidate) => candidate.id === group.toolId);
  if (tool === undefined) throw new Error(`no tool ${group.toolId}`);
  return tool;
}

function passPoints(pass: CncPass): ReadonlyArray<Point> {
  switch (pass.kind) {
    case 'contour': {
      const ring = pass.closed
        ? [...pass.polyline, pass.polyline[0] ?? { x: 0, y: 0 }]
        : pass.polyline;
      return ring.map((point) => ({ ...point, z: pass.zMm }));
    }
    case 'path3d':
      return pass.points;
    case 'arc':
      return sampleCircularArcPoints(pass).map((point) => ({ ...point, z: pass.zMm }));
    case 'helical-contour': {
      const radius = Math.hypot(pass.start.x - pass.center.x, pass.start.y - pass.center.y);
      const startAngle = Math.atan2(pass.start.y - pass.center.y, pass.start.x - pass.center.x);
      const steps = Math.ceil(pass.revolutions * 48);
      const turn = (pass.clockwise ? -1 : 1) * 2 * Math.PI * pass.revolutions;
      const helix = Array.from({ length: steps + 1 }, (_, i) => ({
        x: pass.center.x + radius * Math.cos(startAngle + (turn * i) / steps),
        y: pass.center.y + radius * Math.sin(startAngle + (turn * i) / steps),
        z: pass.startZMm + ((pass.zMm - pass.startZMm) * i) / steps,
      }));
      const ring = pass.closed
        ? [...pass.polyline, pass.polyline[0] ?? { x: 0, y: 0 }]
        : pass.polyline;
      return [...helix, ...ring.map((point) => ({ ...point, z: pass.zMm }))];
    }
  }
}

function floorOf(pass: CncPass): number | undefined {
  return pass.kind === 'helical-contour' ? undefined : pass.airFloorZMm;
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const length2 = ex * ex + ey * ey;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (y - a.y) * ey) / length2)) : 0;
  return Math.hypot(x - a.x - t * ex, y - a.y - t * ey);
}

type Stock = {
  readonly cellMm: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly top: Float64Array;
};

function forCellsNear(
  stock: Stock,
  a: Point,
  b: Point,
  radiusMm: number,
  visit: (cell: number, distanceMm: number) => void,
): void {
  const { cellMm, minX, minY } = stock;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radiusMm - minX) / cellMm));
  const i1 = Math.min(stock.width - 1, Math.ceil((Math.max(a.x, b.x) + radiusMm - minX) / cellMm));
  const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - radiusMm - minY) / cellMm));
  const j1 = Math.min(stock.height - 1, Math.ceil((Math.max(a.y, b.y) + radiusMm - minY) / cellMm));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const d = distanceToSegment(minX + (i + 0.5) * cellMm, minY + (j + 0.5) * cellMm, a, b);
      if (d <= radiusMm) visit(j * stock.width + i, d);
    }
  }
}

type Report = { readonly floored: number; readonly worstMm: number };

// Cut the group's passes in order, each segment at the higher of its ends'
// heights (so a ramp cuts no more here than it really does). Before each pass
// with a floor, measure how far any stock stands above the bit held at the
// floor anywhere on the pass's path.
function checkGroup(group: CncGroup): Report {
  const tool = toolOf(group);
  const cellMm = tool.diameterMm / 10;
  const law: ToolKernel = kernelForTool(tool, cellMm);
  const all = group.passes.flatMap(passPoints);
  const minX = Math.min(...all.map((p) => p.x)) - law.radiusMm - cellMm;
  const minY = Math.min(...all.map((p) => p.y)) - law.radiusMm - cellMm;
  const width = Math.ceil(
    (Math.max(...all.map((p) => p.x)) + law.radiusMm + cellMm - minX) / cellMm,
  );
  const height = Math.ceil(
    (Math.max(...all.map((p) => p.y)) + law.radiusMm + cellMm - minY) / cellMm,
  );
  const stock: Stock = { cellMm, minX, minY, width, height, top: new Float64Array(width * height) };
  let floored = 0;
  let worstMm = Number.NEGATIVE_INFINITY;
  for (const pass of group.passes) {
    const points = passPoints(pass);
    const floor = floorOf(pass);
    if (floor !== undefined) {
      floored += 1;
      points.forEach((a, index) => {
        forCellsNear(stock, a, points[index + 1] ?? a, law.radiusMm, (cell, distance) => {
          worstMm = Math.max(
            worstMm,
            (stock.top[cell] ?? 0) - (floor + law.surfaceDzAtRadius(distance)),
          );
        });
      });
    }
    points.forEach((a, index) => {
      const b = points[index + 1] ?? a;
      const z = Math.max(a.z, b.z);
      forCellsNear(stock, a, b, law.radiusMm, (cell, distance) => {
        stock.top[cell] = Math.min(stock.top[cell] ?? 0, z + law.surfaceDzAtRadius(distance));
      });
    });
  }
  return { floored, worstMm };
}

const TWELVE_PARTS = Array.from({ length: 12 }, (_, i) =>
  shape(`P${i}`, '#ff0000', [rect(10 + (i % 4) * 50, 10 + Math.floor(i / 4) * 50, 40, 40)]),
);
const U_SHAPE: Vec2[] = [
  { x: 20, y: 20 },
  { x: 100, y: 20 },
  { x: 100, y: 90 },
  { x: 80, y: 90 },
  { x: 80, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 90 },
  { x: 20, y: 90 },
];
const PROFILE = { toolId: 'em-3175', depthMm: 12, depthPerPassMm: 3 };
const POCKET = { cutType: 'pocket' as const, toolId: 'em-6350', depthMm: 6, depthPerPassMm: 2 };

const CASES: ReadonlyArray<readonly [string, Scene]> = [
  [
    '12 parts, outside profile through 12 mm',
    scene(TWELVE_PARTS, { ...PROFILE, cutType: 'profile-outside' }),
  ],
  [
    'outside profile, no tabs, retract off',
    scene(TWELVE_PARTS.slice(0, 2), {
      ...PROFILE,
      cutType: 'profile-outside',
      tabsEnabled: false,
      retractBetweenPasses: false,
    }),
  ],
  [
    'inside profile of a circle, 5 degree ramp',
    scene([shape('C', '#ff0000', [circle(60, 60, 25)])], {
      ...PROFILE,
      cutType: 'profile-inside',
      rampEntryDeg: 5,
    }),
  ],
  [
    'on-path profile, straight leads, finish allowance',
    scene([shape('U', '#ff0000', [U_SHAPE])], {
      ...PROFILE,
      cutType: 'profile-on-path',
      profileLead: { shape: 'line' },
      finishAllowanceMm: 0.3,
    }),
  ],
  [
    'engraved open line',
    scene(
      [
        shape(
          'L',
          '#ff0000',
          [
            [
              { x: 10, y: 10 },
              { x: 60, y: 40 },
              { x: 90, y: 10 },
            ],
          ],
          false,
        ),
      ],
      { cutType: 'engrave', toolId: 'em-3175', depthMm: 3, depthPerPassMm: 1 },
    ),
  ],
  ['offset pocket', scene([shape('A', '#ff0000', [rect(20, 20, 80, 50)])], POCKET)],
  [
    'offset pocket, lift between rings',
    scene([shape('A', '#ff0000', [rect(20, 20, 80, 50)])], {
      ...POCKET,
      pocketLiftBetweenRings: true,
    }),
  ],
  [
    'raster pocket in a U',
    scene([shape('U', '#ff0000', [U_SHAPE])], { ...POCKET, pocketStrategy: 'raster-x' }),
  ],
  [
    'pocket with an island',
    scene([shape('I', '#ff0000', [rect(20, 20, 100, 60), rect(50, 35, 40, 30)])], POCKET),
  ],
  [
    'ramped pocket',
    scene([shape('A', '#ff0000', [rect(20, 20, 60, 40)])], { ...POCKET, rampEntryDeg: 5 }),
  ],
  [
    'helical-entry pocket',
    scene([shape('A', '#ff0000', [rect(20, 20, 60, 40)])], {
      ...POCKET,
      helixEntry: { maxDiameterMm: 5, minDiameterMm: 2, angleDeg: 3 },
    }),
  ],
  ['round pocket', scene([shape('C', '#ff0000', [circle(60, 60, 30, 72)])], POCKET)],
  [
    'drilled holes',
    scene([shape('D', '#ff0000', [circle(30, 30, 1.6, 16), circle(60, 30, 1.6, 16)])], {
      cutType: 'drill',
      toolId: 'em-3175',
      depthMm: 8,
      depthPerPassMm: 2,
    }),
  ],
];

// Helical entries and drill pecks carry no floor: a helix plunges from safe Z
// as before, and a drill cycle is one pass per hole.
const WITHOUT_FLOORS = new Set(['helical-entry pocket', 'drilled holes']);

describe('2D air floors against a stock simulation (CW-02)', () => {
  it.each(CASES)(
    '%s: no stock stands above any floor',
    (name, jobScene) => {
      const job = compileCncJob(jobScene, DEFAULT_DEVICE_PROFILE, MACHINE);
      const groups = job.groups.filter((group): group is CncGroup => group.kind === 'cnc');
      expect(groups.length).toBeGreaterThan(0);
      let floored = 0;
      for (const group of groups) {
        const report = checkGroup(group);
        floored += report.floored;
        if (report.floored > 0) expect(report.worstMm).toBeLessThanOrEqual(1e-6);
      }
      if (WITHOUT_FLOORS.has(name)) expect(floored).toBe(0);
      else expect(floored).toBeGreaterThan(0);
    },
    120_000,
  );
});
