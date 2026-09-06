import type { GrblState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

export const JOG_MPG_INTERRUPTION_MESSAGE =
  "The pendant/MPG interrupted KerfDesk's Jog. Return control to KerfDesk and wait for fresh Idle confirmation before sending more motion. The interrupted move will not resume.";

export function frameStatusFailureMessage(
  operation: LaserState['motionOperation'],
  state: GrblState,
  mpgOwnsControl: boolean,
): string | null {
  if (operation?.kind !== 'frame') return null;
  if (mpgOwnsControl) {
    return 'Frame stopped because the pendant/MPG took motion control. No queued Frame legs or Start permit were retained; return control to KerfDesk, wait for MPG:0, and Frame again.';
  }
  if (state === 'Idle' || state === 'Run' || state === 'Jog') return null;
  return `Frame stopped because the controller reported ${state}. No Start permit was issued; resolve the controller state and Frame again.`;
}

export function frameStatusFailurePatch(
  state: LaserState,
  message: string | null,
): Partial<
  Pick<LaserState, 'motionOperation' | 'frameVerification' | 'framedRun' | 'lastWriteError' | 'log'>
> {
  if (message === null) return {};
  return {
    motionOperation: null,
    frameVerification: null,
    framedRun: null,
    lastWriteError: message,
    log: pushLog(state, `[lf2] ${message}`),
  };
}

export function jogMpgInterruptionPatch(
  state: LaserState,
  mpgOwnsControl: boolean,
): Partial<
  Pick<LaserState, 'motionOperation' | 'frameVerification' | 'framedRun' | 'lastWriteError' | 'log'>
> {
  const operation = state.motionOperation;
  if (!mpgOwnsControl || operation?.kind !== 'jog' || operation.interruptedByMpg === true) {
    return {};
  }
  const {
    cancelStatusQueryAfterSequence: staleFence,
    cancelAttemptId: interruptedCancel,
    ...interrupted
  } = operation;
  void staleFence;
  void interruptedCancel;
  const message = JOG_MPG_INTERRUPTION_MESSAGE;
  return {
    motionOperation: {
      ...interrupted,
      cancelRequested: true,
      interruptedByMpg: true,
      mpgInterruptionId: Symbol('mpg-interruption'),
    },
    frameVerification: null,
    framedRun: null,
    lastWriteError: message,
    log: pushLog(state, `[lf2] ${message}`),
  };
}
