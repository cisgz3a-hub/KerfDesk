import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { fillRunwayPolicyForDevice } from './fill-runway-policy';

describe('fillRunwayPolicyForDevice', () => {
  it('keeps the generic/Falcon-compatible scanline policy unchanged', () => {
    expect(fillRunwayPolicyForDevice(DEFAULT_DEVICE_PROFILE)).toBeUndefined();
  });

  it('selects feed-matched sweep entry for the 4040-safe dialect', () => {
    expect(fillRunwayPolicyForDevice(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)).toBe(
      'feed-matched-entry',
    );
  });
});
