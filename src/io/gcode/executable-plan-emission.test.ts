import { describe, expect, it } from 'vitest';
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
import { serializeExecutablePlan } from '../../core/execution-plan';
import { emitGcode } from './emit-gcode';
import { emitGcodeWithExecutablePlan } from './executable-plan-emission';

describe('emitGcodeWithExecutablePlan', () => {
  it('round-trips current laser output with zero character changes', () => {
    const project = laserProject();
    const current = emitGcode(project);

    const planned = emitGcodeWithExecutablePlan(project);

    expect(planned.gcode).toBe(current.gcode);
    expect(planned.preflight).toEqual(current.preflight);
    expect(planned.sidecar.kind).toBe('ok');
    if (planned.sidecar.kind !== 'ok') return;
    expect(serializeExecutablePlan(planned.sidecar.plan)).toBe(current.gcode);
    expect(planned.sidecar.parity.ok).toBe(true);
    expect(planned.sidecar.plan.machineKind).toBe('laser');
  });

  it('round-trips current CNC output and preserves explicit terminal parking', () => {
    const project = cncProject();
    const current = emitGcode(project);

    const planned = emitGcodeWithExecutablePlan(project);

    expect(planned.gcode).toBe(current.gcode);
    expect(planned.preflight).toEqual(current.preflight);
    expect(planned.sidecar.kind).toBe('ok');
    if (planned.sidecar.kind !== 'ok') return;
    expect(planned.sidecar.plan.machineKind).toBe('cnc');
    expect(planned.sidecar.plan.controller.emitter).toBe('grbl-cnc');
    expect(planned.sidecar.plan.motions.at(-1)?.intent).toBe('park');
    expect(planned.sidecar.parity.ok).toBe(true);
  });

  it('keeps a refused emission unchanged and reports no sidecar', () => {
    const project = createProject();
    const options = {
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: [],
      },
    } as const;
    const current = emitGcode(project, options);

    const planned = emitGcodeWithExecutablePlan(project, options);

    expect(planned.gcode).toBe(current.gcode);
    expect(planned.preflight).toEqual(current.preflight);
    expect(planned.sidecar).toEqual({ kind: 'unavailable', reason: 'no-gcode' });
  });
});

function laserProject(): Project {
  const base = createProject();
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, squareObject()),
      createLayer({ id: 'L1', color: '#ff0000' }),
    ),
  };
}

function cncProject(): Project {
  const base = createProject();
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: addLayer(addObject(base.scene, squareObject()), {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      cnc: DEFAULT_CNC_LAYER_SETTINGS,
    }),
  };
}

function squareObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'plan-square.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 20 },
              { x: 10, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}
