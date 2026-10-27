// manual-motion-limits - how far hold-to-jog and Move laser here may travel,
// in native machine coordinates (controller audit 2, ADR-375).
//
// A verified bed frame says where the bed sits in machine space. The firmware
// envelope says which jog targets the controller accepts and where its homing
// switch trips. It comes from this session's `$$` (and `$I`), independent of
// the bed frame and of profile homing: a profile with homing off never gets a
// frame, yet GRBL still refuses a whole hold jog whose target leaves its
// envelope (error:15). After this session's Home the machine position is tied
// to the switch whatever `$20` says, so the switch inset applies with soft
// limits off too (ADR-375 Amendment 4).

import type { ControllerSettingsSnapshot, StatusReport } from '../../core/controllers/grbl';
import {
  jogTravelLimits,
  zTravelLimits,
  type JogTravelFirmware,
  type JogTravelSettings,
} from '../../core/controllers/grbl/jog-travel-limits';
import {
  normalizeReportedMPosToMm,
  type AxisBounds,
} from '../../core/controllers/grbl/machine-envelope';
import type { NativeBedFrame, NativeXyBounds } from '../../core/devices/native-bed-frame';
import type { Vec2 } from '../../core/scene';
import type { NativeBedEvidence } from './native-bed-frame';

/**
 * The native XY box a manual move may reach, or null when there is neither a
 * verified bed frame nor a firmware envelope that the controller enforces or
 * that this session's Home tied to the switch. With a frame, the firmware
 * limits only pull its edges in; a frame with no settings read this session
 * (the Falcon vendor contract) is used as is.
 */
export function resolveManualMotionLimits(
  frame: NativeBedFrame | null,
  evidence: NativeBedEvidence,
): NativeXyBounds | null {
  const settings = jogTravelSettings(evidence);
  const limits = settings === null ? null : jogTravelLimits(settings);
  const firmware =
    limits === null
      ? null
      : { minX: limits.x.minMm, maxX: limits.x.maxMm, minY: limits.y.minMm, maxY: limits.y.maxMm };
  if (frame !== null) {
    return firmware === null
      ? frame.nativeBounds
      : intersectWithFrame(frame.nativeBounds, firmware);
  }
  // A homed grblHAL never has a frame, and with `$20=0` nothing refuses a hold
  // that runs onto its homing switch (ALARM:1, position lost).
  return settings?.softLimitsEnforced === true || evidence.homingState === 'confirmed'
    ? firmware
    : null;
}

/**
 * Where stock GRBL measures a hold's target from while KerfDesk hides the
 * reported position (Unlock without Home, a failed Home, released motors).
 * With `$20=1` GRBL checks every jog target against its own machine position
 * whatever KerfDesk trusts, and `$X` leaves that position as it was, so a hold
 * aimed from an unknown position asked for the full travel, which GRBL refuses
 * whole (error:15) from almost anywhere. Pass only the controller MPos
 * KerfDesk withheld; nothing but the hold clamps, XY and Z, may use it.
 * grblHAL has no envelope before this session's Home, and a WPos-only report
 * ($10=0) carries no MPos: both keep the full request.
 */
export function firmwareJogCheckPosition(
  evidence: NativeBedEvidence,
  hiddenMPos: StatusReport['mPos'] | undefined,
  reportInches: boolean,
): (Vec2 & { readonly z: number }) | null {
  if (hiddenMPos == null || travelFirmware(evidence) !== 'grbl') return null;
  if (currentSessionSettings(evidence)?.softLimitsEnabled !== true) return null;
  const { x, y, z } = hiddenMPos;
  const [xMm, yMm, zMm] = normalizeReportedMPosToMm([x, y, z], reportInches);
  return { x: xMm, y: yMm, z: zMm };
}

/**
 * The machine Z range the firmware's envelope allows, from this session's
 * `$$` (`$132`, `$23`, `$27`, `$21`), or null when it is not known. It is
 * known on the same terms as the XY box: the controller enforces it (`$20=1`)
 * or this session's Home tied the machine position to the switch. Without
 * `$132` the machine profile's recorded Z travel stands in. A CNC job's park
 * lift is checked against its top (ADR-491 Amendment 2).
 */
