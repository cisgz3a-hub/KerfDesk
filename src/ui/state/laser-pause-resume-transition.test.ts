import { afterEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { writeWhilePauseResumeOwner } from './laser-pause-resume-confirmation';
import type { PostJobSettleRefs } from './laser-post-job-settle';
import type { LaserState } from './laser-store';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import {
  beginPauseResumeTransition,
  completePauseResumeTransition,
  currentPauseResumeTransportFence,
  markPauseResumeTransportWriteRejected,
  ownsPauseResumeTransition,
  PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS,
  PAUSE_RESUME_TRANSITION_TIMEOUT_MS,
  refreshPauseResumeTransitionLiveness,
  releasePauseResumeTransportWrite,
  reservePauseResumeTransportWrite,
  type PauseResumeTransitionRefs,
} from './laser-pause-resume-transition';

const TIMEOUT_MESSAGE = 'Controller confirmation timed out.';
const BEFORE_DEADLINE_MS = 1;
const EXPECTED_HEARTBEAT_TIMEOUT_MS = 2_000;
const EXPECTED_MAX_TIMEOUT_MS = 30_000;
const INITIAL_WRITE_EPOCH = 4;
const REPLACEMENT_WRITE_EPOCH = 5;
const STALE_WRITE_MESSAGE = 'old-session transport rejected';
const STATUS_QUERY = '?';

afterEach(() => {
  vi.useRealTimers();
});

describe('Pause and Resume transition deadlines', () => {
  it('keeps transport silence strict while bounding live progress separately', () => {
    expect(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS).toBe(EXPECTED_HEARTBEAT_TIMEOUT_MS);
    expect(PAUSE_RESUME_TRANSITION_TIMEOUT_MS).toBe(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS);
    expect(PAUSE_RESUME_TRANSITION_MAX_TIMEOUT_MS).toBe(EXPECTED_MAX_TIMEOUT_MS);
  });

  it('refreshes the silence deadline without moving the absolute maximum', async () => {
    vi.useFakeTimers();
    const refs: PauseResumeTransitionRefs = {};
    const owner = beginPauseResumeTransition(refs, 'resume', TIMEOUT_MESSAGE);
    const deadline = expect(owner.deadline).rejects.toThrow(TIMEOUT_MESSAGE);
    let elapsedMs = 0;

    while (elapsedMs + EXPECTED_HEARTBEAT_TIMEOUT_MS < EXPECTED_MAX_TIMEOUT_MS) {
      const advanceMs = EXPECTED_HEARTBEAT_TIMEOUT_MS - BEFORE_DEADLINE_MS;
      await vi.advanceTimersByTimeAsync(advanceMs);
      elapsedMs += advanceMs;
      expect(refreshPauseResumeTransitionLiveness(refs, owner.token)).toBe(true);
      expect(ownsPauseResumeTransition(refs, owner.token)).toBe(true);
    }

    await vi.advanceTimersByTimeAsync(EXPECTED_MAX_TIMEOUT_MS - elapsedMs);
    await deadline;
    expect(ownsPauseResumeTransition(refs, owner.token)).toBe(false);
  });

  it('still rejects a silent transition at the heartbeat deadline', async () => {
    vi.useFakeTimers();
    const refs: PauseResumeTransitionRefs = {};
    const owner = beginPauseResumeTransition(refs, 'pause', TIMEOUT_MESSAGE);
    const deadline = expect(owner.deadline).rejects.toThrow(TIMEOUT_MESSAGE);

    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);

    await deadline;
    expect(ownsPauseResumeTransition(refs, owner.token)).toBe(false);
  });

  it('does not let an obsolete token refresh a replacement transition', async () => {
    vi.useFakeTimers();
    const refs: PauseResumeTransitionRefs = {};
    const first = beginPauseResumeTransition(refs, 'resume', TIMEOUT_MESSAGE);
    completePauseResumeTransition(refs, first.token);
    const replacement = beginPauseResumeTransition(refs, 'resume', TIMEOUT_MESSAGE);
    const deadline = expect(replacement.deadline).rejects.toThrow(TIMEOUT_MESSAGE);

    expect(refreshPauseResumeTransitionLiveness(refs, first.token)).toBe(false);
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);

    await deadline;
    expect(ownsPauseResumeTransition(refs, replacement.token)).toBe(false);
  });

  it('retains pending transport ownership only within its connection epoch', () => {
    const refs: PauseResumeTransitionRefs & { writeEpoch: number } = {
      writeEpoch: INITIAL_WRITE_EPOCH,
    };
    const owner = beginPauseResumeTransition(refs, 'resume', TIMEOUT_MESSAGE);
    reservePauseResumeTransportWrite(refs, owner.token);

    expect(currentPauseResumeTransportFence(refs)).toBe('settling');

    refs.writeEpoch = REPLACEMENT_WRITE_EPOCH;
    expect(currentPauseResumeTransportFence(refs)).toBeNull();

    releasePauseResumeTransportWrite(refs, owner.token);
    completePauseResumeTransition(refs, owner.token);
  });

  it('keeps an ambiguously rejected write fenced until session replacement', () => {
    const refs: PauseResumeTransitionRefs & { writeEpoch: number } = {
      writeEpoch: INITIAL_WRITE_EPOCH,
    };
    const owner = beginPauseResumeTransition(refs, 'resume', TIMEOUT_MESSAGE);
    reservePauseResumeTransportWrite(refs, owner.token);
    markPauseResumeTransportWriteRejected(refs, owner.token);
    releasePauseResumeTransportWrite(refs, owner.token);

    expect(currentPauseResumeTransportFence(refs)).toBe('rejected');

    refs.writeEpoch = REPLACEMENT_WRITE_EPOCH;
    expect(currentPauseResumeTransportFence(refs)).toBeNull();
    completePauseResumeTransition(refs, owner.token);
  });

  it('does not contain a transport rejection from an obsolete connection epoch', async () => {
    const refs: PostJobSettleRefs = {
      driver: grblDriver,
      controllerCommand: null,
      controllerIdleWait: null,
      controllerStatusWait: null,
      pauseResumeTransition: null,
      writeEpoch: INITIAL_WRITE_EPOCH,
    };
    const owner = beginPauseResumeTransition(refs, 'resume', TIMEOUT_MESSAGE);
    let rejectWrite = (_error: Error): void => undefined;
    const pendingWrite = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    });
    const set = vi.fn(
      (
        _partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
      ): void => undefined,
    );
    const write = writeWhilePauseResumeOwner(
      { set, refs, safeWrite: () => pendingWrite },
      { token: owner.token, command: STATUS_QUERY, action: 'resume' },
    );

    refs.writeEpoch = REPLACEMENT_WRITE_EPOCH;
    rejectWrite(new Error(STALE_WRITE_MESSAGE));

    await expect(write).rejects.toThrow(STALE_WRITE_MESSAGE);
    expect(set).not.toHaveBeenCalled();
    expect(currentPauseResumeTransportFence(refs)).toBeNull();
    completePauseResumeTransition(refs, owner.token);
  });
});
