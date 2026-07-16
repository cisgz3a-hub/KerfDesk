// A current-position CNC job is head-relative: on a no-homing machine work
// zero is just the power-on point, so the old park at X0 Y0 rapided blindly
// back across the bed at job end — operators read it as an uncommanded homing
// move. The emit seam must hand the resolved start position to the CNC
// strategy the same way it already does for the laser strategies.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

describe('CNC park position at the emit seam', () => {
  it('parks a current-position job at its start position, not work zero', () => {
    const { gcode, preflight } = emitGcode(cncProject(), {
      jobOrigin: {
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 120, y: 80 },
      },
    });

    expect(preflight.ok).toBe(true);
    expect(gcode.endsWith('M5\nG0 X120.000 Y80.000\n')).toBe(true);
    expect(gcode).not.toContain('G0 X0.000 Y0.000');
  });

  it('keeps the work-zero park for an absolute job', () => {
    const { gcode, preflight } = emitGcode(cncProject());

    expect(preflight.ok).toBe(true);
    expect(gcode.endsWith('M5\nG0 X0.000 Y0.000\n')).toBe(true);
  });
});

function cncProject(): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    homing: { enabled: false, direction: 'front-left' },
  });
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: DEFAULT_CNC_LAYER_SETTINGS,
  };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: addLayer(addObject(base.scene, squareObject()), layer),
  };
}

function squareObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'park-repro.svg',
    bounds: { minX: 10, minY: 10, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 60, y: 10 },
              { x: 60, y: 60 },
              { x: 10, y: 60 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}
