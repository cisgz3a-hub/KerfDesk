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

  // Controller audit cnc-controller-3: a stock router reports $30=1000 with
  // $32=0 while its spindle turns 12 000 RPM, so $30 is never an RPM ceiling.
  it('ignores $30 as a spindle ceiling when the controller reports CNC mode', () => {
    expect(
      cncLiveCapsFromController({
        maxFeedX: 2200,
        maxFeedY: 1800,
        zMaxFeed: 300,
        maxPowerS: 1000,
        laserModeEnabled: false,
      }),
    ).toEqual({
      xMaxFeedMmPerMin: 2200,
      yMaxFeedMmPerMin: 1800,
      zMaxFeedMmPerMin: 300,
    });
  });

  it('does not infer CNC mode when $32 was not reported', () => {
    expect(cncLiveCapsFromController({ maxPowerS: 1000 })).toEqual({});
  });
});
