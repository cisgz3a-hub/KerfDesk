// Laser leads beside outlines that are cut as open lines (ADR-626 Amendment 8;
// rolling audit 2026-10-21, 03-P1-2, 03-P1-3 and 03-P2-9). Each case runs the
// shipped pipeline (parseDxf or a scene, then emitGcode) and reads the G-code
// back: no lit feed move may run inside a part that is kept.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords } from '../../core/devices';
import { pointInPolygon } from '../../core/geometry/point-in-polygon';
import type { Job } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { parseDxf } from '../dxf';
import { emitGcode } from './emit-gcode';
import { litSamples } from './laser-lit-samples.test-support';
import { prepareOutput } from './prepare-output';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const ARC_LEADS = { leadInEnabled: true, leadOutEnabled: true } as const;
const LINE_LEADS = { ...ARC_LEADS, leadStyle: 'line', leadAngleDeg: 90 } as const;

function tags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function dxfLine(a: Vec2, b: Vec2): string {
  return tags([0, 'LINE'], [8, '0'], [10, a.x], [20, a.y], [11, b.x], [21, b.y]);
}

/** An 80 mm plate drawn as four LINE entities, with an r5 CIRCLE hole in its
 * middle, as CAD writes it. `gapMm` leaves one corner that far open. */
function plateDxf(gapMm = 0): string {
  const body = [
    dxfLine({ x: 0, y: 0 }, { x: 80, y: 0 }),
    dxfLine({ x: 80, y: 0 }, { x: 80, y: 80 }),
    dxfLine({ x: 80, y: 80 }, { x: 0, y: 80 }),
    dxfLine({ x: 0, y: 80 }, { x: 0, y: gapMm }),
    tags([0, 'CIRCLE'], [8, '0'], [10, 40], [20, 40], [40, 5]),
  ].join('\n');
  return `${tags([0, 'SECTION'], [2, 'ENTITIES'])}\n${body}\n${tags([0, 'ENDSEC'], [0, 'EOF'])}\n`;
}

const PLACE = { x: 100, y: 100 };

function importedPlate(gapMm = 0): SceneObject {
  const result = parseDxf({ dxfText: plateDxf(gapMm), id: 'plate', source: 'plate.dxf' });
  if (result.kind !== 'ok' || result.object === null) throw new Error('expected the DXF to import');
  return {
    ...result.object,
    transform: { ...IDENTITY_TRANSFORM, ...PLACE },
    operationIds: ['cut'],
  };
}

function layer(settings: Partial<Layer>): Layer {
  return { ...createLayer({ id: 'cut', color: '#ff0000', name: 'Cut' }), ...settings };
}

function project(layers: ReadonlyArray<Layer>, objects: ReadonlyArray<SceneObject>): Project {
  return { ...createProject(DEVICE), scene: { layers: [...layers], objects: [...objects] } };
}

/** Deeper than `depth` inside the rectangle, measured from its nearest side. */
function insideRect(point: Vec2, min: Vec2, max: Vec2, depth: number): boolean {
  return (
    point.x > min.x + depth &&
    point.x < max.x - depth &&
    point.y > min.y + depth &&
    point.y < max.y - depth
  );
}

/** Plate material: inside the 80 mm plate and outside its r5 hole, deeper
 * than 0.05 mm (the cut lines themselves run on those edges). */
function inPlate(point: Vec2): boolean {
  const corner = PLACE;
  const far = { x: PLACE.x + 80, y: PLACE.y + 80 };
  const hole = Math.hypot(point.x - (PLACE.x + 40), point.y - (PLACE.y + 40));
  return insideRect(point, corner, far, 0.05) && hole > 5.05;
}

function prepared(input: Project): Job {
  const output = prepareOutput(input);
  if (!output.ok) throw new Error('expected the project to prepare');
  return output.job;
}

function openSideUnknown(job: Job): number {
  return (job.diagnostics ?? []).reduce(
    (count, diagnostic) =>
      diagnostic.kind === 'laser-leads-side-unknown' && diagnostic.aroundOpenPaths === true
        ? count + diagnostic.count
        : count,
    0,
  );
}

