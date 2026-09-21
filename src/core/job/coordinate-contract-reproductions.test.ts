// Correctness regressions for the three failures reproduced by the initial audit.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  machineBoundsForDevice,
  type DeviceProfile,
  type Origin,
} from '../devices';
import { deriveMachineEnvelope } from '../controllers/grbl/machine-envelope';
import { nativeBedFrame } from '../devices/native-bed-frame';
import { parseBuildInfoResponses } from '../controllers/grbl/build-info';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project, type Vec2 } from '../scene';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { mapControllerPointToScene } from '../../ui/state/canvas-motion-plan';
import { trustedMotionOffsetForPreflight } from '../../ui/job-placement';
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
describe('coordinate-contract regressions', () => {
  it('clips a center-origin contour runway at the actual centred bed edge', () => {
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
    // Burn endpoints 198 -> 188 leave exactly 2 mm for the requested 5 mm entry.
    expect(computeJobBounds(prepared.job, device)?.maxX).toBe(198);
    expect(machineBoundsForDevice(device).maxX).toBe(200);
    expect(computeJobMotionBounds(prepared.job, device)?.maxX).toBe(200);
    expect(output.gcode).toContain('X200.000 Y30.000');
    expect(output.gcode).not.toContain('X203.000 Y30.000');
    expect(output.preflight.issues.some((issue) => issue.code === 'out-of-bed')).toBe(false);
  });

  it('maps native negative GRBL MPos into the physical front-left bed', () => {
    const device = projectFor('front-left').device;
    const native = deriveMachineEnvelope({ x: 358, y: 268, z: 50 }, 3, false);
    expect(native.x).toEqual({ minMm: -358, maxMm: 0 });
    const frame = nativeBedFrame(device, { minX: -358, maxX: 0, minY: -268, maxY: 0 });
    if (frame === null) throw new Error('Native frame fixture');
    // A head 50 right and 30 back from the physical front-left corner on
    // conventional-axis stock GRBL. WPos=(50,30), WCO=(-358,-268).
    const shown = mapControllerPointToScene(
      { x: 50, y: 30, z: 0 },
      {
        device,
        coordinateFrame: {
          kind: 'machine',
          workOffsetMm: { x: -358, y: -268, z: 0 },
          nativeToBedOffsetMm: frame.nativeToBedOffsetMm,
        },
      },
    );
    expect(shown).toEqual({ x: 50, y: 238 });
  });

  it('avoids false out-of-bed warnings for verified native negative GRBL travel', () => {
    const base = projectFor('front-left');
    const project = {
      ...base,
      device: { ...base.device, homing: { enabled: true, direction: 'front-left' as const } },
    };
    const offset = { x: -300, y: -100 };
    const build = parseBuildInfoResponses(['[VER:1.1h.20190830:]', '[OPT:V,15,128]']);
    if (!build.ok) throw new Error('Build fixture');
    const motionOffset = trustedMotionOffsetForPreflight(
      project.device,
      {
        ok: true,
        jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
        preflightMotionOffset: offset,
      },
      {
        homingState: 'confirmed',
        activeControllerKind: 'grbl-v1.1',
        detectedControllerKind: 'grbl-v1.1',
        controllerSessionEpoch: 3,
        controllerSettingsObservation: { sessionEpoch: 3, observedAt: 1000 },
        controllerBuildInfoObservation: { sessionEpoch: 3, observedAt: 1000 },
        controllerBuildInfo: build.value,
        controllerSettings: {
          homingEnabled: true,
          homingDirectionMask: 3,
          bedWidth: 358,
          bedHeight: 268,
        },
      },
    );
    expect(motionOffset).toEqual({ x: 58, y: 168 });
    const output = emitGcode(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
      preflightMotionOffset: motionOffset,
    });
    const native = deriveMachineEnvelope({ x: 358, y: 268, z: 50 }, 3, false);
    for (const point of explicitXyWords(output.gcode)) {
      expect(point.x + offset.x).toBeGreaterThanOrEqual(native.x.minMm);
      expect(point.x + offset.x).toBeLessThanOrEqual(native.x.maxMm);
      expect(point.y + offset.y).toBeGreaterThanOrEqual(native.y.minMm);
      expect(point.y + offset.y).toBeLessThanOrEqual(native.y.maxMm);
    }
    expect(output.preflight.issues.some((issue) => issue.code === 'out-of-bed')).toBe(false);
  });
});
