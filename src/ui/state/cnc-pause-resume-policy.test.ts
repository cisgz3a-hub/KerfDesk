import { describe, expect, it } from 'vitest';
import {
  CNC_LIFT_PHASE_MESSAGES,
  CNC_RESUME_ADVISORY_MESSAGE,
  CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE,
  CNC_RESUME_FLUIDNC_LASER_MODE_ADVISORY_MESSAGE,
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
    expect(cncPauseMessage('cnc')).toMatch(/lifts the bit to safe height/i);
    expect(cncPauseMessage('laser')).toBeNull();
  });

  // ADR-411: after the lift the reset has cleared the controller's settings,
  // so a lifted job must not fall back to the unconfirmed-mode advice.
  it('describes a Pause and lift by its phase, whatever the laser-mode evidence', () => {
    expect(cncResumeAdvisoryNotice('cnc', undefined, 'lifted')).toBe(
      CNC_LIFT_PHASE_MESSAGES.lifted,
    );
    expect(cncResumeAdvisoryNotice('cnc', false, 'entering')).toMatch(/spinning up above the cut/);
    expect(cncResumeAdvisoryNotice('laser', false, 'lifted')).toBeNull();
  });

  // ADR-411 Amendment 1: a Pause that left the bit in the cut says why beside
  // Resume, not only in the log.
  it('says why a Pause did not lift the bit, then the door-resume advice', () => {
    const advisory = cncResumeAdvisoryNotice('cnc', false, null, 'The door input is open.');
    expect(advisory).toBe(
      'Pause did not lift the bit: The door input is open. Resume tries to lift it first. ' +
        `If it still cannot: ${CNC_RESUME_ADVISORY_MESSAGE}`,
    );
    expect(cncResumeAdvisoryNotice('cnc', false, 'lifted', 'The door input is open.')).toBe(
      CNC_LIFT_PHASE_MESSAGES.lifted,
    );
  });
});

// ADR-180 Amendment 7 (audit v3 D4-P2-2): FluidNC never lifts, and its door
// resume waits only the spindle's spinup_ms (YAML, 0 by default), not GRBL's
// fixed 4 s, so the advice must not promise that wait.
describe('CNC pause/resume policy on FluidNC', () => {
  const NOT_LIFTED = 'KerfDesk does not lift the bit on FluidNC.';

  it('names spinup_ms, its default of 0 and Abort and recover instead of a fixed delay', () => {
    const advisory = cncResumeAdvisoryNotice('cnc', false, null, NOT_LIFTED, 'fluidnc');
    expect(advisory).toBe(CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE);
    expect(advisory).toContain('does not lift the bit on FluidNC');
    expect(advisory).toContain("waits only the spindle's spinup_ms");
    expect(advisory).toContain('which is 0 unless set');
    expect(advisory).toContain('Prefer ABORT JOB and recover from the Interrupted job card');
    expect(advisory).toContain("set spinup_ms in the spindle's section of the FluidNC config");
    expect(advisory).not.toMatch(/fixed spin-up delay|4 s/);
    // FluidNC never lifts, so the advice does not promise a lift on Resume.
    expect(advisory).not.toContain('Resume tries to lift it first');
  });

  it('gives the same advice before a Pause and while $32 is unreported', () => {
    expect(cncResumeAdvisoryNotice('cnc', false, null, null, 'fluidnc')).toBe(
      CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE,
    );
    expect(cncResumeAdvisoryNotice('cnc', undefined, null, NOT_LIFTED, 'fluidnc')).toBe(
      CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE,
    );
  });

  // FluidNC's $32 mirrors a Laser spindle type and is read-only (ADR-180
  // Amendment 6), so the remedy is the YAML spindle, not $32=0.
  it('sends a Laser spindle to the YAML config rather than to $32=0', () => {
    const advisory = cncResumeAdvisoryNotice('cnc', true, null, NOT_LIFTED, 'fluidnc');
    expect(advisory).toBe(CNC_RESUME_FLUIDNC_LASER_MODE_ADVISORY_MESSAGE);
    expect(advisory).toContain('with NO spindle spin-up');
    expect(advisory).toContain('configure a router spindle (not Laser) in the FluidNC config');
    expect(advisory).not.toContain('set $32=0');
  });

  it('keeps the GRBL and grblHAL advice and stays silent for a laser job', () => {
    expect(cncResumeAdvisoryNotice('cnc', false, null, null, 'grbl-v1.1')).toBe(
      CNC_RESUME_ADVISORY_MESSAGE,
    );
    expect(cncResumeAdvisoryNotice('cnc', true, null, null, 'grblhal')).toBe(
      CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE,
    );
    expect(cncResumeAdvisoryNotice('laser', false, null, null, 'fluidnc')).toBeNull();
  });

  it('does not promise a lift when the job is paused on FluidNC', () => {
    const message = cncPauseMessage('cnc', 'fluidnc');
    expect(message).toMatch(/can be resumed/i);
    expect(message).toContain('does not lift the bit on FluidNC, so it stays in the cut');
    expect(message).not.toMatch(/lifts the bit to safe height/i);
    expect(cncPauseMessage('cnc', 'grblhal')).toMatch(/lifts the bit to safe height/i);
    expect(cncPauseMessage('laser', 'fluidnc')).toBeNull();
  });
});
