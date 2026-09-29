import { selectControllerDriver } from '../../core/controllers';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import type { ControllerCommandSet } from '../../core/devices/device-profile';
// Deep import: the devices barrel is at its public-export ratchet.
import { presetCommandSetUpdate } from '../../core/devices/preset-command-set';
import type { JobReviewModel } from './job-review';

export const CONTROLLER_IDENTITY_WARNING_PREFIX = 'Controller identity mismatch:';
export const CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX = 'Controller identity unconfirmed:';

/** The profile fields Connect binds the controller driver from. */
export type ConfiguredControllerIdentity = Pick<
  DeviceProfile,
  'profileId' | 'controllerKind' | 'controllerCommandSet'
>;

/** The live session: the driver Connect bound and the family its banner named. */
export type LiveControllerIdentity = {
  readonly activeControllerKind: ControllerKind;
  /** `null` (or absent) is the family's generic command set. */
  readonly activeControllerCommandSet: ControllerCommandSet | null | undefined;
  readonly detectedControllerKind: ControllerKind | null;
};

// What a Falcon A1 Pro gets from the generic grblHAL commands instead of its own
// (falcon-command-contract.ts; Creality's A1 Pro LightBurn device file).
const GENERIC_COMMANDS_CONSEQUENCE: Readonly<Record<ControllerCommandSet, string>> = {
  'creality-falcon-a1-pro':
    'Frame sends M9 just before Start, which can leave the first air-assisted operation ' +
    'without air, and jogs, settings reads and Home use $J=, $$ and $H, where ' +
    "Creality's A1 Pro configuration uses G1 jogs, no settings read, and $HX then $HY.",
};

/**
 * Builds advisory Job Review warnings from the configured, active, and detected identities.
 * @param configured Controller selected by the project profile.
 * @param active Driver bound to the current connection.
 * @param detected Firmware family inferred from the current session, or `null` when unknown.
 * @returns Zero or one non-blocking identity warning.
 */
export function controllerIdentityWarnings(
  configured: ControllerKind,
  active: ControllerKind,
  detected: ControllerKind | null,
): ReadonlyArray<string> {
  const configuredLabel = controllerLabel(configured);
  const activeLabel = controllerLabel(active);
  if (active !== configured) {
    const detectedDetail =
      detected === null
        ? 'firmware detection is still unknown'
        : `detected firmware is ${controllerLabel(detected)}`;
    return [
      `${CONTROLLER_IDENTITY_WARNING_PREFIX} the selected profile is ${configuredLabel}, ` +
        `but the active connection uses ${activeLabel} and ${detectedDetail}. KerfDesk will ` +
        'prepare output from the selected profile while live parsing and controller commands use ' +
        'the active connection. Reconnect using the selected profile before relying on ' +
        'controller-specific behavior.',
    ];
  }
  // Connect binds the driver from the profile and a banner never switches it,
  // so a reconnect with this profile hears the same banner. The advice names
  // the profile change that can clear it (ADR-375).
  if (detected !== null && detected !== configured) {
    const detectedLabel = controllerLabel(detected);
    return [
      `${CONTROLLER_IDENTITY_WARNING_PREFIX} the selected profile and active connection use ` +
        `${configuredLabel}, but the firmware banner identifies ${detectedLabel}. The banner is ` +
        'identity evidence and does not choose the driver, so reconnecting with this profile ' +
        `hears the same banner. If this machine runs ${detectedLabel}, choose ${detectedLabel} ` +
        'as its controller in Machine Setup, then reconnect.',
    ];
  }
  if (detected === null) {
    return [
      `${CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX} no firmware family has been detected in this ` +
        `controller session. The selected profile and active connection use ${configuredLabel}; ` +
        'verify the controller identity before relying on controller-specific behavior.',
    ];
  }
  return [];
}

/**
 * Job Review's controller identity evidence (ADR-375): the family and banner
 * checks above, the command set Connect bound from the profile (ADR-322 §4),
 * and a saved preset copy that lacks its preset's command set.
 * @param configured Controller fields of the project profile.
 * @param live Driver bound to the current connection and the banner's family.
 * @returns At most one live-identity warning, then any saved-copy warning.
 */
