// Controller audit gap-start-2: a Frame permit consumed by a job or controller
// change used to leave the operator guessing. The expiry records why; Start
// stays greyed out until a clean Frame, and says why instead of framing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { FramedRunCandidate, FramedRunPermit } from '../state/framed-run';
import { framedRunControllerSnapshot } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { clearFrameExpiryNote, frameExpiryReason, noteFrameExpired } from './frame-expiry-note';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { FRAME_JOB_FIRST_MESSAGE, JOB_CHANGED_AFTER_FRAME_REASON } from './framed-run-readiness';
import { runStartJobFlow } from './start-job-flow';
import { runFrameNow } from './use-frame-action';

vi.mock('./use-frame-action', () => ({ runFrameNow: vi.fn(async () => undefined) }));

afterEach(() => {
  clearFrameExpiryNote();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe('Frame expiry reason', () => {
  it('records why a permit expired when the job changed after Frame', () => {
    ensureFramedRunInvalidationSubscriptions();
    const permit: FramedRunPermit = {
      kind: 'ready',
      candidate: { executionSignature: 'the-job-as-framed' } as FramedRunCandidate,
      completedStatusSequence: 0,
      controller: framedRunControllerSnapshot(useLaserStore.getState()),
    };
    useLaserStore.setState({ framedRun: permit });

    useStore.setState({ dirty: true });

    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(frameExpiryReason()).toBe(JOB_CHANGED_AFTER_FRAME_REASON);
  });

  it('never frames from Start: it says why the earlier Frame no longer counts', async () => {
    noteFrameExpired(JOB_CHANGED_AFTER_FRAME_REASON);

    await runStartJobFlow();

    expect(runFrameNow).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      `${JOB_CHANGED_AFTER_FRAME_REASON} Frame the job again to unlock Start.`,
    );
    // The note stays for the status line until the next Frame begins.
    expect(frameExpiryReason()).toBe(JOB_CHANGED_AFTER_FRAME_REASON);
  });

  it('asks for a Frame when nothing was ever framed', async () => {
    await runStartJobFlow();

    expect(runFrameNow).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(FRAME_JOB_FIRST_MESSAGE);
  });
});
