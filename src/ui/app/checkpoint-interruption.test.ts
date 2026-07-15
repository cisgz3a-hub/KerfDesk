import { describe, expect, it } from 'vitest';
import type { LaserSafetyNotice } from '../state/laser-safety-notice';
import { checkpointInterruption } from './checkpoint-interruption';

describe('checkpointInterruption', () => {
  it('maps a disconnect-during-fire notice to a disconnect interruption', () => {
    // Regression: ADR-136 added the 'disconnect-during-fire' safety notice but
    // noticeKind fell through to `return notice.kind`, which is not a valid
    // JobInterruptionKind — a broken typecheck and an out-of-contract kind at
    // runtime. A fire-time disconnect is a disconnect, exactly like a job-time one.
    const notice: LaserSafetyNotice = {
      kind: 'disconnect-during-fire',
      message: 'The serial link dropped while the laser was firing.',
    };

    const interruption = checkpointInterruption('disconnected', notice);

    expect(interruption).not.toBeNull();
    expect(interruption?.kind).toBe('disconnect');
    expect(interruption?.message).toBe(notice.message);
  });

  it('maps a disconnect-during-job notice to a disconnect interruption', () => {
    const notice: LaserSafetyNotice = {
      kind: 'disconnect-during-job',
      message: 'The USB link dropped mid-job.',
    };

    expect(checkpointInterruption('disconnected', notice)?.kind).toBe('disconnect');
  });

  it('maps an unconfirmed disconnect stop to a disconnect interruption', () => {
    const notice: LaserSafetyNotice = {
      kind: 'disconnect-stop-unconfirmed',
      message: 'Buffered motion may still be active.',
    };

    expect(checkpointInterruption('disconnected', notice)?.kind).toBe('disconnect');
  });

  it('keeps an unconfirmed connected Abort classified as cancelled', () => {
    const notice: LaserSafetyNotice = {
      kind: 'disconnect-stop-unconfirmed',
      message: 'Buffered motion may still be active.',
    };

    expect(checkpointInterruption('cancelled', notice)).toEqual({
      kind: 'cancelled',
      message: notice.message,
    });
  });

  it('returns null when the streamer stopped cleanly', () => {
    expect(checkpointInterruption('idle', null)).toBeNull();
  });
});
