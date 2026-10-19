import { expect, it } from 'vitest';
import { normalizeExternalProgram, reviewExternalProgram } from '../../core/external-program';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { prepareExternalRun } from './prepare-external-run';

it('keeps Z-only point-Frame programs runnable with their warning and exact bytes', () => {
  const gcode = 'G21 G90\nG1 Z-1 F100\nM5\n';
  const normalized = normalizeExternalProgram(gcode);
  if (normalized.kind !== 'ok') throw new Error('normalization refused');
  const result = prepareExternalRun('drill.nc', normalized.program, (bytes) => {
    const model = buildGcodeRenderModel(bytes, { machineKind: 'cnc' });
    if (model.kind !== 'ok') throw new Error(model.reason);
    return reviewExternalProgram(bytes, model.model, { machineKind: 'cnc', laserMaxPowerS: 1000 });
  });
  if (result.kind !== 'ready') throw new Error(result.reasons.join());
  expect(result.run.gcode).toBe(gcode);
  expect(result.run.envelope).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  expect(result.review.warnings.join()).toContain('no XY outline to trace');
  expect(result.review.warnings.join()).toContain('assumes X0 Y0');
});
