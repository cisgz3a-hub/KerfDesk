import { describe, expect, it } from 'vitest';
import { countToolChangeBoundaries } from './laser-job-actions';

describe('structured CNC tool-change boundary counting', () => {
  it('matches every stop form the streamer holds, including inline comments', () => {
    expect(
      countToolChangeBoundaries(
        ['M0', 'M00 ; load tool', 'M1 (optional stop)', 'M01 ; change bit', 'G1 X1'].join('\n'),
      ),
    ).toBe(4);
  });
});
