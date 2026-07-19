import { describe, expect, it } from 'vitest';
import { expandFillHatchWithRunways } from './fill-runway';

describe('expandFillHatchWithRunways', () => {
  it('expands forward motion with independent entry and exit lengths', () => {
    expect(
      expandFillHatchWithRunways(
        [
          { x: 10, y: 4 },
          { x: 12, y: 4 },
        ],
        { leadInMm: 5, leadOutMm: 0 },
      ),
    ).toEqual({
      leadStart: { x: 5, y: 4 },
      burnStart: { x: 10, y: 4 },
      burnEnd: { x: 12, y: 4 },
      leadEnd: { x: 12, y: 4 },
    });
  });

  it('expands a reverse sweep along its actual travel direction', () => {
    expect(
      expandFillHatchWithRunways(
        [
          { x: 12, y: 4 },
          { x: 10, y: 4 },
        ],
        { leadInMm: 3, leadOutMm: 2 },
      ),
    ).toEqual({
      leadStart: { x: 15, y: 4 },
      burnStart: { x: 12, y: 4 },
      burnEnd: { x: 10, y: 4 },
      leadEnd: { x: 8, y: 4 },
    });
  });
});
