// Audit track CN (2026-09-25) — the Machine Setup "Output dialect" select
// (DeviceSetupIdentifyStep.tsx ControllerContract, shown for CNC setups too)
// lists only laser dialects (GRBL Compatible/Dynamic/Raster, Neotronics 4040
// Safe; Marlin Inline/Fan). The CNC emitter ignores the device entirely
// (cnc-grbl-strategy.ts emitCncProgram(job, _device, ...)), so the choice has
// no effect on CNC output.
//
// Correct behaviour (proposed, low severity): label the select as the LASER
// output dialect, or hide it for a CNC-only setup, so a CNC user is not led to
// believe a CNC dialect is being chosen. This test only pins the fact; it
// passes on current code and would keep passing after a label change.

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
import { emitGcode } from '../../io/gcode/emit-gcode';

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

describe('CN: laser output dialect has no effect on CNC output (fact)', () => {
  it('emits byte-identical CNC G-code for every laser dialect choice', () => {
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
