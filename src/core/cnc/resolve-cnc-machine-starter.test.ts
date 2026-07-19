import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { resolveCncMachineStarter } from './resolve-cnc-machine-starter';

describe('resolveCncMachineStarter', () => {
  it('returns the profile starter with identity provenance', () => {
    const result = resolveCncMachineStarter({
      profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    });

    expect(result).toMatchObject({
      feedMmPerMin: 600,
      plungeMmPerMin: 120,
      spindleRpm: 12000,
      depthPerPassMm: 0.75,
      provenance: {
        source: 'machine-starter-catalog',
        starterId: 'neotronics-4040-shallow-wood-mdf',
        matchedBy: 'profile-id',
        matchedValue: 'neotronics-4040-max-lt4lds-v2-20w',
      },
    });
    expect(result?.provenance.capDetails).toEqual([
      {
        field: 'feedMmPerMin',
        source: 'profile.maxFeed',
        limit: 6000,
        valueBefore: 600,
        valueAfter: 600,
        didLimit: false,
      },
      {
        field: 'spindleRpm',
        source: 'profile.cncSubProfile.spindleMaxRpm',
        limit: 12000,
        valueBefore: 12000,
        valueAfter: 12000,
        didLimit: false,
      },
    ]);
  });

  it('uses the slower live XY axis and the independent Z and spindle limits', () => {
    const result = resolveCncMachineStarter({
      profile: {
        ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        maxFeed: 500,
        cncSubProfile: {
          ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.cncSubProfile,
          safeZMm: 3.81,
          spindleMaxRpm: 11000,
          spindleSpinupSec: 3,
        },
      },
      liveCaps: {
        xMaxFeedMmPerMin: 550,
        yMaxFeedMmPerMin: 450,
        zMaxFeedMmPerMin: 100,
        spindleMaxRpm: 9000,
      },
    });

    expect(result).toMatchObject({
      feedMmPerMin: 450,
      plungeMmPerMin: 100,
      spindleRpm: 9000,
      depthPerPassMm: 0.75,
    });
    expect(result?.provenance.capDetails.filter((detail) => detail.didLimit)).toEqual([
      expect.objectContaining({ source: 'profile.maxFeed', valueAfter: 500 }),
      expect.objectContaining({ source: 'controller.$110/$111', limit: 450, valueAfter: 450 }),
      expect.objectContaining({ source: 'controller.$112', valueAfter: 100 }),
      expect.objectContaining({
        source: 'profile.cncSubProfile.spindleMaxRpm',
        valueAfter: 11000,
      }),
      expect.objectContaining({ source: 'controller.$30', valueAfter: 9000 }),
    ]);
  });

  it('uses the one reported XY axis and ignores invalid live limits', () => {
    const result = resolveCncMachineStarter({
      profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      liveCaps: {
        xMaxFeedMmPerMin: 500,
        yMaxFeedMmPerMin: Number.NaN,
        zMaxFeedMmPerMin: 0,
        spindleMaxRpm: Number.POSITIVE_INFINITY,
      },
    });

    expect(result).toMatchObject({
      feedMmPerMin: 500,
      plungeMmPerMin: 120,
      spindleRpm: 12000,
    });
    expect(result?.provenance.capDetails.map((detail) => detail.source)).toEqual([
      'profile.maxFeed',
      'controller.$110/$111',
      'profile.cncSubProfile.spindleMaxRpm',
    ]);
  });

  it('records the CNC machine spindle ceiling separately from profile and controller caps', () => {
    const result = resolveCncMachineStarter({
      profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      machineSpindleMaxRpm: 8_000,
    });

    expect(result?.spindleRpm).toBe(8_000);
    expect(result?.provenance.capDetails).toContainEqual({
      field: 'spindleRpm',
      source: 'machine.params.spindleMaxRpm',
      limit: 8_000,
      valueBefore: 12_000,
      valueAfter: 8_000,
      didLimit: true,
    });
  });

  it('returns null for a profile without a catalog starter', () => {
    expect(
      resolveCncMachineStarter({
        profile: {
          profileId: 'generic-grbl-400x400',
          maxFeed: 6000,
        },
      }),
    ).toBeNull();
  });
});
