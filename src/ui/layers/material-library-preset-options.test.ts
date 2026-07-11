import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { captureMaterialRecipe } from '../../core/material-library';
import { createLayer } from '../../core/scene';
import type { MaterialPreset } from '../../io/material-library';
import { materialLibraryPresetOptions } from './material-library-preset-options';

const INCOMPATIBLE_WARNING = 'Preset is not compatible with the active device profile.';

function preset(overrides: Partial<MaterialPreset>): MaterialPreset {
  return {
    id: 'p',
    materialName: 'Birch plywood',
    description: 'test preset',
    recipe: captureMaterialRecipe(createLayer({ id: 'L', color: '#ff0000' })),
    revision: 'rev-1',
    ...overrides,
  };
}

describe('materialLibraryPresetOptions', () => {
  it('marks a device-mismatched preset assignable but keeps the incompatible warning (ADR-045)', () => {
    const [option] = materialLibraryPresetOptions(DEFAULT_DEVICE_PROFILE, [
      preset({ id: 'other-machine', profileId: 'a-different-machine' }),
    ]);

    expect(option?.isAssignable).toBe(true); // warn, don't block
    expect(option?.warnings).toContain(INCOMPATIBLE_WARNING);
    expect(option?.statusText).toBe('not compatible');
  });

  it('keeps a matched-but-unsupported preset not assignable (a distinct safety block)', () => {
    const [option] = materialLibraryPresetOptions(DEFAULT_DEVICE_PROFILE, [
      preset({ id: 'unsupported', confidence: 'unsupported' }),
    ]);

    expect(option?.isAssignable).toBe(false);
  });
});
