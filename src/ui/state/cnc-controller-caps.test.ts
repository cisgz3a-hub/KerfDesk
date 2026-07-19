import { describe, expect, it } from 'vitest';
import { cncLiveCapsFromController } from './cnc-controller-caps';

describe('cncLiveCapsFromController', () => {
  it('ignores $30 as a spindle ceiling while the controller is in laser mode', () => {
    expect(
      cncLiveCapsFromController({
        maxFeedX: 2200,
        maxFeedY: 1800,
        zMaxFeed: 300,
        maxPowerS: 1000,
        laserModeEnabled: true,
      }),
    ).toEqual({
      xMaxFeedMmPerMin: 2200,
      yMaxFeedMmPerMin: 1800,
      zMaxFeedMmPerMin: 300,
    });
  });

  it('uses $30 as a spindle ceiling when the controller reports CNC mode', () => {
    expect(
      cncLiveCapsFromController({
        maxFeedX: 2200,
        maxFeedY: 1800,
        zMaxFeed: 300,
        maxPowerS: 12000,
        laserModeEnabled: false,
      }),
    ).toEqual({
      xMaxFeedMmPerMin: 2200,
      yMaxFeedMmPerMin: 1800,
      zMaxFeedMmPerMin: 300,
      spindleMaxRpm: 12000,
    });
  });

  it('does not infer CNC mode when $32 was not reported', () => {
    expect(cncLiveCapsFromController({ maxPowerS: 1000 })).toEqual({});
  });
});
