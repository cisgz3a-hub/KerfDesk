import { describe, expect, it } from 'vitest';
import {
  CNC_RESUME_ADVISORY_MESSAGE,
  CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE,
  cncPauseMessage,
  cncResumeAdvisoryNotice,
} from './cnc-pause-resume-policy';

describe('CNC pause/resume policy', () => {
  it('surfaces a spindle-check advisory for CNC Resume and nothing for laser', () => {
    expect(cncResumeAdvisoryNotice('cnc', false)).toMatch(/restarts the spindle/i);
    expect(cncResumeAdvisoryNotice('laser', false)).toBeNull();
    expect(cncResumeAdvisoryNotice(null, undefined)).toBeNull();
  });

  // CNC audit MC-1: GRBL skips the safety-door spin-up delay in laser mode, so
  // the spin-up advice holds only once the controller has confirmed $32=0.
  it('distinguishes confirmed laser mode from an unreported controller setting', () => {
    expect(cncResumeAdvisoryNotice('cnc', false)).toBe(CNC_RESUME_ADVISORY_MESSAGE);
    expect(cncResumeAdvisoryNotice('cnc', true)).toBe(CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE);
    const unknown = cncResumeAdvisoryNotice('cnc', undefined);
    expect(unknown).toContain('Controller laser mode ($32) is unconfirmed');
    expect(unknown).toContain('may restart motion without spindle spin-up');
    expect(unknown).not.toContain('with NO spindle spin-up');
  });

  it('tells the operator a paused CNC job can be resumed', () => {
    expect(cncPauseMessage('cnc')).toMatch(/can be resumed/i);
    expect(cncPauseMessage('laser')).toBeNull();
  });
});
