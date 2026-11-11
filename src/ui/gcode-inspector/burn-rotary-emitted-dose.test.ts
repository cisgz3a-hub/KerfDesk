import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, rotaryYScale, type RotarySetup } from '../../core/devices';
import { buildGcodeRenderModel, SEG_KIND } from '../../core/gcode-view';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { moveDoseJPerMm2, type BurnLaser } from './burn-grid';

// ADR-127 Amendment 2 locks the twins: the G-code inspector's dose model
// (burn-grid.ts surfaceFeed) and the emitted program now agree that a stroke
// round the part gets the same energy per surface mm² as one along it. Before,
// the inspector itself computed 15.9 % for a Y stroke on the Creality chuck
// (rolling audit v12 X8-P1-1).

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};
const ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 40,
  objectDiameterMm: 80,
  rollerDiameterMm: 25,
};

function rectangleProject(rotary: RotarySetup): Project {
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 20, minY: 20, maxX: 50, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 20, y: 20 },
              { x: 50, y: 20 },
              { x: 50, y: 40 },
              { x: 20, y: 40 },
              { x: 20, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary });
  return {
    ...base,
    scene: addLayer(addObject(base.scene, object), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

describe('the inspector dose of an emitted rotary job (ADR-127 Amd 2)', () => {
  it.each([
    ['Creality chuck, Ø80', CHUCK],
    ['roller Ø25, Ø80 part', ROLLER],
  ] as const)('%s: strokes round and along the part get the same dose', (_name, rotary) => {
    const emitted = emitGcode(rectangleProject(rotary));
    expect(emitted.preflight.ok).toBe(true);
    const parsed = buildGcodeRenderModel(emitted.gcode, { machineKind: 'laser' });
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const model = parsed.model;
    const laser: BurnLaser = {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      spotMm: 0.1,
      surfaceYScale: 1 / rotaryYScale(rotary),
    };
    const doses: number[] = [];
    for (let i = 0; i < model.segmentCount; i += 1) {
      if (model.segKind[i] !== SEG_KIND.cut) continue;
      doses.push(moveDoseJPerMm2(model, laser, i, 10));
    }
    // Two edges along X and two round the part.
    expect(doses).toHaveLength(4);
    const min = Math.min(...doses);
    const max = Math.max(...doses);
    // Only the whole-number F word separates them.
    expect(max / min).toBeLessThan(1.01);
  });
});
