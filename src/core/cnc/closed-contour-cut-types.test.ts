// Pins the predicate to what the compiler ACTUALLY does, by compiling a layer
// of open contours under every cut type. Written this way because the list is
// a claim about output: a hand-maintained set would silently rot the moment an
// operation learned to handle open paths, and the layers-panel note would then
// tell the operator something untrue.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncPassXyPoints } from '../job';
import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutType,
  type CncTool,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import { cutTypeNeedsClosedContours } from './closed-contour-cut-types';
import { compileCncJob } from './compile-cnc-job';

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

const OPEN: Polyline = {
  closed: false,
  points: [
    { x: 50, y: 50 },
    { x: 70, y: 50 },
    { x: 70, y: 62 },
  ],
};

const CLOSED: Polyline = { ...OPEN, closed: true, points: [...OPEN.points, { x: 50, y: 62 }] };

// inlay-pair needs a second layer to pair with, and the relief cut types are
// compile-time only (produced from relief objects, never chosen on artwork),
// so neither is a meaningful subject for an open-vs-closed comparison.
const NOT_APPLICABLE: ReadonlySet<CncCutType> = new Set<CncCutType>([
  'inlay-pair',
  'relief-rough',
  'relief-finish',
]);

function scene(polyline: Polyline, cutType: CncCutType): Scene {
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType, depthMm: 2, depthPerPassMm: 2 },
  };
  return {
    objects: [
      {
        kind: 'imported-svg',
        id: 'O1',
        source: 'O1.svg',
        bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: [polyline] }],
      },
    ],
    layers: [layer],
  };
}

function motionPointCount(polyline: Polyline, cutType: CncCutType): number {
  const job = compileCncJob(scene(polyline, cutType), DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [VBIT_90],
    toolId: VBIT_90.id,
  });
  return job.groups
    .filter((group) => group.kind === 'cnc')
    .reduce(
      (total, group) =>
        total + group.passes.reduce((sum, pass) => sum + cncPassXyPoints(pass).length, 0),
      0,
    );
}

describe('cutTypeNeedsClosedContours', () => {
  for (const cutType of CNC_CUT_TYPES) {
    if (NOT_APPLICABLE.has(cutType)) continue;

    it(`matches what ${cutType} actually emits from an open contour`, () => {
      const fromOpen = motionPointCount(OPEN, cutType);
      // The closed control proves the fixture compiles at all, so a zero from
      // the open case means "open paths gave it nothing", not "nothing works".
      expect(motionPointCount(CLOSED, cutType)).toBeGreaterThan(0);
      expect(fromOpen === 0).toBe(cutTypeNeedsClosedContours(cutType));
    });
  }
});
