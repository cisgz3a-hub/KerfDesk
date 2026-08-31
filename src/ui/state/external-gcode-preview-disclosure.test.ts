import { describe, expect, it } from 'vitest';
import {
  appendExternalGcodePreviewWarning,
  externalGcodePreviewStartWarning,
} from './external-gcode-preview-disclosure';

describe('external G-code preview disclosure', () => {
  it('prepends the exact preview-only warning to a Job Review model', () => {
    const warning = externalGcodePreviewStartWarning('fixture.nc');
    expect(appendExternalGcodePreviewWarning({ warnings: ['existing'] }, 'fixture.nc')).toEqual({
      warnings: [warning, 'existing'],
    });
  });

  it('leaves models unchanged when no external preview is active', () => {
    const model = { warnings: ['existing'] };
    expect(appendExternalGcodePreviewWarning(model, undefined)).toBe(model);
  });
});
