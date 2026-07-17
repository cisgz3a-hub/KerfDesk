import { describe, expect, it } from 'vitest';
import { frameVerificationBlockedMessage } from './frame-verification-policy';

// Frame-first: the policy module carries only the single Start-gate message.
// The gate itself (every mode, laser and CNC) is exercised through
// required-frame-readiness and the start-job tests.
describe('frameVerificationBlockedMessage', () => {
  it('tells the operator to Frame first and to re-frame after drift', () => {
    const message = frameVerificationBlockedMessage();
    expect(message).toContain('completed Frame');
    expect(message).toContain('Re-frame');
  });
});
