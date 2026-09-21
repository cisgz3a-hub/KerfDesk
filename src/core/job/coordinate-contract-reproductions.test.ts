// These are explicit reproductions of OPEN defects. Their passing assertions
// document current failure symptoms; they are separate from the correctness matrix.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  machineBoundsForDevice,
  type DeviceProfile,
  type Origin,
} from '../devices';
import { deriveMachineEnvelope } from '../controllers/grbl/machine-envelope';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project, type Vec2 } from '../scene';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { mapControllerPointToScene } from '../../ui/state/canvas-motion-plan';
import { computeJobBounds, computeJobMotionBounds } from './job-bounds';

const COLOR = '#ff0000';
function projectFor(origin: Origin): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 358, bedHeight: 268 });
  return {
    ...base,
    optimization: { ...base.optimization, travelPolicy: 'source-order', pathDirection: 'preserve' },
    scene: {
      layers: [createLayer({ id: 'outline', color: COLOR })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'outline',
          source: 'audit.svg',
          bounds: { minX: 31, minY: 47, maxX: 91, maxY: 87 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: COLOR,
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 31, y: 47 },
                    { x: 91, y: 47 },
                    { x: 91, y: 87 },
                    { x: 31, y: 87 },
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
function explicitXyWords(gcode: string): Vec2[] {
  return gcode.split('\n').flatMap((line) => {
    if (line.startsWith(';')) return [];
    const x = /\bX(-?\d+(?:\.\d+)?)/.exec(line);
    const y = /\bY(-?\d+(?:\.\d+)?)/.exec(line);
    return x === null || y === null ? [] : [{ x: Number(x[1]), y: Number(y[1]) }];
  });
}
describe('audit reproductions of coordinate-contract defects', () => {
  it('reproduces a center-origin contour runway outside the actual centred bed', () => {
    const base = projectFor('center');
    const original = base.scene.objects[0];
    if (original?.kind !== 'imported-svg') throw new Error('fixture');
    const device: DeviceProfile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      origin: 'center',
      bedWidth: 400,
      bedHeight: 400,
    };
    const project: Project = {
      ...base,
      device,
      scene: {
        ...base.scene,
        objects: [
          {
            ...original,
            bounds: { minX: 388, minY: 170, maxX: 398, maxY: 170 },
            paths: [
              {
                color: COLOR,
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 398, y: 170 },
                      { x: 388, y: 170 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('fixture');
    const output = emitGcode(project);
    // Burn endpoints 198 -> 188 fit [-200, 200], but the nominal 5 mm entry
    // goes to X203 because its clamp assumes [0, 400]. Frame includes it and
    // preflight warns; this is not a hidden Start gate or unreported motion.
    expect(computeJobBounds(prepared.job, device)?.maxX).toBe(198);
    expect(machineBoundsForDevice(device).maxX).toBe(200);
    expect(computeJobMotionBounds(prepared.job, device)?.maxX).toBe(203);
    expect(output.gcode).toContain('X203.000 Y30.000');
    expect(output.preflight.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
  });

  it('reproduces native negative GRBL MPos drawn outside a positive front-left bed', () => {
    const device = projectFor('front-left').device;
    const native = deriveMachineEnvelope({ x: 358, y: 268, z: 50 }, 3, false);
    expect(native.x).toEqual({ minMm: -358, maxMm: 0 });
    // A head 50 right and 30 back from the physical front-left corner on
    // conventional-axis stock GRBL. WPos=(50,30), WCO=(-358,-268).
    const shown = mapControllerPointToScene(
      { x: 50, y: 30, z: 0 },
      { device, coordinateFrame: { kind: 'machine', workOffsetMm: { x: -358, y: -268, z: 0 } } },
    );
    expect(shown).toEqual({ x: -308, y: 506 });
    expect(shown).not.toEqual({ x: 50, y: 238 });
  });

  it('reproduces out-of-bed warnings for a valid job inside native negative GRBL travel', () => {
    const project = projectFor('front-left');
    const offset = { x: -300, y: -100 };
    const output = emitGcode(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
      preflightMotionOffset: offset,
    });
    const native = deriveMachineEnvelope({ x: 358, y: 268, z: 50 }, 3, false);
    for (const point of explicitXyWords(output.gcode)) {
      expect(point.x + offset.x).toBeGreaterThanOrEqual(native.x.minMm);
      expect(point.x + offset.x).toBeLessThanOrEqual(native.x.maxMm);
      expect(point.y + offset.y).toBeGreaterThanOrEqual(native.y.minMm);
      expect(point.y + offset.y).toBeLessThanOrEqual(native.y.maxMm);
    }
    expect(output.preflight.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
  });
});
