import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../core/devices';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import type { JobOriginPlacement, JobStartMode } from '../../core/job/job-origin';
import { computeJobBounds } from '../../core/job/job-bounds';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Project,
  type Vec2,
} from '../../core/scene';
import type { LineStartRegion } from '../../core/scene/project';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import { emitGcode, emitPreparedGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

const ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];
const MODES: ReadonlyArray<JobStartMode> = [
  'absolute',
  'current-position',
  'user-origin',
  'verified-origin',
];
// Canvas coordinates: physical back is upward and front is toward the operator.
const ENTRIES: ReadonlyArray<readonly [LineStartRegion, Vec2]> = [
  ['back-left', { x: 100, y: 110 }],
  ['back-center', { x: 140, y: 110 }],
  ['back-right', { x: 180, y: 110 }],
  ['center-left', { x: 100, y: 150 }],
  ['center', { x: 140, y: 150 }],
  ['center-right', { x: 180, y: 150 }],
  ['front-left', { x: 100, y: 190 }],
  ['front-center', { x: 140, y: 190 }],
  ['front-right', { x: 180, y: 190 }],
];
const BORDER: ReadonlyArray<Vec2> = [
  { x: 140, y: 110 },
  { x: 180, y: 110 },
  { x: 180, y: 150 },
  { x: 180, y: 190 },
  { x: 140, y: 190 },
  { x: 100, y: 190 },
  { x: 100, y: 150 },
  { x: 100, y: 110 },
  { x: 140, y: 110 },
];

// Independent placement/sign oracle; no production anchor or region helper.
function machine(point: Vec2, origin: Origin): Vec2 {
  if (origin === 'center') return { x: point.x - 200, y: 200 - point.y };
  return {
    x: origin.endsWith('right') ? 400 - point.x : point.x,
    y: origin.startsWith('rear') ? point.y : 400 - point.y,
  };
}

function fixture(origin: Origin, lineStartRegion?: LineStartRegion): Project {
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    origin,
    bedWidth: 400,
    bedHeight: 400,
  };
  const base = createProject(device);
  return {
    ...base,
    optimization: {
      ...base.optimization,
      travelPolicy: 'source-order',
      reduceTravelMoves: false,
      closedShapeStart: 'drawn',
      insideFirst: false,
      pathDirection: 'preserve',
      ...(lineStartRegion === undefined ? {} : { lineStartRegion }),
    },
    scene: {
      groups: [],
      layers: [createLayer({ id: 'line', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'regions',
          source: 'regions.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 100, minY: 110, maxX: 180, maxY: 190 },
          paths: [
            {
              color: '#000000',
              polylines: [
                { closed: true, points: BORDER },
                {
                  closed: false,
                  points: [
                    { x: 140, y: 150 },
                    { x: 142, y: 150 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function firstPoweredPoint(gcode: string): Vec2 {
  const parsed = buildGcodeRenderModel(gcode, { machineKind: 'laser' });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const { model } = parsed;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if ((model.segPower[index] ?? 0) <= 0) continue;
    return { x: model.positions[index * 6] as number, y: model.positions[index * 6 + 1] as number };
  }
  throw new Error('Expected a powered motion in the emitted program');
}

const MATRIX = ORIGINS.flatMap((origin) =>
  MODES.flatMap((mode) => ENTRIES.map(([region, point]) => ({ origin, mode, region, point }))),
);

describe('Line start region reaches actual emitted output', () => {
  it.each(MATRIX)(
    '$origin / $mode / $region starts at the chosen physical artwork entry',
    ({ origin, mode, region, point }) => {
      const project = fixture(origin, region);
      const target = mode === 'current-position' ? { x: 37, y: -53 } : { x: 0, y: 0 };
      const placement: JobOriginPlacement =
        mode === 'current-position'
          ? { startFrom: mode, anchor: 'front-right', currentPosition: target }
          : { startFrom: mode, anchor: 'front-right' };
      const anchor = machine({ x: 180, y: 190 }, origin);
      const offset =
        mode === 'absolute' ? { x: 0, y: 0 } : { x: target.x - anchor.x, y: target.y - anchor.y };
      const expected = machine(point, origin);
      const options = { jobOrigin: placement, contourEntryBounds: null } as const;
      const prepared = prepareOutput(project, options);
      const legacy = prepareOutput(fixture(origin), options);
      if (!prepared.ok || !legacy.ok) throw new Error('Expected this fixture to prepare');
      expect(prepared.jobOriginOffset).toEqual(offset);
      expect(prepared.jobOriginOffset).toEqual(legacy.jobOriginOffset);
      expect(computeJobBounds(prepared.job, project.device)).toEqual(
        computeJobBounds(legacy.job, project.device),
      );
      expect(firstPoweredPoint(emitPreparedGcode(prepared, options).gcode)).toEqual({
        x: expected.x + offset.x,
        y: expected.y + offset.y,
      });
    },
  );

  it('preserves legacy output and saved bytes when the optional preference is unset', () => {
    const project = fixture('front-left');
    const text = serializeProject(project);
    const reloaded = deserializeProject(text);
    if (reloaded.kind !== 'ok') throw new Error('Expected legacy file to load');
    expect('lineStartRegion' in reloaded.project.optimization).toBe(false);
    expect(serializeProject(reloaded.project)).toBe(text);
    expect(emitGcode(reloaded.project).gcode).toBe(emitGcode(project).gcode);
    expect(firstPoweredPoint(emitGcode(project).gcode)).toEqual({ x: 140, y: 290 });
  });

  it('keeps native arcs and contour direction when the preference moves the closed start', () => {
    const k = (4 / 3) * Math.tan(Math.PI / 8) * 10;
    const curve: CurveSubpath = {
      start: { x: 120, y: 130 },
      closed: true,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 120 - k, y: 130 },
          control2: { x: 110, y: 120 + k },
          to: { x: 110, y: 120 },
        },
        { kind: 'line', to: { x: 130, y: 120 } },
        {
          kind: 'cubic',
          control1: { x: 130, y: 120 + k },
          control2: { x: 120 + k, y: 130 },
          to: { x: 120, y: 130 },
        },
      ],
    };
    const base = fixture('front-left');
    const project: Project = {
      ...base,
      device: { ...base.device, controllerKind: 'grbl-v1.1' },
      scene: {
        ...base.scene,
        objects: [
          {
            kind: 'imported-svg',
            id: 'arc',
            source: 'arc.svg',
            transform: IDENTITY_TRANSFORM,
            bounds: { minX: 110, minY: 120, maxX: 130, maxY: 130 },
            paths: [
              {
                color: '#000000',
                curves: [curve],
                polylines: [{ closed: true, points: [curve.start] }],
              },
            ],
          },
        ],
      },
    };
    const drawn = emitGcode(project).gcode;
    const preferred = emitGcode({
      ...project,
      optimization: { ...project.optimization, lineStartRegion: 'back-left' },
    }).gcode;
    expect(firstPoweredPoint(drawn)).toEqual({ x: 120, y: 270 });
    expect(firstPoweredPoint(preferred)).toEqual({ x: 110, y: 280 });
    const nativeMoves = (program: string): string[] => program.match(/^G[23] /gm) ?? [];
    expect(nativeMoves(drawn).length).toBeGreaterThan(0);
    expect(nativeMoves(preferred).sort()).toEqual(nativeMoves(drawn).sort());
  });
});
