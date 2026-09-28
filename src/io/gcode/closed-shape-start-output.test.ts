// LBG-C04 end to end: the Cut Planner's closed-shape start reaches the emitted
// G-code, leaves the default output byte-identical, and keeps native arcs.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Project,
  type ProjectOptimizationSettings,
} from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import { emitGcode } from './emit-gcode';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };
const K = (4 / 3) * Math.tan(Math.PI / 8);

function rect(x0: number, y0: number, x1: number, y1: number): CurveSubpath {
  return {
    start: { x: (x0 + x1) / 2, y: y0 },
    closed: true,
    segments: [
      { kind: 'line', to: { x: x1, y: y0 } },
      { kind: 'line', to: { x: x1, y: y1 } },
      { kind: 'line', to: { x: x0, y: y1 } },
      { kind: 'line', to: { x: x0, y: y0 } },
      { kind: 'line', to: { x: (x0 + x1) / 2, y: y0 } },
    ],
  };
}

/** A D: flat bottom from (x, y) to (x + 2r, y), a half circle over the top,
 * drawn from the apex so its drawn start is not a corner. */
function d(x: number, y: number, r: number): CurveSubpath {
  const k = K * r;
  const cx = x + r;
  return {
    start: { x: cx, y: y + r },
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: { x: cx - k, y: y + r },
        control2: { x, y: y + k },
        to: { x, y },
      },
      { kind: 'line', to: { x: x + 2 * r, y } },
      {
        kind: 'cubic',
        control1: { x: x + 2 * r, y: y + k },
        control2: { x: cx + k, y: y + r },
        to: { x: cx, y: y + r },
      },
    ],
  };
}

function project(
  device: DeviceProfile,
  curves: ReadonlyArray<CurveSubpath>,
  optimization: ProjectOptimizationSettings = DEFAULT_PROJECT_OPTIMIZATION,
  overcutMm?: number,
): Project {
  const layer = { ...createLayer({ id: 'l', color: '#000000' }), overcutMm };
  return {
    ...createProject(device),
    optimization,
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg',
          id: 'art',
          source: 'art.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: curves.map((curve) => ({ points: [curve.start], closed: curve.closed })),
              curves,
            },
          ],
        },
      ],
    },
  };
}

const SMALL_JOB: ReadonlyArray<CurveSubpath> = [
  rect(10, 10, 50, 40),
  d(24, 20, 6),
  rect(60, 20, 90, 30),
  { start: { x: 80, y: 5 }, closed: false, segments: [{ kind: 'line', to: { x: 60, y: 8 } }] },
];

describe('closed-shape start in emitted G-code (LBG-C04)', () => {
  it('emits byte-identical G-code for drawn, an absent setting and an older file', () => {
    const { closedShapeStart: _absent, ...legacy } = DEFAULT_PROJECT_OPTIMIZATION;
    for (const device of [DEFAULT_DEVICE_PROFILE, ARC_DEVICE]) {
      for (const travelPolicy of ['nearest-neighbor', 'source-order'] as const) {
        const drawn = project(
          device,
          SMALL_JOB,
          {
            ...DEFAULT_PROJECT_OPTIMIZATION,
            travelPolicy,
            reduceTravelMoves: travelPolicy === 'nearest-neighbor',
          },
          device === ARC_DEVICE ? undefined : 1,
        );
        const withoutField = {
          ...drawn,
          optimization: { ...legacy, travelPolicy },
        } as unknown as Project;
        const reloaded = deserializeProject(serializeProject(withoutField));
        if (reloaded.kind !== 'ok') throw new Error('older file did not load');
        expect(reloaded.project.optimization.closedShapeStart).toBe('drawn');
        const expected = emitGcode(drawn).gcode;
        expect(expected).toContain('G1');
        expect(emitGcode(withoutField).gcode).toBe(expected);
        expect(emitGcode(reloaded.project).gcode).toBe(expected);
      }
    }
  });

  it('moves the start of a closed shape onto its nearest corner and keeps its arcs', () => {
    const planned = (closedShapeStart: ProjectOptimizationSettings['closedShapeStart']) =>
      emitGcode(
        project(ARC_DEVICE, [d(10, 10, 10)], {
          ...DEFAULT_PROJECT_OPTIMIZATION,
          closedShapeStart,
        }),
      ).gcode;
    // Machine Y runs the other way on this bed: the drawn apex (20, 20) is
    // Y380, the corners (10, 10) and (30, 10) are Y390. No overcut here: its
    // final pass rewrites the polyline, so it is cut as lines (ADR-415).
    const drawn = planned('drawn');
    expect(drawn).toMatch(/^G0 X20\.000 Y380\.000/m);
    const cornered = planned('nearest-corner');
    expect(cornered).toMatch(/^G0 X10\.000 Y390\.000/m);
    expect(cornered).toMatch(/^G[23] /m);
    expect(cornered.match(/^G[23] /gm)?.length).toBe(drawn.match(/^G[23] /gm)?.length);
  });
});
