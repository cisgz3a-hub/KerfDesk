// Switching a positioning light on inside its owned transaction, and the
// Falcon laser dot's 30 s auto-off (ADR-603, ADR-664).

import type { DeviceProfile } from '../../core/devices/device-profile';
import {
  isLaserDotLight,
  LASER_DOT_AUTO_OFF_MS,
  type PositioningLight,
} from '../../core/devices/positioning-light';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import { laserDotRefusal } from './laser-dot-light';
import { pushLog } from './laser-store-helpers';
import type { LaserState, LiveRefs } from './laser-store';
import {
  grblRefusalCode,
  resetLaserDotPowerOverride,
  switchLight,
  type PositioningLightTransaction,
} from './positioning-light-transaction';

type SetFn = (patch: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>)) => void;

const laserDotTimers = new WeakMap<LiveRefs, ReturnType<typeof setTimeout>>();
// Another owned exchange holding the controller when the dot is due off.
const LASER_DOT_AUTO_OFF_RETRY_MS = 1_000;

/** The recorded state once an acknowledged off went out. The laser dot's Fire
 * latch drops with it: its M5 put the beam out. */
export function lightOffPatch(dotOff: boolean): Partial<LaserState> {
  return { positioningLightEnabled: false, ...(dotOff ? { fireActive: false } : {}) };
}

/** Refuse the laser dot before the transaction takes the controller. */
export function assertLaserDotAllowed(
  state: LaserState,
  device: DeviceProfile,
  mapping: PositioningLight,
  enabled: boolean,
): void {
  const refusal = enabled && isLaserDotLight(mapping) ? laserDotRefusal(state, device) : null;
  if (refusal !== null) throw new Error(refusal);
}

// On may have reached hardware even if its acknowledgement is subsequently
// lost or a generic fault rejects the exchange. Keep the captured Off mapping.
// GRBL-family error:20 rejects an unsupported command before execution, so only
// that qualified response proves the preceding acknowledged Off still holds.
// The laser dot's line is G-code GRBL checks whole before it runs any of it,
// so any error:N proves the beam stayed off.
export async function sendLightOn(
  context: PositioningLightTransaction,
  set: SetFn,
  mapping: PositioningLight,
  owns: () => boolean,
  lit: LitLight,
): Promise<void> {
  try {
    await switchOn(context, set, mapping, owns, lit.forget);
  } finally {
    const { get, refs } = context;
    startLaserDotAutoOff({ ...lit, set, get, refs }, mapping);
  }
}

/** What the light transaction knows about the light it is switching on. */
export type LitLight = {
  /** Drop the session's record of this light: it never lit. */
  readonly forget: () => void;
  /** This light is still the one lit, on this session. */
  readonly isCurrent: () => boolean;
  /** This session's own LED off transaction. */
  readonly off: () => Promise<void>;
};

async function switchOn(
  context: PositioningLightTransaction,
  set: SetFn,
  mapping: PositioningLight,
  owns: () => boolean,
  forget: () => void,
): Promise<void> {
  const dot = isLaserDotLight(mapping);
  // The dot takes the Fire latch first, as Fire does: from here it refuses
  // override changes through the flag fence and keeps every Fire guard on.
  set({
    positioningLightEnabled: true,
    ...(dot
      ? {
          fireActive: true,
          accessoryCache: invalidateAccessoryObservation(context.get().accessoryCache),
        }
      : {}),
  });
  let lineSent = false;
  try {
    if (dot) await resetLaserDotPowerOverride(context);
    lineSent = true;
    await switchLight(context, mapping, true);
    if (dot)
      set({
        log: pushLog(
          context.get(),
          `[lf2] Laser dot on at ${mapping.powerPercent}% to show where it will burn; KerfDesk will request off after ${LASER_DOT_AUTO_OFF_MS / 1000} s while the app and connection remain responsive.`,
        ),
      });
  } catch (error) {
    const refusal = grblRefusalCode(error, context.refs.driver);
    const unlit = !lineSent || (dot ? refusal !== null : refusal === 20);
    if (unlit && owns()) {
      set(lightOffPatch(dot));
      forget();
    }
    throw error;
  }
}

type LaserDotAutoOff = LitLight & {
  readonly set: SetFn;
  readonly get: () => LaserState;
  readonly refs: LiveRefs;
  warned?: boolean;
};

/** Put a dot that is, or may be, lit out after 30 s, as Creality's "Laser on"
 * does: an on line whose reply was lost keeps its latch and gets the timer
 * too. A G-code light keeps no timer. */
function startLaserDotAutoOff(autoOff: LaserDotAutoOff, mapping: PositioningLight): void {
  if (!isLaserDotLight(mapping) || !autoOff.isCurrent() || !autoOff.get().fireActive) return;
  armLaserDotAutoOff(autoOff, LASER_DOT_AUTO_OFF_MS);
}

function armLaserDotAutoOff(autoOff: LaserDotAutoOff, delayMs: number): void {
  clearTimeout(laserDotTimers.get(autoOff.refs));
  laserDotTimers.set(
    autoOff.refs,
    setTimeout(() => void autoOffLaserDot(autoOff), delayMs),
  );
}

async function autoOffLaserDot(autoOff: LaserDotAutoOff): Promise<void> {
  const { set, get } = autoOff;
  // Switched off, lit again, or another connection since: nothing of ours is on.
  if (!autoOff.isCurrent() || !get().positioningLightEnabled) return;
  if (get().controllerOperation !== null) {
    armLaserDotAutoOff(autoOff, LASER_DOT_AUTO_OFF_RETRY_MS);
    return;
  }
  try {
    await autoOff.off();
    set({ log: pushLog(get(), `[lf2] Laser dot off after ${LASER_DOT_AUTO_OFF_MS / 1000} s.`) });
  } catch {
    // Not Idle or not admitted: M5 on its own, as LASER OFF sends it.
    if (autoOff.isCurrent() && get().fireActive)
      await get()
        .setFireActive(false)
        .catch(() => undefined);
    // Neither off path succeeded. Keep the latch and keep trying for this
    // exact light/session; a stale timer must never switch a replacement off.
    if (!autoOff.isCurrent() || !get().fireActive) return;
    if (!autoOff.warned) {
      autoOff.warned = true;
      set({
        log: pushLog(
          get(),
          '[lf2] Laser dot off could not be confirmed. Retrying; use the machine stop if the beam remains on.',
        ),
      });
    }
    armLaserDotAutoOff(autoOff, LASER_DOT_AUTO_OFF_RETRY_MS);
  }
}
