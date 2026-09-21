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

  it('describes saved recovery accurately and explains buffered-motion uncertainty', () => {
    const message = resumeConfirmation('laser', 50, 50, 'saved-recovery');
    expect(message).toContain('saved as a new run');
    expect(message).toContain('buffered');
    expect(message).not.toContain('will not create');
    expect(resumeConfirmation('laser', 50, 50)).toContain('will not create');
  });
});
