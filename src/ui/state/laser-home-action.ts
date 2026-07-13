import type { ControllerDriver } from '../../core/controllers';
import {
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { assertAutofocusIdle, pushLog, setupCommandBlockMessage } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

// GRBL acks $H only after the homing cycle physically completes — commonly
// 10-60 s on real beds, so the default 8 s ack budget reports a spurious
// "home timed out" while the machine is still homing. With the
// non-idle-status-activity mode the <Home|...> poll replies keep the command
// alive, so this budget only measures status silence; on firmwares whose
// status polling pauses during a pending command (Marlin) it must cover the
// whole cycle.
const HOME_COMMAND_TIMEOUT_MS = 120_000;

function assertHomeReady(set: SetFn, get: GetFn, driver: ControllerDriver): string {
  assertAutofocusIdle(get());
  const homeCommand = driver.commands.home;
  if (homeCommand === null) throw new Error('This controller has no homing command.');
  const blockedMessage = setupCommandBlockMessage(get());
  if (blockedMessage === null) return homeCommand;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Home command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

export async function runHomeAction(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: ControllerDriver,
): Promise<void> {
  const homeCommand = assertHomeReady(set, get, driver);
  set((state) => ({
    controllerOperation: { kind: 'home', phase: 'command', idleReports: 0 },
    homingState: 'homing',
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    wcoCache: null,
    workOriginActive:
      state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown',
    workOriginSource:
      state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown'
        ? 'unknown'
        : 'none',
    // Homing re-establishes machine zero, so any prior G92 Z0 now points at a
    // different physical height — work Z0 must be re-set (Codex audit P1).
    workZZeroKnown: false,
    frameVerification: null,
    log: pushLog(state, '[lf2] Homing started. Cleared origin and frame verification.'),
  }));
  try {
    await startControllerCommand(refs, safeWrite, {
      kind: 'home',
      label: 'home',
      command: `${homeCommand}\n`,
      action: 'home',
      source: 'motion',
      timeoutMs: HOME_COMMAND_TIMEOUT_MS,
      timeoutMode: 'non-idle-status-activity',
    });
    set((state) =>
      state.controllerOperation?.kind === 'home'
        ? {
            controllerOperation: { kind: 'home', phase: 'settling', idleReports: 0 },
          }
        : {},
    );
    await startControllerCommand(refs, safeWrite, {
      kind: 'home',
      label: 'home settle marker',
      command: `${driver.commands.settleDwell}\n`,
      action: 'home',
      source: 'system',
    });
    set((state) =>
      state.controllerOperation?.kind === 'home'
        ? {
            controllerOperation: { kind: 'home', phase: 'awaiting-idle', idleReports: 0 },
          }
        : {},
    );
    await waitForFreshIdle(refs, { kind: 'home', requiredReports: 1 });
    set((state) =>
      state.controllerOperation?.kind === 'home'
        ? {
            controllerOperation: null,
            homingState: 'confirmed',
            alarmCode: null,
            log: pushLog(state, '[lf2] Homing confirmed after fresh Idle.'),
          }
        : { homingState: 'confirmed', alarmCode: null },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set((state) => ({
      controllerOperation:
        state.controllerOperation?.kind === 'home' ? null : state.controllerOperation,
      homingState: 'unknown',
      lastWriteError: message,
      safetyNotice: state.safetyNotice ?? controllerErrorNotice(null, 'command', message),
      log: pushLog(state, `[lf2] Home failed: ${message}`),
    }));
    throw err;
  }
}
