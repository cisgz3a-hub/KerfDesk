import { describe, expect, it } from 'vitest';
import {
  clampJogFeed,
  continuousJogVector,
  defaultJogFeed,
  jogFeedOptions,
} from './jog-control-policy';

describe('jog control policy', () => {
  it('clamps the default and selectable feeds to the machine maximum', () => {
    expect(defaultJogFeed(1200)).toBe(1200);
    expect(clampJogFeed(6000, 1200)).toBe(1200);
    expect(jogFeedOptions(1200)).toEqual([100, 500, 1000, 1200]);
  });

  it('uses live position to stop a continuous jog at the machine boundary', () => {
    expect(
      continuousJogVector(
        { x: 1, y: 0 },
        { x: 125, y: 40 },
        { width: 400, height: 300 },
        { x: 1, y: 1 },
        3000,
      ),
    ).toEqual({ dx: 275, feed: 3000 });
  });

  it('honors right-origin axis reversal when calculating continuous travel', () => {
    expect(
      continuousJogVector(
        { x: 1, y: 0 },
        { x: 125, y: 40 },
        { width: 400, height: 300 },
        { x: -1, y: 1 },
        3000,
      ),
    ).toEqual({ dx: -125, feed: 3000 });
  });
});
