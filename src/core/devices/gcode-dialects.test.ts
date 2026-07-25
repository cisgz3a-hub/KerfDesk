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

  // ADR-256: the default and raster dialects cut with M4 dynamic power so energy per
  // mm stays flat through an accelerating corner. grbl-compatible stays constant as the
  // escape hatch for firmware without M4 (GRBL 1.1e and older); neotronics-4040-safe
  // stays constant pending its own hardware pass.
  it('cuts dynamically on the default and raster dialects only', () => {
    const cutModeById = Object.fromEntries(
      GRBL_GCODE_DIALECTS.map((dialect) => [dialect.id, dialect.cutPowerMode]),
    );
    expect(cutModeById).toEqual({
      'grbl-compatible': 'constant',
      'grbl-dynamic': 'dynamic',
      'grbl-raster': 'dynamic',
      'neotronics-4040-safe': 'constant',
    });
  });

  it('defaults only absent dialect selections and rejects explicit unknown ids', () => {
    expect(resolveGrblDialect({}).id).toBe('grbl-dynamic');
    expect(() => resolveGrblDialect({ gcodeDialect: { dialectId: 'unknown' } })).toThrow(
      /Unknown GRBL G-code dialect/,
    );
  });
});
