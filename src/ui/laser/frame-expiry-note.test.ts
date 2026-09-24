// Controller audit gap-start-2: a Frame permit consumed by a job or controller
// change made the next Start re-frame silently. The expiry now records why,
// and that Start says it once.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { FramedRunCandidate, FramedRunPermit } from '../state/framed-run';
import { framedRunControllerSnapshot } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { noteFrameExpired, takeFrameExpiryReason } from './frame-expiry-note';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { JOB_CHANGED_AFTER_FRAME_REASON } from './framed-run-readiness';
import { runStartJobFlow } from './start-job-flow';
import { runFrameNow } from './use-frame-action';

vi.mock('./use-frame-action', () => ({ runFrameNow: vi.fn(async () => undefined) }));

afterEach(() => {
  takeFrameExpiryReason();
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
    expect(takeFrameExpiryReason()).toBe(JOB_CHANGED_AFTER_FRAME_REASON);
  });

  it('makes the next Start say why it frames again, once', async () => {
    noteFrameExpired(JOB_CHANGED_AFTER_FRAME_REASON);

    await runStartJobFlow();
    await runStartJobFlow();

    expect(runFrameNow).toHaveBeenCalledTimes(2);
    const messages = useToastStore.getState().toasts.map((toast) => toast.message);
    expect(messages).toEqual([
      `${JOB_CHANGED_AFTER_FRAME_REASON} Start is framing the job again first; press Start once the Frame completes.`,
    ]);
  });
});
