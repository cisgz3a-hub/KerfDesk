import { describe, expect, it } from 'vitest';
import { frameMotionFeeds } from './frame-feed-limits';

describe('frameMotionFeeds', () => {
  it('caps XY by the slower live axis and Z by its separate live maximum', () => {
    expect(
      frameMotionFeeds(2000, {
        maxFeedX: 1500,
        maxFeedY: 1000,
        zMaxFeed: 300,
      }),
    ).toEqual({ xyMmPerMin: 1000, zMmPerMin: 300 });
  });

  it('uses every known axis limit and falls back to the requested feed for unknown axes', () => {
    expect(frameMotionFeeds(2000, { maxFeedX: 1200 })).toEqual({
      xyMmPerMin: 1200,
      zMmPerMin: 2000,
    });
    expect(frameMotionFeeds(2000, null)).toEqual({
      xyMmPerMin: 2000,
      zMmPerMin: 2000,
    });
  });

  it('never raises a requested feed to a higher controller maximum', () => {
    expect(
      frameMotionFeeds(500, {
        maxFeedX: 6000,
        maxFeedY: 6000,
        zMaxFeed: 800,
      }),
    ).toEqual({ xyMmPerMin: 500, zMmPerMin: 500 });
  });
});
