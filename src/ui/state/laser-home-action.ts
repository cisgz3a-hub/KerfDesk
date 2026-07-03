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
    wcoCache: null,
    workOriginActive:
      state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown',
    workOriginSource:
      state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown'
        ? 'unknown'
        : 'none',
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
            log: pushLog(state, '[lf2] Homing confirmed after fresh Idle.'),
          }
        : { homingState: 'confirmed' },
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
