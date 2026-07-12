import { describe, expect, it } from 'vitest';
import { resumeConfirmation } from './resume-confirmation';

describe('resumeConfirmation', () => {
  it('names the CNC rewind boundary and retract-before-spindle sequence', () => {
    const message = resumeConfirmation('cnc', 144, 137);
    expect(message).toContain('safe retract boundary line 137');
    expect(message).toContain('extracts Z');
    expect(message).toContain('before any spindle-start command');
  });

  it('keeps the beam-off positioning contract for laser recovery', () => {
    const message = resumeConfirmation('laser', 50, 50);
    expect(message).toContain('beam off');
    expect(message).not.toContain('spindle-start');
  });
});
