import { describe, expect, it } from 'vitest';
import { resumeConfirmation } from './resume-confirmation';

describe('resumeConfirmation', () => {
  it('never describes an executable CNC recovery sequence', () => {
    const message = resumeConfirmation('cnc', 144, 137);
    expect(message).toContain('CNC recovery is disabled');
    expect(message).toContain('acknowledgements do not prove');
    expect(message).not.toContain('extracts Z');
  });

  it('keeps the beam-off positioning contract for laser recovery', () => {
    const message = resumeConfirmation('laser', 50, 50);
    expect(message).toContain('beam off');
    expect(message).not.toContain('spindle-start');
  });
});
