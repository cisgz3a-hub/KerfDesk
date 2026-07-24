// ADR-253: retract-between-passes for profile/engrave "line" cuts. Verifies the
// per-layer setting resolves onto the compiled group and that the emitter lifts
// to safe Z and replunges before a deeper pass (default ON) instead of stepping
// Z down in place.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in (3.175 mm) bit

function square(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 90, y: 50 },
              { x: 90, y: 90 },
              { x: 50, y: 90 },
            ],
          },
        ],
      },
    ],
  };
}

function scene(cnc: Partial<CncLayerSettings>): Scene {
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return { objects: [square()], layers: [layer] };
}

function group(cnc: Partial<CncLayerSettings>): CncGroup {
  const compiled = compileCncJob(scene(cnc), dev, config).groups[0];
  if (compiled?.kind !== 'cnc') throw new Error('expected a cnc group');
  return compiled;
}

// A safe-Z retract sitting immediately before the deeper (-3.000) plunge.
const LIFT_BEFORE_DEEPER = /\nG0 Z[\d.]+\nG1 Z-3\.000 F/;

describe('retract between passes (ADR-253)', () => {
  it('resolves onto the compiled group: profile ON by default, pocket off, opt-out off', () => {
    const twoPass = { depthMm: 3, depthPerPassMm: 1.5 } as const;
    expect(group({ cutType: 'profile-outside', ...twoPass }).retractBetweenPasses).toBe(true);
    expect(group({ cutType: 'pocket', ...twoPass }).retractBetweenPasses ?? false).toBe(false);
    expect(
      group({ cutType: 'profile-outside', ...twoPass, retractBetweenPasses: false })
        .retractBetweenPasses,
    ).toBe(false);
  });

  it('lifts to safe Z before the deeper pass on a profile-on-path cut (default ON)', () => {
    const gcode = cncGrblStrategy.emit(
      compileCncJob(
        scene({ cutType: 'profile-on-path', depthMm: 3, depthPerPassMm: 1.5 }),
        dev,
        config,
      ),
      dev,
    );
    expect(gcode).toMatch(LIFT_BEFORE_DEEPER);
  });

  it('steps Z down in place when opted out', () => {
    const gcode = cncGrblStrategy.emit(
      compileCncJob(
        scene({
          cutType: 'profile-on-path',
          depthMm: 3,
          depthPerPassMm: 1.5,
          retractBetweenPasses: false,
        }),
        dev,
        config,
      ),
      dev,
    );
    expect(gcode).not.toMatch(LIFT_BEFORE_DEEPER);
  });
});