export function resolveFirmwareZLimits(
  evidence: NativeBedEvidence,
  profileZTravelMm?: number,
): AxisBounds | null {
  const firmware = travelFirmware(evidence);
  const settings = currentSessionSettings(evidence);
  if (firmware === null || settings === null) return null;
  const homed = evidence.homingState === 'confirmed';
  if (firmware === 'grblhal' ? !homed : settings.softLimitsEnabled !== true && !homed) return null;
  const zTravelMm = settings.zTravelMm ?? profileZTravelMm;
  const { homingDirectionMask } = settings;
  if (zTravelMm === undefined || homingDirectionMask === undefined) return null;
  return zTravelLimits({
    firmware,
    travelZMm: zTravelMm,
    homingDirectionMask,
    forceOrigin:
      firmware === 'grbl' ? currentForceOrigin(evidence) : (settings.homingForceSetOrigin ?? null),
    hardLimits: settings.hardLimitsEnabled,
    pullOffMm: settings.homingPullOffMm,
    softLimitsEnforced: settings.softLimitsEnabled === true,
    stepsPerMmZ: settings.stepsPerMmZ,
  });
}

function jogTravelSettings(evidence: NativeBedEvidence): JogTravelSettings | null {
  const firmware = travelFirmware(evidence);
  const settings = currentSessionSettings(evidence);
  if (firmware === null || settings === null) return null;
  // grblHAL keeps no envelope for an axis until it is homed.
  if (firmware === 'grblhal' && evidence.homingState !== 'confirmed') return null;
  const { bedWidth, bedHeight, homingDirectionMask } = settings;
  if (bedWidth === undefined || bedHeight === undefined || homingDirectionMask === undefined) {
    return null;
  }
  return {
    firmware,
    travelMm: { x: bedWidth, y: bedHeight },
    homingDirectionMask,
    forceOrigin:
      firmware === 'grbl' ? currentForceOrigin(evidence) : (settings.homingForceSetOrigin ?? null),
    hardLimits: settings.hardLimitsEnabled,
    pullOffMm: settings.homingPullOffMm,
    softLimitsEnforced: settings.softLimitsEnabled === true,
    stepsPerMm: { x: settings.stepsPerMmX, y: settings.stepsPerMmY },
  };
}

// A vendor command contract does not jog with stock `$J=` lines, and another
// family's banner means neither envelope applies. A "Grbl 1.1" banner can
// also come from grblHAL in a compatibility build, so a grblHAL profile or
// banner selects grblHAL.
function travelFirmware(evidence: NativeBedEvidence): JogTravelFirmware | null {
  if (evidence.activeControllerCommandSet != null) return null;
  const detected = evidence.detectedControllerKind ?? null;
  if (detected !== null && detected !== 'grbl-v1.1' && detected !== 'grblhal') return null;
  if (evidence.activeControllerKind === 'grblhal' || detected === 'grblhal') return 'grblhal';
  return evidence.activeControllerKind === 'grbl-v1.1' ? 'grbl' : null;
}

function currentSessionSettings(evidence: NativeBedEvidence): ControllerSettingsSnapshot | null {
  const epoch = evidence.controllerSessionEpoch;
  const settings = evidence.controllerSettings;
  return settings != null &&
    epoch !== undefined &&
    evidence.controllerSettingsObservation?.sessionEpoch === epoch
    ? settings
    : null;
}

function currentForceOrigin(evidence: NativeBedEvidence): boolean | null {
  const build = evidence.controllerBuildInfo;
  return build != null &&
    evidence.controllerBuildInfoObservation?.sessionEpoch === evidence.controllerSessionEpoch
    ? build.optionCodes.includes('Z')
    : null;
}

// A stock GRBL frame is the same envelope, so this only applies the insets.
// Boxes that do not overlap disagree about where the bed is; keep the frame.
function intersectWithFrame(frame: NativeXyBounds, firmware: NativeXyBounds): NativeXyBounds {
  const bounds = {
    minX: Math.max(frame.minX, firmware.minX),
    maxX: Math.min(frame.maxX, firmware.maxX),
    minY: Math.max(frame.minY, firmware.minY),
    maxY: Math.min(frame.maxY, firmware.maxY),
  };
  return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY ? bounds : frame;
}
