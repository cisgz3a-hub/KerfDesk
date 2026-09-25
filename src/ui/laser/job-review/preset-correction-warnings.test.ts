import { describe, expect, it } from 'vitest';
import { XTOOL_D1_PRO_PROFILES } from '../../../core/devices/brand-laser-profiles';
import { detectPresetCorrectionWarnings } from './preset-correction-warnings';

describe('detectPresetCorrectionWarnings', () => {
  it('tells the operator a saved preset copy predates a correction', () => {
    const [preset] = XTOOL_D1_PRO_PROFILES;
    if (preset === undefined) throw new Error('missing preset');
    const [warning] = detectPresetCorrectionWarnings({ ...preset, origin: 'front-left' });
    expect(warning).toContain(`copy of the ${preset.name} preset saved before`);
    expect(warning).toContain('origin front-left, and the preset now uses rear-left');
    expect(warning).toContain('mirrored front to back');
    expect(detectPresetCorrectionWarnings(preset)).toEqual([]);
  });
});
