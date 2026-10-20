import { expect, it } from 'vitest';
import { normalizeExternalProgram, reviewExternalProgram } from '../../core/external-program';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { prepareExternalRun } from './prepare-external-run';

it('keeps Z-only point-Frame programs runnable with their warning and exact bytes', () => {
  const gcode = 'G21 G90\nG1 Z-1 F100\nM5\n';
  const normalized = normalizeExternalProgram(gcode);
  if (normalized.kind !== 'ok') throw new Error('normalization refused');
  const start = { x: 0, y: 0, z: 0 };
  // Read from where the head stands, as the Run dialog does.
  const result = prepareExternalRun('drill.nc', normalized.program, start, (bytes) => {
    const model = buildGcodeRenderModel(bytes, { machineKind: 'cnc', initialPositionMm: start });
    if (model.kind !== 'ok') throw new Error(model.reason);
    return reviewExternalProgram(bytes, model.model, {
      machineKind: 'cnc',
      laserMaxPowerS: 1000,
    });
  });
  if (result.kind !== 'ready') throw new Error(result.reasons.join());
  expect(result.run.gcode).toBe('G17G21G90G94G0\nG21G90\nG1Z-1F100\nM5\n');
  expect(result.run.start).toEqual(start);
  expect(result.run.envelope).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const warnings = result.review.warnings.join();
  expect(warnings).toContain('no XY outline to trace');
  expect(warnings).toContain('never sets X or Y, so it runs where the head stands now');
  // The plunge from the head's height is Z motion, so no other-mode warning.
  expect(warnings).not.toContain('never moves Z');
});
