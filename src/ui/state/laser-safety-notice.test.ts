import { describe, expect, it } from 'vitest';
import { acknowledgementStalledNotice, cncPauseResumeStalledNotice } from './laser-safety-notice';

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