describe('03-P1-2: a plate drawn as DXF LINE entities', () => {
  for (const [style, leads] of [
    ['arc', ARC_LEADS],
    ['line 90°', LINE_LEADS],
  ] as const) {
    it(`never leads the hole into the plate (${style} leads)`, () => {
      const input = project([layer(leads)], [importedPlate()]);
      const lit = litSamples(emitGcode(input).gcode, DEVICE);
      expect(lit.length).toBeGreaterThan(0);
      expect(lit.filter(inPlate)).toEqual([]);
    });
  }

  it('leads the joined plate outward and the hole inward', () => {
    const job = prepared(project([layer(ARC_LEADS)], [importedPlate()]));
    const led = job.groups.flatMap((group) =>
      group.kind === 'cut' ? group.segments.filter((segment) => !segment.closed) : [],
    );
    // Both contours are closed after import, so both get their leads.
    expect(led).toHaveLength(2);
    for (const segment of led) {
      const ends = [segment.polyline[0], segment.polyline.at(-1)].map((point) =>
        toSceneCoords(point as Vec2, DEVICE),
      );
      expect(ends.filter(inPlate)).toEqual([]);
    }
  });

  it('gives the hole no lead, with a warning, when the plate lines stay open', () => {
    // A 0.1 mm gap at one corner: wider than DXF import joins, so the plate
    // stays four open lines, but they still close round the hole.
    const input = project([layer(ARC_LEADS)], [importedPlate(0.1)]);
    const job = prepared(input);
    expect(openSideUnknown(job)).toBe(1);
    expect(litSamples(emitGcode(input).gcode, DEVICE).filter(inPlate)).toEqual([]);
  });

  it('reads crossing lines that overshoot the corners as closing the plate', () => {
    const lines: Polyline[] = [
      {
        closed: false,
        points: [
          { x: 98, y: 100 },
          { x: 182, y: 100 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 180, y: 98 },
          { x: 180, y: 182 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 182, y: 180 },
          { x: 98, y: 180 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 100, y: 182 },
          { x: 100, y: 98 },
        ],
      },
    ];
    const hole: Polyline = {
      closed: true,
      points: Array.from({ length: 64 }, (_, index) => ({
        x: 140 + 5 * Math.cos((index / 64) * 2 * Math.PI),
        y: 140 + 5 * Math.sin((index / 64) * 2 * Math.PI),
      })),
    };
    const input = project(
      [layer(LINE_LEADS)],
      [
        {
          kind: 'imported-svg',
          id: 'sketch',
          source: 'sketch.svg',
          bounds: { minX: 98, minY: 98, maxX: 182, maxY: 182 },
          transform: IDENTITY_TRANSFORM,
          operationIds: ['cut'],
          paths: [{ color: '#ff0000', polylines: [...lines, hole] }],
        },
      ],
    );
    expect(openSideUnknown(prepared(input))).toBe(1);
    expect(litSamples(emitGcode(input).gcode, DEVICE).filter(inPlate)).toEqual([]);
  });
});

