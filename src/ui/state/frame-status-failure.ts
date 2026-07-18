import type { GrblState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

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
  if (!mpgOwnsControl || operation?.kind !== 'jog') return {};
  const message =
    'Motion stopped because the pendant/MPG took control. The pending Jog was cancelled; return control to KerfDesk and confirm the machine position before moving again.';
  return {
    motionOperation: { ...operation, cancelRequested: true },
    frameVerification: null,
    framedRun: null,
    lastWriteError: message,
    log: pushLog(state, `[lf2] ${message}`),
  };
}
