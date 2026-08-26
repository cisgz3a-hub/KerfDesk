import { runAutofocus } from './autofocus-action';
import { confirmFreshAutofocusIdle } from './autofocus-fresh-idle';
import type { LaserState, LiveRefs } from './laser-store';
import type { SafeWrite } from './laser-safe-write';
import {
  activeJobCommandBlockMessage,
  motionOperationCommandBlockMessage,
  pushLog,
} from './laser-store-helpers';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

export function autofocusActions(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  write: SafeWrite,
): Pick<LaserState, 'autofocus' | 'unlockAlarm'> {
  return {
    autofocus: async (command) => runOwnedAutofocus(set, get, refs, write, command),
    unlockAlarm: async () => {
      assertNoMotionOperation(set, get);
      const unlock = refs.driver.commands.unlock;
      if (unlock === null) throw new Error('This controller has no unlock command.');
      await write(`${unlock}\n`, 'unlock');
      set({ alarmCode: null, homingState: 'unknown' });
    },
  };
}

async function runOwnedAutofocus(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  write: SafeWrite,
  command: string,
): ReturnType<LaserState['autofocus']> {
  const block = autofocusBlockMessage(get(), refs);
  if (block !== null) return { kind: 'preflight-failed', reason: block };
  const expectedSessionEpoch = get().controllerSessionEpoch;
  set({
    autofocusBusy: true,
    controllerOperation: { kind: 'autofocus', phase: 'preflight', idleReports: 0 },
    framedRun: null,
    frameVerification: null,
  });
  try {
    const result = await runAutofocus({
      connected: refs.connection !== null,
      command,
      confirmFreshIdle: () => confirmFreshAutofocusIdle({ get, refs, write }),
      onDispatch: () =>
        set({ controllerOperation: { kind: 'autofocus', phase: 'command', idleReports: 0 } }),
      refs,
      write,
    });
    set((state) => completionPatch(state, result, expectedSessionEpoch));
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    set((state) =>
      completionPatch(state, { kind: 'motion-uncertain', reason }, expectedSessionEpoch),
    );
    throw error;
  } finally {
    set({ autofocusBusy: false });
  }
}

function autofocusBlockMessage(state: LaserState, refs: LiveRefs): string | null {
  const commandBlock =
    activeJobCommandBlockMessage(state) ?? motionOperationCommandBlockMessage(state);
  if (commandBlock !== null) return commandBlock;
  if (state.autofocusBusy) return 'Auto-focus is already running.';
  if (
    state.pendingUntrackedAcks > 0 ||
    (state.pendingTransportWrites ?? 0) > 0 ||
    refs.controllerCommand !== null ||
    refs.controllerIdleWait !== null ||
    refs.controllerStatusWait != null
  ) {
    return 'Wait for the previous controller command to finish before auto-focusing.';
  }
  return null;
}

function completionPatch(
  state: LaserState,
  result: Awaited<ReturnType<typeof runAutofocus>>,
  expectedSessionEpoch: number,
): Partial<LaserState> {
  if (
    state.controllerSessionEpoch !== expectedSessionEpoch ||
    state.connection.kind !== 'connected'
  ) {
    return {};
  }
  if (result.kind !== 'timeout' && result.kind !== 'motion-uncertain') {
    return state.controllerOperation?.kind === 'autofocus' ? { controllerOperation: null } : {};
  }
  const message =
    'Auto-focus motion is uncertain. Wait for a fresh Idle report, request controller reset, or disconnect; use the physical E-stop or power isolation if unsafe.';
  return {
    statusReport: null,
    statusObservation: null,
    controllerOperation: { kind: 'autofocus', phase: 'motion-uncertain', idleReports: 0 },
    lastWriteError: message,
    log: pushLog(state, `[lf2] ${message}`),
  };
}

function assertNoMotionOperation(set: SetFn, get: GetFn): void {
  const blockedMessage = motionOperationCommandBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}
