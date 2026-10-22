import { describe, expect, it } from 'vitest';
import { XTOOL_D1_PRO_PROFILES } from '../../../core/devices/brand-laser-profiles';
import {
  FALCON_A1_PRO_GRBLHAL_PROFILE,
  FALCON_COMPATIBLE_PROFILE,
} from '../../../core/devices/falcon-profiles';
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

  it('names the bed of a Falcon A1 Pro copy saved before the model split (ADR-660)', () => {
    const [warning] = detectPresetCorrectionWarnings({
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      bedWidth: 400,
      bedHeight: 400,
    });
    expect(warning).toContain('bed 400 x 400 mm, and the preset now uses 358 x 268 mm');
  });

  it('tells the operator a saved copy of a withdrawn preset keeps its work area (ADR-660)', () => {
    const [warning] = detectPresetCorrectionWarnings(FALCON_COMPATIBLE_PROFILE);
    expect(warning).toContain(`copy of the ${FALCON_COMPATIBLE_PROFILE.name} preset`);
    expect(warning).toContain('Machine Setup no longer lists');
    expect(warning).toContain('Falcon A1 at 305 x 381 mm');
    expect(detectPresetCorrectionWarnings({ ...FALCON_COMPATIBLE_PROFILE, bedWidth: 381 })).toEqual(
      [],
    );
  });
});
