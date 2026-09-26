// CN-4 (2026-09-25 controller audit): the Machine Setup output dialect shapes
// laser output only. CNC projects always emit through the GRBL CNC strategy,
// which ignores the device's dialect, so Machine Setup labels the choice
// "Laser output dialect" when the setup includes CNC. This pins the fact the
// label rests on. Moved from the audit's reproduction tests.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type GcodeDialectId } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

function cncProject(dialectId: GcodeDialectId): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    gcodeDialect: { dialectId },
    homing: { enabled: false, direction: 'front-left' },
  });
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: DEFAULT_CNC_LAYER_SETTINGS };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'imported-svg',
        id: 'O1',
        source: 'cn-dialect.svg',
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
      }),
      layer,
    ),
  };
}

describe('CNC output ignores the laser output dialect', () => {
  it('emits byte-identical CNC G-code for every GRBL dialect choice', () => {
    const dialects: ReadonlyArray<GcodeDialectId> = [
      'grbl-compatible',
      'grbl-dynamic',
      'grbl-raster',
      'neotronics-4040-safe',
    ];
    const outputs = dialects.map((dialectId) => emitGcode(cncProject(dialectId)).gcode);
    expect(outputs[0]).toContain('G4 P3.000');
    for (const output of outputs) expect(output).toBe(outputs[0]);
  });
});
