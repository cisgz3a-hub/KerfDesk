import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import {
  GRBL_DIALECT_CATALOG,
  resolveGcodeDialect,
  resolveGcodeDialectById,
} from './gcode-dialect';

describe('GRBL G-code dialect catalog', () => {
  it('defines the supported v1 dialect ids as data', () => {
    expect(GRBL_DIALECT_CATALOG.map((dialect) => dialect.dialectId)).toEqual([
      'grbl-compatible',
      'grbl-dynamic',
      'grbl-raster',
      'neotronics-4040-safe',
    ]);
  });

  it('resolves a profile dialect from the catalog and preserves air-assist override', () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      airAssistCommand: 'M8',
      gcodeDialect: {
        ...DEFAULT_DEVICE_PROFILE.gcodeDialect,
        dialectId: 'grbl-raster',
        airAssistCommand: 'none',
      },
    } as const;

    expect(resolveGcodeDialect(profile)).toMatchObject({
      dialectId: 'grbl-raster',
      emitSOnTravel: true,
      airAssistCommand: 'M8',
    });
  });

  it('keeps the Neotronics-safe dialect conservative through catalog resolution', () => {
    expect(resolveGcodeDialect(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)).toMatchObject({
      dialectId: 'neotronics-4040-safe',
      returnToOriginOnEnd: false,
      emitSOnEveryBurnMove: true,
      modalFeedrate: false,
      controlledLaserOffTravelFeedMmPerMin: 800,
      laserModeCommand: 'M4',
    });
  });

  it('falls back to GRBL-compatible behavior for unknown profile dialect ids', () => {
    expect(resolveGcodeDialectById('vendor-experimental')).toMatchObject({
      dialectId: 'grbl-compatible',
      laserModeCommand: 'mixed',
    });
  });
});
