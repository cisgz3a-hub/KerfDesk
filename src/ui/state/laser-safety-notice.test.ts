import { describe, expect, it } from 'vitest';
import {
  acknowledgementStalledNotice,
  cncPauseResumeStalledNotice,
  disconnectDuringJobNotice,
} from './laser-safety-notice';

describe('controller recovery notice ownership', () => {
  it('distinguishes a retained CNC confirmation failure from a failed stream', () => {
    const notice = cncPauseResumeStalledNotice();
    expect(notice.kind).toBe('cnc-transition-unconfirmed');
    expect(notice.message).toContain('kept the job; no controller reset was requested');
  });

  it('does not claim a realtime reset on firmware that only accepts queued beam-off commands', () => {
    const notice = acknowledgementStalledNotice(false);
    expect(notice.message).toContain('queued best-effort beam-off commands');
    expect(notice.message).toContain('no realtime reset');
    expect(notice.message).not.toContain('requested a controller soft reset');
  });
});

// UX audit U4-P3-5: the card said "may still be moving" but not burning, and
// "Reconnect and home" to a machine with no homing.
describe('cable pulled during a job', () => {
  it('says the laser or spindle may still be on and asks for Home only with homing', () => {
    const { message } = disconnectDuringJobNotice('usb');
    expect(message).toContain('with the laser or spindle still on');
    expect(message).toContain('switch it off at its power switch');
    expect(message).toContain(
      'Then reconnect and check the origin (Home, if the machine has homing)',
    );
    expect(message).not.toContain('Reconnect and home');
  });
});