describe('03-P1-3: Remove overlapping lines between two parts that share an edge', () => {
  // A is drawn from the shared corner along the shared edge x = 40 and starts
  // nearer the machine origin, so it is cut first and keeps that edge; B,
  // cut second, loses it and is left an open three-sided path.
  const A: Polyline = {
    closed: true,
    points: [
      { x: 40, y: 40 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
    ],
  };
  const B: Polyline = {
    closed: true,
    points: [
      { x: 60, y: 20 },
      { x: 60, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 20 },
    ],
  };
  function sharedEdgeProject(leads: Partial<Layer>): Project {
    const base = project(
      [layer(leads)],
      [
        {
          kind: 'imported-svg',
          id: 'pair',
          source: 'pair.svg',
          bounds: { minX: 20, minY: 20, maxX: 60, maxY: 40 },
          transform: IDENTITY_TRANSFORM,
          operationIds: ['cut'],
          paths: [{ color: '#ff0000', polylines: [A, B] }],
        },
      ],
    );
    return { ...base, optimization: { ...base.optimization, removeOverlappingLines: true } };
  }
  const inA = (point: Vec2) => insideRect(point, { x: 20, y: 20 }, { x: 40, y: 40 }, 0.05);
  const inB = (point: Vec2) => insideRect(point, { x: 40, y: 20 }, { x: 60, y: 40 }, 0.05);

  // One pass is routed alone; more passes go through the packet cleanup of
  // inside-first ordering (topology-cut-cleanup.ts), which must keep the
  // outline too.
  for (const passes of [1, 2]) {
    for (const [style, leads] of [
      ['arc', ARC_LEADS],
      ['line 90°', LINE_LEADS],
      ['line 45°', { ...ARC_LEADS, leadStyle: 'line' }],
    ] as const) {
      it(`keeps every lead out of both parts (${style} leads, ${passes} pass)`, () => {
        const input = sharedEdgeProject({ ...leads, passes });
        const lit = litSamples(emitGcode(input).gcode, DEVICE);
        expect(lit.length).toBeGreaterThan(0);
        expect(lit.filter((point) => inA(point) || inB(point))).toEqual([]);
      });
    }
  }
});

describe('03-P2-9: kerf and order of a DXF plate drawn as LINE entities', () => {
  it('offsets the joined plate as a part and its hole as a hole', () => {
    const job = prepared(project([layer({ kerfOffsetMm: 0.2 })], [importedPlate()]));
    const segments = job.groups.flatMap((group) => (group.kind === 'cut' ? group.segments : []));
    const scene = segments.map((segment) =>
      segment.polyline.map((point) => toSceneCoords(point, DEVICE)),
    );
    const hole = scene.find((points) => points.length > 8) ?? [];
    const plate = scene.find((points) => points.length <= 8) ?? [];
    const meanRadius =
      hole.reduce(
        (sum, point) => sum + Math.hypot(point.x - (PLACE.x + 40), point.y - (PLACE.y + 40)),
        0,
      ) / hole.length;
    expect(meanRadius).toBeCloseTo(4.8, 1);
    const xs = plate.map((point) => point.x);
    expect(Math.min(...xs)).toBeCloseTo(PLACE.x - 0.2, 3);
    expect(Math.max(...xs)).toBeCloseTo(PLACE.x + 80.2, 3);
    // Inside first: the hole is cut before the plate that holds it.
    expect(segments.length).toBe(2);
    expect(pointInPolygon(hole[0] as Vec2, plate)).toBe(true);
    expect(scene.indexOf(hole)).toBeLessThan(scene.indexOf(plate));
  });

  it('warns when open lines close an outline on a layer with a kerf offset', () => {
    const { preflight } = emitGcode(project([layer({ kerfOffsetMm: 0.2 })], [importedPlate(0.1)]));
    const issue = preflight.issues.find((found) => found.code === 'line-open-outline');
    expect(issue?.message).toBe(
      'Layer "Cut": 1 outline is drawn as open paths whose ends meet, so it is cut as open ' +
        'lines: no kerf offset, the shapes inside are kerf-offset as if it did not hold them ' +
        'and the shapes inside are not cut first. Select it and use ' +
        'Tools > Join paths (gap up to 0.5 mm) to close it.',
    );
  });

  it("takes an outline's settings from its own artwork, not the operation's other paths", () => {
    // The open plate outline has its kerf turned off on the artwork; a loose
    // line elsewhere on the operation keeps the operation's kerf.
    const loose: SceneObject = {
      kind: 'imported-svg',
      id: 'loose',
      source: 'loose.svg',
      bounds: { minX: 250, minY: 100, maxX: 300, maxY: 100 },
      transform: IDENTITY_TRANSFORM,
      operationIds: ['cut'],
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 250, y: 100 },
                { x: 300, y: 100 },
              ],
            },
          ],
        },
      ],
    };
    const plate = { ...importedPlate(0.1), operationOverride: { kerfOffsetMm: 0 } };
    const base = project([layer({ kerfOffsetMm: 0.2 })], [plate, loose]);
    const input = { ...base, optimization: { ...base.optimization, insideFirst: false } };
    const codes = emitGcode(input).preflight.issues.map((issue) => issue.code);
    expect(codes).not.toContain('line-open-outline');
  });

  it('says nothing about an open outline no setting needs closed', () => {
    const base = project([layer({})], [importedPlate(0.1)]);
    const input = { ...base, optimization: { ...base.optimization, insideFirst: false } };
    const codes = emitGcode(input).preflight.issues.map((issue) => issue.code);
    expect(codes).not.toContain('line-open-outline');
  });

  it('says nothing about open lines that close nothing', () => {
    const { preflight } = emitGcode(
      project(
        [layer({ kerfOffsetMm: 0.2, ...ARC_LEADS })],
        [
          {
            kind: 'imported-svg',
            id: 'score',
            source: 'score.svg',
            bounds: { minX: 100, minY: 100, maxX: 180, maxY: 100 },
            transform: IDENTITY_TRANSFORM,
            operationIds: ['cut'],
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 100, y: 100 },
                      { x: 180, y: 100 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      ),
    );
    expect(preflight.issues.map((issue) => issue.code)).not.toContain('line-open-outline');
  });
});
