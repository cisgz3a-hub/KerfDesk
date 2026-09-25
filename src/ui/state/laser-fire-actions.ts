import { cappedFirePowerS } from '../../core/devices';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import {
  FIRE_NOT_ENABLED_MESSAGE,
  fireActivationBlock,
  fireSetupForProject,
} from './laser-fire-readiness';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
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
  const project = useStore.getState().project;
  const blocked = fireActivationBlock(get(), project);
  if (blocked !== null) rejectFireActivation(set, get, blocked.message);
  if (runtime.activationPending || get().fireActive) return;

  // The block check has already refused every other setup. This narrows the
  // type, and fails closed should that check ever stop covering it.
  const setup = fireSetupForProject(project);
  if (setup.kind !== 'enabled') rejectFireActivation(set, get, FIRE_NOT_ENABLED_MESSAGE);
  const device = project.device;
  const control = setup.control;
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
    const stillAllowed = fireActivationBlock(get(), useStore.getState().project, true) === null;
    if (token !== runtime.requestToken || !stillAllowed) {
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

// A refused press sends nothing, so it leaves the on latch alone. Clearing it
// here let a refused repeat press hide LASER OFF, and skip M5 on release,
// while an earlier accepted M3 could still hold the beam on.
function rejectFireActivation(set: SetFn, get: GetFn, message: string): never {
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Fire command blocked: ${message}`),
  });
  throw new Error(message);
}
