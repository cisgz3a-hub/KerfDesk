import { cappedFirePowerS, profileSupportsCapability } from '../../core/devices';
import { machineKindOf } from '../../core/scene';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { isActiveJob, pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';
import { useStore } from './store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
type FireRuntime = { requestToken: number; activationPending: boolean };

const FIRE_OFF_COMMAND = 'M5\n';

export function fireActions(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'setFireActive'> {
  const runtime: FireRuntime = { requestToken: 0, activationPending: false };
  return {
    setFireActive: (active, requestedPercent) =>
      active
        ? activateFire(runtime, set, get, safeWrite, requestedPercent)
        : deactivateFire(runtime, set, get, safeWrite),
  };
}

async function deactivateFire(
  runtime: FireRuntime,
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Promise<void> {
  runtime.requestToken += 1;
  const shouldWriteOff = runtime.activationPending || get().fireActive;
  set({ fireActive: false });
  if (shouldWriteOff) await safeWrite(FIRE_OFF_COMMAND, 'fire', 'console');
}

async function activateFire(
  runtime: FireRuntime,
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  requestedPercent: number | undefined,
): Promise<void> {
  const token = ++runtime.requestToken;
  const blocked = fireActivationBlockMessage(get());
  if (blocked !== null) rejectFireActivation(set, get, blocked);
  if (runtime.activationPending || get().fireActive) return;

  const device = useStore.getState().project.device;
  const control = device.fireControl;
  if (control === undefined) {
    rejectFireActivation(set, get, 'Enable low-power Fire in Device Profile first.');
  }
  const powerS = cappedFirePowerS(
    requestedPercent ?? control.maxPowerPercent,
    control,
    device.maxPowerS,
  );
  if (powerS <= 0) rejectFireActivation(set, get, 'Fire power must resolve to a positive S value.');

  runtime.activationPending = true;
  set({ fireActive: true });
  try {
    await safeWrite(`M3 S${powerS}\n`, 'fire', 'console');
    if (token !== runtime.requestToken || fireActivationBlockMessage(get(), true) !== null) {
      await safeWrite(FIRE_OFF_COMMAND, 'fire', 'console').catch(() => undefined);
      set({ fireActive: false });
      return;
    }
    set({
      fireActive: true,
      lastWriteError: null,
      log: pushLog(get(), `[lf2] Momentary Fire on (S${powerS}).`),
    });
  } catch (error) {
    if (token === runtime.requestToken) set({ fireActive: false });
    throw error;
  } finally {
    runtime.activationPending = false;
  }
}

function fireActivationBlockMessage(state: LaserState, ignorePendingAcks = false): string | null {
  return (
    fireFeatureBlockMessage(state) ??
    fireControllerStateBlockMessage(state) ??
    fireBusyBlockMessage(state, ignorePendingAcks)
  );
}

function fireFeatureBlockMessage(state: LaserState): string | null {
  const project = useStore.getState().project;
  if (!useExperimentalLaserFeatures.getState().features.lowPowerFire) {
    return 'Enable Low-power Fire in Tools > Labs first.';
  }
  if (machineKindOf(project.machine) !== 'laser') return 'Fire is unavailable for CNC projects.';
  if (!state.capabilities.lowPowerFire) return 'The connected controller does not support Fire.';
  if (!profileSupportsCapability(project.device, 'low-power-fire')) {
    return 'The active machine profile is not approved for low-power Fire.';
  }
  return project.device.fireControl?.enabled === true
    ? null
    : 'Enable low-power Fire in Device Profile first.';
}

function fireControllerStateBlockMessage(state: LaserState): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (state.alarmCode !== null) return 'Clear the controller alarm before using Fire.';
  if (state.statusReport === null) {
    return 'Controller status is not known yet. Wait for an Idle position report.';
  }
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle before using Fire (currently ${state.statusReport.state}).`;
  }
  return state.statusReport.mPos === null && state.statusReport.wPos === null
    ? 'Fire needs a trusted live position report from the controller.'
    : null;
}

function fireBusyBlockMessage(state: LaserState, ignorePendingAcks: boolean): string | null {
  if (isActiveJob(state.streamer)) return 'A job is active. Stop it before using Fire.';
  if (state.motionOperation !== null) return 'Wait for the jog or frame operation to finish.';
  if (state.controllerOperation !== null) return 'Wait for the controller operation to finish.';
  if (state.autofocusBusy) return 'Wait for auto-focus to finish.';
  if (state.probeBusy) return 'Wait for probing to finish.';
  if (!ignorePendingAcks && state.pendingUntrackedAcks > 0) {
    return 'Wait for the controller to acknowledge the previous command.';
  }
  return null;
}

function rejectFireActivation(set: SetFn, get: GetFn, message: string): never {
  set({
    fireActive: false,
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Fire command blocked: ${message}`),
  });
  throw new Error(message);
}