export function liveControllerIdentityWarnings(
  configured: ConfiguredControllerIdentity,
  live: LiveControllerIdentity,
): ReadonlyArray<string> {
  const kind = configured.controllerKind ?? 'grbl-v1.1';
  const commandSet = commandSetMismatchWarning(kind, configured.controllerCommandSet, live);
  return [
    ...(commandSet === null
      ? controllerIdentityWarnings(kind, live.activeControllerKind, live.detectedControllerKind)
      : [commandSet]),
    ...stalePresetCommandSetWarnings(configured),
  ];
}

// Connect binds the command set from the profile as well as the family, so a
// profile changed while connected keeps the old commands until a reconnect.
// Home, jog and Frame follow the connection: a Falcon profile on a generic
// grblHAL connection Frames with M5 then M9 just before Start (ADR-323).
function commandSetMismatchWarning(
  kind: ControllerKind,
  profileCommandSet: ControllerCommandSet | undefined,
  live: LiveControllerIdentity,
): string | null {
  if (live.activeControllerKind !== kind) return null;
  const profileSet = selectControllerDriver(kind, profileCommandSet).commandSet ?? null;
  const activeSet = live.activeControllerCommandSet ?? null;
  if (profileSet === activeSet) return null;
  return (
    `${CONTROLLER_IDENTITY_WARNING_PREFIX} the selected profile uses ` +
    `${commandSetName(kind, profileSet)}, but the active connection uses ` +
    `${commandSetName(kind, activeSet)}. Home, jog, Frame and other live controller commands ` +
    "follow the active connection. Reconnect to use the profile's command set, or update the " +
    'profile in Machine Setup if the active command set is the right one for this machine.'
  );
}

// Advisory only: re-applying the preset is the operator's deliberate choice,
// and nothing is migrated on its own (ADR-375, as ADR-370 does for air).
function stalePresetCommandSetWarnings(
  configured: ConfiguredControllerIdentity,
): ReadonlyArray<string> {
  const update = presetCommandSetUpdate(configured);
  if (update === null) return [];
  const kind = configured.controllerKind ?? 'grbl-v1.1';
  return [
    `${CONTROLLER_IDENTITY_WARNING_PREFIX} this machine profile is a copy of the ` +
      `${update.presetName} preset saved before the preset had its own command set, so ` +
      `KerfDesk connects with ${commandSetName(kind, null)} instead of ` +
      `${commandSetName(kind, update.commandSet)}. ` +
      `${GENERIC_COMMANDS_CONSEQUENCE[update.commandSet]} Re-apply the ${update.presetName} ` +
      'preset in Machine Setup, then reconnect.',
  ];
}

/**
 * Replaces stale identity text in a Job Review model with current session evidence.
 * @param model Review model whose unrelated warnings must be retained.
 * @param configured Controller fields of the project profile.
 * @param live Driver bound to the current connection and the banner's family.
 * @returns A review model with current identity evidence first in its warning list.
 */
export function refreshControllerIdentityWarnings(
  model: JobReviewModel,
  configured: ConfiguredControllerIdentity,
  live: LiveControllerIdentity,
): JobReviewModel {
  const retained = model.warnings.filter((warning) => !isControllerIdentityWarning(warning));
  return {
    ...model,
    warnings: [...liveControllerIdentityWarnings(configured, live), ...retained],
  };
}

/**
 * Identifies warning strings owned by the controller-identity disclosure.
 * @param warning Warning text to classify.
 * @returns `true` for mismatch or unconfirmed-identity warnings.
 */
export function isControllerIdentityWarning(warning: string): boolean {
  return (
    warning.startsWith(CONTROLLER_IDENTITY_WARNING_PREFIX) ||
    warning.startsWith(CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX)
  );
}

function controllerLabel(kind: ControllerKind): string {
  return selectControllerDriver(kind).label;
}

function commandSetName(kind: ControllerKind, commandSet: ControllerCommandSet | null): string {
  return commandSet === null
    ? `the generic ${controllerLabel(kind)} commands`
    : `the ${selectControllerDriver(kind, commandSet).label}`;
}
