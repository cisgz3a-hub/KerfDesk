import { describe, expect, it } from 'vitest';

import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import { createProject } from '../../core/scene';
import { prepareOutput, type PreparedOutput } from '../../io/gcode';
import { emitSavePreparedOutput } from './save-output-emission';

const FAILURE_MESSAGE = 'The output snapshot could not be prepared.';

describe('emitSavePreparedOutput', () => {
  it('retains a failed preparation instead of inferring from emitted text', () => {
    const prepared: PreparedOutput = {
      ok: false,
      preflight: {
        ok: false,
        issues: [{ code: 'variable-evaluation-failed', message: FAILURE_MESSAGE }],
      },
    };

    expect(emitSavePreparedOutput(prepared, {})).toEqual({
      kind: 'preparation-failed',
      gcode: '',
      preflight: prepared.preflight,
    });
  });

  it('keeps ordinary empty-output in the canonical emitted-preflight partition', () => {
    const result = emitSavePreparedOutput(prepareOutput(createProject()), {});

    expect(result.kind).toBe('emitted');
    expect(result.preflight.issues.map((issue) => issue.code)).toContain('empty-output');
  });

  it('retains a post-prepare rotary raster refusal as non-writable', () => {
    const project = rotaryRasterSaveProject();
    const result = emitSavePreparedOutput(prepareOutput(project), {});

    expect(result).toMatchObject({
      kind: 'emission-refused',
      gcode: '',
      preflight: { issues: [{ code: 'rotary-raster-unsupported' }] },
    });
  });

  it('emits rotary raster bytes when the Labs permission is explicit', () => {
    const project = rotaryRasterSaveProject();
    const result = emitSavePreparedOutput(prepareOutput(project), {
      allowRotaryRaster: true,
    });

    expect(result.kind).toBe('emitted');
    expect(result.preflight.issues).toEqual([]);
    expect(result.gcode).toMatchSnapshot();
  });
});
