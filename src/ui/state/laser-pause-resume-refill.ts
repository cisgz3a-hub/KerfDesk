import { resume as resumeStreamer, step } from '../../core/controllers/grbl';
import { writeWhilePauseResumeOwner } from './laser-pause-resume-confirmation';
import {
  assertPauseResumeTransitionOwner,
  refreshPauseResumeTransitionLiveness,
  type PauseResumeLivenessPolicy,
  type PauseResumeTransitionToken,
} from './laser-pause-resume-transition';
import type { PostJobSettleRefs } from './laser-post-job-settle';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { liveCanvasExecutionAcceptedPatch } from './live-canvas-run';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

type PauseResumeRefillContext = {
  readonly set: SetFn;
  readonly refs: PostJobSettleRefs;
  readonly safeWrite: (line: string, action?: LaserSafetyAction) => Promise<void>;
};

type ResumeRefillOptions = {
  readonly token: PauseResumeTransitionToken;
  readonly liveness: PauseResumeLivenessPolicy;
};

export async function refillResumedStream(
  context: PauseResumeRefillContext,
  options: ResumeRefillOptions,
): Promise<boolean> {
  const { token, liveness } = options;
  while (true) {
    assertPauseResumeTransitionOwner(context.refs, token);
    let foundPausedStream = false;
    let toSend = '';
    let finishedWithoutRefill = false;
    context.set((state) => {
      if (state.streamer?.status !== 'paused') return {};
      foundPausedStream = true;
      const stepped = step(resumeStreamer(state.streamer));
      toSend = stepped.toSend;
      finishedWithoutRefill = stepped.state.status === 'done';
      if (toSend.length === 0) return { streamer: stepped.state };
      // Reserve these bytes before the transport write so an immediate ack has
      // an owner. Keep the sender paused until the owned write settles: acks may
      // drain this reservation, but cannot dispatch another refill.
      return { streamer: { ...stepped.state, status: 'paused' } };
    });
    if (!foundPausedStream) {
      throw new Error('Resume lost ownership of the paused job stream.');
    }
    if (toSend.length === 0) {
      // No stream bytes remain, but controller execution can still have a
      // physical tail. Its family-specific settle contract owns completion.
      context.set((state) => liveCanvasExecutionAcceptedPatch(state, true));
      return finishedWithoutRefill;
    }
    await writeWhilePauseResumeOwner(context, {
      token,
      command: toSend,
      action: 'resume',
    });
    if (liveness === 'cnc-door') {
      refreshPauseResumeTransitionLiveness(context.refs, token);
    }
    // Publish from the current snapshot on the next pass. Early acks may have
    // changed completed/in-flight accounting while this write was pending.
  }
}
