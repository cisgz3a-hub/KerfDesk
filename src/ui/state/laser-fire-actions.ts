import { cappedFirePowerS, profileSupportsCapability } from '../../core/devices';
import { laserFireRefusal } from '../../core/preflight/laser-module-readiness';
import { machineKindOf } from '../../core/scene';
import { connectedLaserModuleEvidence } from './laser-module-probe';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { isActiveJob, mpgCommandBlockMessage, pushLog } from './laser-store-helpers';
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

/**
 * In GRBL laser mode ($32=1) only a G1/G2/G3 block may energize the laser:
 * any other motion mode sets GC_PARSER_LASER_DISABLE and the M3 is synced at
 * power 0 (gnea/grbl gcode.c; grblHAL's motion_is_lasercut applies the same
 * rule). The modal state is G0 after power-up, a soft reset, Home and every
 * KerfDesk job, so a bare `M3 S<n>` lit nothing while the UI showed ON.
 * Naming G1 in the block without axis words selects a lasercut mode without
 * moving. The F word is required because an explicit G1 with the feed still
 * undefined (F0 after reset) is rejected with error:22. With $32=0 the same
 * block is an ordinary spindle-on.
 * https://github.com/gnea/grbl/blob/master/grbl/gcode.c
 * https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode
 */
function fireOnCommand(powerS: number, feedMmPerMin: number): string {
  const feed = Math.max(1, Math.round(feedMmPerMin));
  return `G1 F${feed} M3 S${powerS}\n`;
}

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
  set((state) => ({
    accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
  }));
  // Drop the latch only after the controller accepts M5. Clearing it first
  // hid the LASER OFF affordance while the beam could still be on, and a
  // retry skipped M5 entirely because the latch already read false.
  if (shouldWriteOff) await safeWrite(FIRE_OFF_COMMAND, 'fire', 'console');
  set({ fireActive: false });
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
  set((state) => ({
    fireActive: true,
    accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
  }));
  try {
    await safeWrite(fireOnCommand(powerS, device.framingFeedMmPerMin), 'fire', 'console');
    if (token !== runtime.requestToken || fireActivationBlockMessage(get(), true) !== null) {
      // Same latch rule as deactivateFire: this compensating M5 may race a
      // failed release write, so only a successful write may clear the latch.
      const offAccepted = await safeWrite(FIRE_OFF_COMMAND, 'fire', 'console').then(
        () => true,
        () => false,
      );
      if (offAccepted) set({ fireActive: false });
      return;
    }
    set({
      fireActive: true,
      lastWriteError: null,
      log: pushLog(get(), `[lf2] Momentary Fire on (S${powerS}).`),
    });
  } finally {
    // A rejected M3 transport promise deliberately propagates through this
    // finally without clearing the uncertain-on fail-off latch.
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
  const mpgBlock = mpgCommandBlockMessage(state);
  if (mpgBlock !== null) return mpgBlock;
  // No laser module: nothing would answer the `fire` line (controller audit SM-3).
  const noLaserOutput = laserFireRefusal(connectedLaserModuleEvidence(state));
  if (noLaserOutput !== null) return noLaserOutput;
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
  if (isActiveJob(state.streamer)) return 'A job is active. Request ABORT before using Fire.';
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
