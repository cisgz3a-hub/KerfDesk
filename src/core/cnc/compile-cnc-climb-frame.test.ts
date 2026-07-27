import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords, type DeviceProfile, type Origin } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { compileCncJob } from './compile-cnc-job';

// ADR-251 defaults profile cuts to climb, and climb is defined against the
// spindle's PHYSICAL rotation seen from above — so the guarantee has to hold in
// the operator's top view, not in whichever machine frame the origin corner
// happens to produce. `origin-transform` gives rear-* origins a machine +Y that
// points AT the operator and right-* origins a mirrored +X, so two of the five
// corners yield a left-handed machine frame. Every origin must still cut climb.
//
// Per ADR-251 Amendment 1, climb keeps the material on the RIGHT of travel, so
// an OUTSIDE profile cutting climb runs CW seen from above and conventional
// runs CCW. That amendment fixed which winding each direction means; this suite
// fixes the frame it is measured in, so both must hold together.

const ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

function squareSvg(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: 50, minY: 50, maxX: 70, maxY: 70 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 70, y: 50 },
              { x: 70, y: 70 },
              { x: 50, y: 70 },
            ],
          },
        ],
      },
    ],
  };
}

// The scene frame is Y-DOWN over a canvas that is a top view of the bed, so a
// physically counter-clockwise loop (viewed from above) has a NEGATIVE shoelace
// area once mapped back out of machine coordinates.
function isPhysicallyCounterClockwise(
  machinePoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  device: DeviceProfile,
): boolean {
  return signedAreaMm2(machinePoints.map((point) => toSceneCoords(point, device))) < 0;
}

function compileDefaultProfileOutside(origin: Origin): ReadonlyArray<{ x: number; y: number }> {
  const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin };
  const layer: Layer = {
    ...createLayer({ id: 'L', color: '#2563eb' }),
    // cutType is explicit: ADR-256 moved the DEFAULT to 'profile-on-path', for
    // which wantsCounterClockwise returns null and enforcement is a no-op, so
    // leaving it defaulted would make this suite pass vacuously.
    // Leads off so the profile stays a plain contour pass and the winding of
    // the climb setting is what is under test.
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      profileLead: { shape: 'none' },
    },
  };
  const scene: Scene = { objects: [squareSvg()], layers: [layer] };
  const job = compileCncJob(scene, device, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error(`expected a cnc group for ${origin}`);
  const pass = group.passes[0];
  if (pass?.kind !== 'contour') throw new Error(`expected a contour pass for ${origin}`);
  return [...pass.polyline];
}

describe('climb default across origin corners (ADR-251)', () => {
  it.each(ORIGINS)('cuts a profile-outside climb CW on a %s origin', (origin) => {
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin };
    expect(isPhysicallyCounterClockwise(compileDefaultProfileOutside(origin), device)).toBe(false);
  });

  it.each(ORIGINS)('cuts an explicit conventional profile-outside CCW on a %s origin', (origin) => {
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin };
    const layer: Layer = {
      ...createLayer({ id: 'L', color: '#2563eb' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-outside',
        cutDirection: 'conventional',
        profileLead: { shape: 'none' },
      },
    };
    const scene: Scene = { objects: [squareSvg()], layers: [layer] };
    const job = compileCncJob(scene, device, DEFAULT_CNC_MACHINE_CONFIG);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
    const pass = group.passes[0];
    if (pass?.kind !== 'contour') throw new Error('expected a contour pass');
    expect(isPhysicallyCounterClockwise([...pass.polyline], device)).toBe(true);
  });
});
