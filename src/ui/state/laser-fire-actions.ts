import { profileSupportsCapability } from '../../core/devices';
import type { ControllerDriver } from '../../core/controllers';
import { laserFireRefusal } from '../../core/preflight/laser-module-readiness';
import { machineKindOf } from '../../core/scene';
import { connectedLaserModuleEvidence } from './laser-module-probe';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { isActiveJob, mpgCommandBlockMessage, pushLog } from './laser-store-helpers';
import {
  firePowerOverrideReset,
  firePowerOverrideResetLogLine,
  flushPendingOverrideCommands,
} from './laser-start-override-reset';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import type { TranscriptSource } from './laser-transcript';
import { useStore } from './store';
import { currentFirePowerS } from './laser-fire-power';

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
type FlushPendingOverrides = () => Promise<unknown>;

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

export function controllerFireActions(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs & { readonly driver: ControllerDriver },
  write: SafeWriteFn,
): Pick<LaserState, 'setFireActive'> {
  return fireActions(set, get, write, () =>
    flushPendingOverrideCommands(refs, write, refs.driver, 'fire'),
  );
}

export function fireActions(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  flushPendingOverrides: FlushPendingOverrides,
): Pick<LaserState, 'setFireActive'> {
  const runtime: FireRuntime = { requestToken: 0, activationPending: false };
  return {
    setFireActive: (active, requestedPercent) =>
      active
        ? activateFire(runtime, set, get, safeWrite, flushPendingOverrides, requestedPercent)
        : deactivateFire(runtime, set, get, safeWrite),
  };
}

async function deactivateFire(
  runtime: FireRuntime,
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Promise<void> {
  if (get().controllerOperation?.kind === 'job-start-mark') {
    // The timed mark already owns its queued M5 and three terminal ACKs.
    // A deliberate generic Laser off must cancel through the bound Abort
    // lifecycle, never insert an unowned ACK into that semantic exchange.
    await get().stopJob();
    return;
  }
  const sessionEpoch = get().controllerSessionEpoch;
  const connectionAttempt = get().connectionAttempt;
  runtime.requestToken += 1;
  const shouldWriteOff = runtime.activationPending || get().fireActive;
  set((state) => ({
    accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
  }));
  // Drop the latch only after the controller accepts M5. Clearing it first
  // hid the LASER OFF affordance while the beam could still be on, and a
  // retry skipped M5 entirely because the latch already read false.
  if (shouldWriteOff) await safeWrite(FIRE_OFF_COMMAND, 'fire', 'console');
  if (
    get().controllerSessionEpoch === sessionEpoch &&
    get().connectionAttempt === connectionAttempt
  ) {
    set({ fireActive: false });
  }
}

async function activateFire(
  runtime: FireRuntime,
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  flushPendingOverrides: FlushPendingOverrides,
  requestedPercent: number | undefined,
): Promise<void> {
  const token = ++runtime.requestToken;
  const blocked = fireActivationBlockMessage(get());
  if (blocked !== null) rejectFireActivation(set, get, blocked);
  if (runtime.activationPending || get().fireActive) return;
  const ownsSession = fireSessionOwner(get);

  const { powerS, feedMmPerMin } = firePowerSettings(set, get, requestedPercent);

  runtime.activationPending = true;
  set((state) => ({
    fireActive: true,
    accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
  }));
  // The Fire latch reserves override admission through the owned flag fence,
  // standalone reset and Fire-on. A status saying 100% is not a reset ACK.
  const reset = firePowerOverrideReset(get().capabilities.overrides, get().ovCache);
  try {
    if (
      reset !== '' &&
      !(await resetFirePowerOverride(
        runtime,
        token,
        reset,
        set,
        get,
        safeWrite,
        flushPendingOverrides,
        ownsSession,
      ))
    ) {
      return;
    }
    if (!ownsSession() || token !== runtime.requestToken) return;
    await safeWrite(fireOnCommand(powerS, feedMmPerMin), 'fire', 'console');
    if (!ownsSession()) return;
    if (fireActivationInterrupted(runtime, token, get)) {
      // Same latch rule as deactivateFire: this compensating M5 may race a
      // failed release write, so only a successful write may clear the latch.
      const offAccepted = await safeWrite(FIRE_OFF_COMMAND, 'fire', 'console').then(
        () => true,
        () => false,
      );
      if (offAccepted && ownsSession()) set({ fireActive: false });
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

function fireActivationInterrupted(runtime: FireRuntime, token: number, get: GetFn): boolean {
  return token !== runtime.requestToken || fireActivationBlockMessage(get(), true) !== null;
}

function firePowerSettings(
  set: SetFn,
  get: GetFn,
  requestedPercent: number | undefined,
): { readonly powerS: number; readonly feedMmPerMin: number } {
  const device = useStore.getState().project.device;
  const control = device.fireControl;
  if (control === undefined) {
    rejectFireActivation(set, get, 'Enable low-power Fire in Device Profile first.');
  }
  const powerS = currentFirePowerS(
    get(),
    control,
    device.maxPowerS,
    requestedPercent ?? control.maxPowerPercent,
  );
  if (powerS <= 0) rejectFireActivation(set, get, 'Fire power must resolve to a positive S value.');
  return { powerS, feedMmPerMin: device.framingFeedMmPerMin };
}

function fireSessionOwner(get: GetFn): () => boolean {
  const { controllerSessionEpoch, connectionAttempt } = get();
  return () => {
    const current = get();
    return (
      current.connection.kind === 'connected' &&
      current.controllerSessionEpoch === controllerSessionEpoch &&
      current.connectionAttempt === connectionAttempt
    );
  };
}

// The controller scales Fire's S by its power override, so one left above 100%
// by a job would multiply the capped power (laser-start-override-reset.ts).
// The reset is a realtime byte written on its own: a queued line may not carry
// a byte above 0x7F (ADR-361). It owes no acknowledgement. First an owned
// queued line/ACK flushes older flags; otherwise a pending increase and this
// reset can join one batch, which applies the increase after the reset (GRBL
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L81,
// grblHAL
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L235),
// so the later reset batch owns Fire's nominal 100% multiplier. False when
// Fire must not go on. This does not measure actual optical output.
async function resetFirePowerOverride(
  runtime: FireRuntime,
  token: number,
  reset: string,
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  flushPendingOverrides: FlushPendingOverrides,
  ownsSession: () => boolean,
): Promise<boolean> {
  const before = get().ovCache;
  // Fire-on has not been written yet, so the beam is off: a reset that fails
  // or is overtaken leaves no uncertain-on latch and owes no M5 of its own.
  try {
    await flushPendingOverrides();
    if (!ownsSession() || token !== runtime.requestToken) return false;
    if (fireActivationBlockMessage(get(), true) !== null) {
      set({ fireActive: false });
      return false;
    }
    await safeWrite(reset, 'fire', 'console');
  } catch (error) {
    if (ownsSession() && token === runtime.requestToken) set({ fireActive: false });
    throw error;
  }
  if (!ownsSession()) return false;
  set({ log: pushLog(get(), firePowerOverrideResetLogLine(before)) });
  // A release during this write owns the latch and its M5 (deactivateFire).
  if (token !== runtime.requestToken) return false;
  if (fireActivationBlockMessage(get(), true) === null) return true;
  set({ fireActive: false });
  return false;
}

export function fireActivationBlockMessage(
  state: LaserState,
  ignorePendingAcks = false,
): string | null {
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
    fireActive: get().controllerOperation?.kind === 'job-start-mark' ? get().fireActive : false,
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Fire command blocked: ${message}`),
  });
  throw new Error(message);
}
