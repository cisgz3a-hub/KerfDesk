// C2 verification E2-P3-3: each finding is listed once.
import { describe, expect, it } from 'vitest';
import { withoutRepeatedIssues } from './without-repeated-issues';

describe('withoutRepeatedIssues', () => {
  it('keeps the first of each code and message, in order', () => {
    const out = 'Layer L: X out of bed: 310.007';
    expect(
      withoutRepeatedIssues([
        { code: 'out-of-bed', message: out },
        { code: 'no-output-layer', message: 'Layer M: power is 0 %' },
        { code: 'out-of-bed', message: out },
      ]).map((issue) => issue.message),
    ).toEqual([out, 'Layer M: power is 0 %']);
  });
});
