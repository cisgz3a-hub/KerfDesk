import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import { isCounterClockwise } from '../geometry/polyline-orientation';
import { compileCncJob } from './compile-cnc-job';

// ADR-251: a new layer's default cut direction is climb. Verify the shipped
// default value, and that a default profile-outside cut compiles to a
// counter-clockwise (climb) toolpath regardless of the source winding.

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

describe('climb default (ADR-251)', () => {
  it('ships climb as the default cut direction', () => {
    expect(DEFAULT_CNC_LAYER_SETTINGS.cutDirection).toBe('climb');
  });

  it('emits a default profile-outside contour counter-clockwise', () => {
    const layer: Layer = {
      ...createLayer({ id: 'L', color: '#2563eb' }),
      // Leads off (ADR-250 is default-on) so the profile stays a plain contour
      // pass; this isolates the climb winding of the default settings.
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, profileLead: { shape: 'none' } },
    };
    const scene: Scene = { objects: [squareSvg()], layers: [layer] };
    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
    const pass = group.passes[0];
    if (pass?.kind !== 'contour') throw new Error('expected a contour pass');
    expect(isCounterClockwise({ closed: pass.closed, points: [...pass.polyline] })).toBe(true);
  });
});
