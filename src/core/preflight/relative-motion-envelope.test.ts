import { describe, expect, it } from 'vitest';
import { findRelativeMotionEnvelopeIssues } from './relative-motion-envelope';

const BED = { width: 400, height: 400 };

describe('findRelativeMotionEnvelopeIssues', () => {
  it('includes compact coordinate-only continuations in the motion span', () => {
    const issues = findRelativeMotionEnvelopeIssues('G1X0Y0\nX500Y0', BED);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('500.000 mm in X');
  });

  it('does not treat coordinate-setting blocks as inherited motion', () => {
    expect(findRelativeMotionEnvelopeIssues('G1X0Y0\nG10L20P1X500Y0', BED)).toEqual([]);
  });
});
