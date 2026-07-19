import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { FALCON_COMPATIBLE_PROFILE } from '../devices/falcon-profiles';
import {
  fillRunwayPolicyForDevice,
  shouldAdvise4040FillPolicySelection,
} from './fill-runway-policy';

describe('fillRunwayPolicyForDevice', () => {
  it('keeps the generic/Falcon-compatible scanline policy unchanged', () => {
    expect(fillRunwayPolicyForDevice(DEFAULT_DEVICE_PROFILE)).toBeUndefined();
  });

  it('selects feed-matched sweep entry for the 4040-safe dialect', () => {
    expect(fillRunwayPolicyForDevice(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)).toBe(
      'feed-matched-entry',
    );
  });

  it('advises the ambiguous generic starter without identifying Falcon as a 4040', () => {
    expect(shouldAdvise4040FillPolicySelection(DEFAULT_DEVICE_PROFILE)).toBe(true);
    expect(shouldAdvise4040FillPolicySelection(FALCON_COMPATIBLE_PROFILE)).toBe(false);
  });

  it('advises a declared 4040 profile when its output dialect has drifted', () => {
    expect(
      shouldAdvise4040FillPolicySelection({
        ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        gcodeDialect: { dialectId: 'grbl-dynamic' },
      }),
    ).toBe(true);
    expect(shouldAdvise4040FillPolicySelection(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)).toBe(false);
  });
});
