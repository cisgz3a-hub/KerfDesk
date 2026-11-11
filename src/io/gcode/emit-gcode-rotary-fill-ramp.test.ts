import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
  type RotarySetup,
} from '../../core/devices';
import { compileJob, type JobOriginPlacement, type RasterGroup } from '../../core/job';
import { applyRotaryYScale, jobYRange } from '../../core/job/rotary-transform';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { splitGcodeLayerSections } from '../../core/invariants';
import { emitGcode } from './emit-gcode';

// ADR-699 Amendment 1 (rolling audit v14 Z3-P1-1): a ramped Fill burns as a
// raster, and on a rotary every raster scans along X (ADR-492 D9). A ramped
// Fill drawn at 45°, with Cross-hatch or an angle per pass, must therefore burn
// exactly as the same Fill at 0° does, which lands on the design, and must not
// move the job's other layers.

const DIAMETER = 80;
const Y_CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: DIAMETER,
};
const A_CHUCK: RotarySetup = { ...Y_CHUCK, axis: 'A', mmPerRotation: 360 };
const Z_CHUCK: RotarySetup = { ...Y_CHUCK, axis: 'Z' };

const ROTARIES: ReadonlyArray<readonly [string, RotarySetup, ControllerKind]> = [
  ['Y port', Y_CHUCK, 'grbl-v1.1'],
  ['A axis', A_CHUCK, 'grblhal'],
  ['Z axis', Z_CHUCK, 'grbl-v1.1'],
];

const PLACEMENTS: ReadonlyArray<readonly [string, JobOriginPlacement | undefined]> = [
  ['Absolute', undefined],
  [
    'Current Position',
    { startFrom: 'current-position', anchor: 'center', currentPosition: { x: 100, y: 80 } },
  ],
];

function square(id: string, color: string, minX: number, minY: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX, minY, maxX: minX + 20, maxY: minY + 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: minX, y: minY },
              { x: minX + 20, y: minY },
              { x: minX + 20, y: minY + 20 },
              { x: minX, y: minY + 20 },
              { x: minX, y: minY },
            ],
          },
        ],
      },
    ],
  };
}

function project(
  rotary: RotarySetup,
  controllerKind: ControllerKind,
  fill: Partial<Layer>,
): Project {
  const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind, rotary };
  const base = createProject(device);
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: [square('F1', '#0000ff', 60, 20), square('L1', '#ff0000', 100, 20)],
      layers: [
        {
          ...createLayer({ id: 'fill', color: '#0000ff', mode: 'fill' }),
          hatchSpacingMm: 0.5,
          power: 60,
          minPower: 10,
          fillRampLengthMm: 2,
          ...fill,
        },
        createLayer({ id: 'line', color: '#ff0000' }),
      ],
    },
  };
}

const TURNED: ReadonlyArray<readonly [string, Partial<Layer>]> = [
  ['45°', { hatchAngleDeg: 45 }],
  ['30° with Cross-hatch', { hatchAngleDeg: 30, fillCrossHatch: true }],
  ['0° with 45° per pass', { passes: 2, passAngleStepDeg: 45 }],
];

describe('ramped Fill on a rotary (ADR-699 Amd 1, Z3-P1-1)', () => {
  for (const [rotaryName, rotary, controller] of ROTARIES) {
    for (const [placementName, placement] of PLACEMENTS) {
      for (const [turnName, turn] of TURNED) {
        it(`${rotaryName}, ${placementName}: a ${turnName} ramp burns as the 0° ramp does`, () => {
          const options = placement === undefined ? {} : { jobOrigin: placement };
          const along = emitGcode(
            project(rotary, controller, {
              ...turn,
              hatchAngleDeg: 0,
              fillCrossHatch: false,
              passAngleStepDeg: 0,
            }),
            options,
          );
          const turned = emitGcode(project(rotary, controller, turn), options);
          expect(along.preflight.ok).toBe(true);
          expect(turned.preflight.ok).toBe(true);
          expect(turned.gcode).toBe(along.gcode);
        });
      }
    }
  }

  it('keeps the Line layer on the design (the bug moved it 160° round the part)', () => {
    const lineTurns = (fill: Partial<Layer>, withFill = true): number[] => {
      const scene = project(A_CHUCK, 'grblhal', fill).scene;
      const only: Project = {
        ...project(A_CHUCK, 'grblhal', fill),
        scene: withFill ? scene : { ...scene, objects: scene.objects.filter((o) => o.id === 'L1') },
      };
      const section = splitGcodeLayerSections(emitGcode(only).gcode).find(
        (candidate) => candidate.layerId === 'line',
      );
      return [...(section?.body ?? '').matchAll(/A(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    };
    const alone = lineTurns({}, false);
    const beside = lineTurns({ hatchAngleDeg: 45 });
    expect(alone.length).toBeGreaterThan(0);
    expect(Math.min(...beside)).toBeCloseTo(Math.min(...alone), 0);
    expect(Math.max(...beside)).toBeCloseTo(Math.max(...alone), 0);
  });

  it('scans the ramp along X on a rotary and says why', () => {
    const job = compileJob(project(A_CHUCK, 'grblhal', { hatchAngleDeg: 45 }).scene, {
      ...DEFAULT_DEVICE_PROFILE,
      rotary: A_CHUCK,
    });
    const rasters = job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
    expect(rasters).toHaveLength(1);
    expect(rasters[0]?.scanAngleDeg).toBeUndefined();
    expect(job.diagnostics).toContainEqual({
      kind: 'fill-ramp-scan-angle-rotary',
      layerName: 'Operation',
    });
  });

  it('stays silent, and keeps its angle, at 0° or off the rotary', () => {
    const at0 = compileJob(project(A_CHUCK, 'grblhal', {}).scene, {
      ...DEFAULT_DEVICE_PROFILE,
      rotary: A_CHUCK,
    });
    expect(at0.diagnostics ?? []).toEqual([]);
    const flat = compileJob(
      project(A_CHUCK, 'grblhal', { hatchAngleDeg: 45 }).scene,
      DEFAULT_DEVICE_PROFILE,
    );
    const raster = flat.groups.find((group): group is RasterGroup => group.kind === 'raster');
    expect(raster?.scanAngleDeg).toBe(45);
  });

  it('reads a turned raster by its machine extent and never scales one round the part', () => {
    const compiled = (angle: number) =>
      compileJob(
        project(A_CHUCK, 'grblhal', { hatchAngleDeg: angle }).scene,
        DEFAULT_DEVICE_PROFILE,
      );
    const turned = compiled(90);
    const along = jobYRange(compiled(0));
    const range = jobYRange(turned);
    // The same square on the bed, whichever frame its raster rows run in.
    expect(range?.min).toBeCloseTo(along?.min ?? Number.NaN, 0);
    expect(range?.max).toBeCloseTo(along?.max ?? Number.NaN, 0);
    expect(() => applyRotaryYScale(turned, 2)).toThrow(
      /scanned at an angle cannot run on a rotary/,
    );
  });
});
