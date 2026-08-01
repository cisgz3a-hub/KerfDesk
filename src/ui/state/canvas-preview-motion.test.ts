import { describe, expect, it } from 'vitest';
import { EXECUTABLE_PLAN_CORPUS } from '../../__fixtures__/executable-plan-corpus';
import { buildExecutablePlan } from '../../core/execution-plan';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { canvasPreviewMotionSequence, registerCanvasExecutablePlan } from './canvas-preview-motion';

const GCODE = ['G21', 'G90', 'M3 S0', 'G0 X10 Y10', 'M3 S500', 'G1 X20', 'M5'].join('\n');

function executablePlan() {
  const result = buildExecutablePlan(GCODE, {
    machineKind: 'laser',
    controller: 'grbl',
    profileControllerKind: 'grbl-v1.1',
  });
  if (result.kind !== 'ok') throw new Error(`Expected plan, received ${result.kind}.`);
  return result.plan;
}

describe('canvasPreviewMotionSequence', () => {
  it.each(EXECUTABLE_PLAN_CORPUS)(
    'uses the immutable plan for the adversarial fixture: $name',
    (fixture) => {
      const result = buildExecutablePlan(fixture.gcode, {
        machineKind: fixture.machineKind,
        controller: fixture.controller,
      });
      if (result.kind !== 'ok') throw new Error(`Expected plan, received ${result.kind}.`);
      const canvasPlan = {
        manifest: buildMotionManifest(fixture.gcode, { machineKind: fixture.machineKind }),
      };
      registerCanvasExecutablePlan(canvasPlan, result.plan);
      const sequence = canvasPreviewMotionSequence(canvasPlan);

      expect(sequence.source).toBe('executable-plan');
      expect(sequence.motions).toBe(result.plan.motions);
      expect(sequence.totalRouteMm).toBe(result.plan.totals.routeMm);
    },
  );

  it('retains the legacy preview when the runtime start basis changes the route', () => {
    const manifest = buildMotionManifest(GCODE, {
      machineKind: 'laser',
      initialPosition: { x: 4, y: 6, z: 0 },
    });
    const canvasPlan = { manifest };
    registerCanvasExecutablePlan(canvasPlan, executablePlan());
    const sequence = canvasPreviewMotionSequence(canvasPlan);

    expect(sequence.source).toBe('legacy-manifest');
    expect(sequence.totalRouteMm).toBe(manifest.totalRouteMm);
    expect(sequence.motions.map(({ pointsMm }) => pointsMm)).toEqual(
      manifest.blocks.map(({ points }) => points),
    );
  });

  it('retains hand-built plans that have no ExecutablePlan sidecar', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    const sequence = canvasPreviewMotionSequence({ manifest });

    expect(sequence.source).toBe('legacy-manifest');
    expect(sequence.motions).toHaveLength(manifest.blocks.length);
  });
});
