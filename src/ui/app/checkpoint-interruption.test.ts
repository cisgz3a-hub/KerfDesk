import { describe, expect, it } from 'vitest';
import { currentJobStopRequest } from '../state/job-stop-request';
import type { LaserSafetyNotice } from '../state/laser-safety-notice';
import { checkpointInterruption, currentRunPlannerBacklog } from './checkpoint-interruption';

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

  it('records an operator Abort as a cancellation, not an unexplained end', () => {
    // Abort marks the stream errored before the reset byte, with no notice.
    expect(checkpointInterruption('errored', null)?.message).toBe(
      'The job stream ended unexpectedly.',
    );
    expect(
      checkpointInterruption('errored', null, { reason: 'operator', streamerEpoch: 3 }),
    ).toEqual({ kind: 'cancelled', message: 'Stopped by the operator (Abort).' });
  });

  it('records the app closing mid-job as a cancellation that may not have arrived', () => {
    const interruption = checkpointInterruption('errored', null, {
      reason: 'app-closing',
      streamerEpoch: 3,
    });
    expect(interruption?.kind).toBe('cancelled');
    expect(interruption?.message).toContain('closed or reloaded');
    expect(interruption?.message).toContain('may not have arrived');
  });

  it('lets a safety notice name the cause even when a stop was requested', () => {
    const notice: LaserSafetyNotice = {
      kind: 'disconnect-during-job',
      message: 'The USB link dropped mid-job.',
    };
    expect(
      checkpointInterruption('disconnected', notice, { reason: 'operator', streamerEpoch: 1 }),
    ).toEqual({ kind: 'disconnect', message: notice.message });
  });
});

describe('currentJobStopRequest', () => {
  it('describes only the stream it was recorded for', () => {
    const request = { reason: 'operator' as const, streamerEpoch: 4 };
    expect(currentJobStopRequest({ jobStopRequest: request, streamerEpoch: 4 })).toBe(request);
    expect(currentJobStopRequest({ jobStopRequest: request, streamerEpoch: 5 })).toBeNull();
    expect(currentJobStopRequest({ streamerEpoch: 4 })).toBeNull();
  });
});

// Controller audit recovery-6: a cause that discarded the planner records the
// backlog, so the automatic restart steps back over the discarded moves.
describe('planner backlog on the recorded cause', () => {
  const backlog = { ackedAtStatus: 400, queuedBlocks: 380 };

  it('records it for an Abort, a rejected line and a reboot', () => {
    const operator = { reason: 'operator' as const, streamerEpoch: 2 };
    expect(checkpointInterruption('errored', null, operator, backlog)?.plannerBacklog).toEqual(
      backlog,
    );
    const rejected: LaserSafetyNotice = {
      kind: 'controller-error',
      code: 2,
      message: 'The controller rejected a command (error:2).',
    };
    expect(checkpointInterruption('errored', rejected, null, backlog)?.plannerBacklog).toEqual(
      backlog,
    );
    const reboot: LaserSafetyNotice = { kind: 'controller-reboot', message: 'Rebooted.' };
    expect(checkpointInterruption('errored', reboot, null, backlog)?.plannerBacklog).toEqual(
      backlog,
    );
  });

  it('leaves it out where the controller kept running or the stop may not have arrived', () => {
    const lost: LaserSafetyNotice = { kind: 'disconnect-during-job', message: 'USB dropped.' };
    expect(checkpointInterruption('disconnected', lost, null, backlog)).not.toHaveProperty(
      'plannerBacklog',
    );
    const closing = { reason: 'app-closing' as const, streamerEpoch: 2 };
    expect(checkpointInterruption('errored', null, closing, backlog)).not.toHaveProperty(
      'plannerBacklog',
    );
  });

  it('reads only the current run snapshot with a backlog', () => {
    const snapshot = { streamerEpoch: 7, sessionEpoch: 3, ackedLines: 400, queuedBlocks: 380 };
    expect(currentRunPlannerBacklog({ streamerEpoch: 7, streamPlannerSnapshot: snapshot })).toEqual(
      backlog,
    );
    expect(
      currentRunPlannerBacklog({ streamerEpoch: 8, streamPlannerSnapshot: snapshot }),
    ).toBeUndefined();
    expect(
      currentRunPlannerBacklog({
        streamerEpoch: 7,
        streamPlannerSnapshot: { ...snapshot, queuedBlocks: 0 },
      }),
    ).toBeUndefined();
  });
});
