import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_GCODE_DIALECTS,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  resolveGrblDialect,
} from './index';

describe('GRBL G-code dialect catalog', () => {
  it('ships the staged dialect ids without exposing arbitrary templates', () => {
    expect(GRBL_GCODE_DIALECTS.map((dialect) => dialect.id)).toEqual([
      'grbl-compatible',
      'grbl-dynamic',
      'grbl-raster',
      'neotronics-4040-safe',
    ]);
  });

  it('resolves built-in profiles to data-driven dialect definitions', () => {
    expect(DEFAULT_DEVICE_PROFILE.gcodeDialect.dialectId).toBe('grbl-dynamic');
    expect(resolveGrblDialect(DEFAULT_DEVICE_PROFILE).id).toBe('grbl-dynamic');
    expect(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.gcodeDialect.dialectId).toBe(
      'neotronics-4040-safe',
    );
    expect(resolveGrblDialect(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE).requiresS0OnRapid).toBe(true);
  });
});
