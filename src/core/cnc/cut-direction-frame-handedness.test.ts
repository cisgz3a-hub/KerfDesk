// Cut direction must be a PHYSICAL fact, not a numeric one.
//
// `enforceCutDirection` (motion-polish.ts) forces a shoelace sign on toolpaths
// that `collect-cnc-contours.ts:74` has ALREADY pushed through
// `toMachineCoords`. For two of the five supported origins the machine number
// frame is a MIRROR of the physical bed frame, so a fixed numeric winding is
// two different physical travel directions depending on the origin.
//
// Handedness comes from the tree's own jog semantics: `jogAxisSignsForOrigin`
// maps "operator's right" and "away from the operator" onto machine axis signs,
// and jog-direction.test.ts pins those signs to origin-transform's linear part.
// The determinant (x * y) is therefore the handedness of the machine frame:
//
//   front-left  ( 1,  1) -> +1  right-handed
//   front-right (-1,  1) -> -1  MIRRORED
//   rear-left   ( 1, -1) -> -1  MIRRORED
//   rear-right  (-1, -1) -> +1  right-handed
//   center      ( 1,  1) -> +1  right-handed
//
// Mapping machine points back through those signs gives a frame in which +X is
// the operator's right and +Y is away from the operator — the standard
// view-from-above orientation, where a positive shoelace is counter-clockwise.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  jogAxisSignsForOrigin,
  type DeviceProfile,
  type Origin,
} from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutDirection,
  type CncCutType,
  type ImportedSvg,
  type Layer,
  type Scene,
  type Vec2,
} from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { compileCncJob } from './compile-cnc-job';

const ALL_ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

const MIRRORED_ORIGINS: ReadonlyArray<Origin> = ['front-right', 'rear-left'];

const SQUARE_MIN_MM = 50;
const SQUARE_MAX_MM = 70;

function squareSvg(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: SQUARE_MIN_MM, minY: SQUARE_MIN_MM, maxX: SQUARE_MAX_MM, maxY: SQUARE_MAX_MM },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
        polylines: [
          {
            closed: true,
            points: [
              { x: SQUARE_MIN_MM, y: SQUARE_MIN_MM },
              { x: SQUARE_MAX_MM, y: SQUARE_MIN_MM },
              { x: SQUARE_MAX_MM, y: SQUARE_MAX_MM },
              { x: SQUARE_MIN_MM, y: SQUARE_MAX_MM },
            ],
          },
        ],
      },
    ],
  };
}

function layerFor(cutType: CncCutType, cutDirection: CncCutDirection): Layer {
  return {
    ...createLayer({ id: 'L', color: '#2563eb' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType,
      cutDirection,
      // Leads and tabs would turn the contour into a path3d and hide the
      // winding under test (same isolation the climb-default test uses).
      tabsEnabled: false,
      profileLead: { shape: 'none' },
    },
  };
}

function deviceWith(origin: Origin): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, origin };
}

// Signed area of the compiled toolpath expressed in the OPERATOR's frame
// (+X right, +Y away). Positive = counter-clockwise seen from above.
function physicalSignedArea(points: ReadonlyArray<Vec2>, origin: Origin): number {
  const signs = jogAxisSignsForOrigin(origin);
  return signedAreaMm2(points.map((p) => ({ x: signs.x * p.x, y: signs.y * p.y })));
}

function compiledContour(origin: Origin, cutType: CncCutType, direction: CncCutDirection): Vec2[] {
  const scene: Scene = { objects: [squareSvg()], layers: [layerFor(cutType, direction)] };
  const job = compileCncJob(scene, deviceWith(origin), DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error(`expected a cnc group for ${origin}`);
  const pass = group.passes[0];
  if (pass?.kind !== 'contour') throw new Error(`expected a contour pass for ${origin}`);
  return [...pass.polyline];
}

describe('cut direction is origin-independent in the physical frame', () => {
  // Guards the premise of every assertion below: exactly front-right and
  // rear-left mirror the machine frame. If an origin is added or its jog signs
  // change, this fails first and points at the real cause.
  it('identifies exactly front-right and rear-left as mirrored frames', () => {
    const mirrored = ALL_ORIGINS.filter((origin) => {
      const signs = jogAxisSignsForOrigin(origin);
      return signs.x * signs.y === -1;
    });
    expect(mirrored).toEqual(MIRRORED_ORIGINS);
  });

  // ADR-251 as amended: climb keeps the material on the RIGHT of travel, so an
  // exterior is walked CLOCKWISE — physically, on every machine.
  it.each(ALL_ORIGINS)('walks a profile-outside climb cut clockwise on %s', (origin) => {
    const area = physicalSignedArea(compiledContour(origin, 'profile-outside', 'climb'), origin);
    expect(Math.sign(area)).toBe(-1);
  });

  it.each(ALL_ORIGINS)('walks a profile-outside conventional cut counter-clockwise on %s', (o) => {
    const area = physicalSignedArea(compiledContour(o, 'profile-outside', 'conventional'), o);
    expect(Math.sign(area)).toBe(1);
  });

  // A hole's material lies OUTSIDE its boundary, so its climb direction mirrors
  // the exterior case ("Inside … Climb (CCW)").
  it.each(ALL_ORIGINS)('walks a profile-inside climb cut counter-clockwise on %s', (origin) => {
    const area = physicalSignedArea(compiledContour(origin, 'profile-inside', 'climb'), origin);
    expect(Math.sign(area)).toBe(1);
  });

  it.each(ALL_ORIGINS)('walks a pocket climb cut counter-clockwise on %s', (origin) => {
    const area = physicalSignedArea(compiledContour(origin, 'pocket', 'climb'), origin);
    expect(Math.sign(area)).toBe(1);
  });

  // The strongest statement of the invariant: the operator gets the same
  // physical motion whatever corner the machine homes at.
  it('gives every origin the same physical winding for the same job', () => {
    const signsByOrigin = ALL_ORIGINS.map((origin) =>
      Math.sign(physicalSignedArea(compiledContour(origin, 'profile-outside', 'climb'), origin)),
    );
    expect(new Set(signsByOrigin).size).toBe(1);
  });
});
