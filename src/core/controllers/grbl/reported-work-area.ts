// reported-work-area - the XY work area a GRBL-family `$$` describes (rolling
// audit v8 N2-P2-1, ADR-637 Amendment 4).
//
// `$130`/`$131` are each axis's maximum travel. Stock GRBL's homed envelope is
// all of it: the switch sits on one edge and the head rests the pull-off inside
// it (jog-travel-limits.ts), so its work area is `$130` × `$131` as before.
// grblHAL with hard limits on takes the pull-off off the far edge too, and off
// the homing edge unless "Set machine origin to 0" (`$22` bit 3) puts 0 where
// the head rests after the pull-off:
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139
// The published Falcon A1 Pro reads `$21=1 $22=43 $23=3 $27=5 $130=363
// $131=273`, a 0..358 x 0..268 envelope: Creality's 358 x 268 mm area.

import type { ControllerKind } from '../../devices/device-profile';
import { jogTravelLimits, type JogTravelFirmware } from './jog-travel-limits';
import type { ControllerSettingsSnapshot } from './parse-settings';
import { roundToThousandth } from '../../util/rounding';

export type ReportedWorkArea = { readonly widthMm: number; readonly heightMm: number };

/**
 * Which GRBL family's travel envelope a session has, from the profile's driver
 * and the banner, or null for another family. A "Grbl 1.1" banner can come from
 * grblHAL in a compatibility build, so a grblHAL profile or banner selects
 * grblHAL.
 */
export function travelEnvelopeFirmware(
  activeControllerKind: ControllerKind | undefined,
  detectedControllerKind: ControllerKind | null | undefined,
): JogTravelFirmware | null {
  const detected = detectedControllerKind ?? null;
  if (detected !== null && detected !== 'grbl-v1.1' && detected !== 'grblhal') return null;
  if (activeControllerKind === 'grblhal' || detected === 'grblhal') return 'grblhal';
  return activeControllerKind === 'grbl-v1.1' ? 'grbl' : null;
}

/**
 * The work area these settings give a homed machine, or null without both
 * travels. It is `$130` × `$131` except on grblHAL with homing on, where it is
 * the homed envelope's size. A grblHAL dump that leaves out `$21`, `$27` or
 * force origin keeps the travel rather than guess the inset.
 */
export function reportedWorkArea(
  settings: ControllerSettingsSnapshot,
  firmware: JogTravelFirmware | null,
): ReportedWorkArea | null {
  const { bedWidth, bedHeight } = settings;
  if (bedWidth === undefined || bedHeight === undefined) return null;
  const travel = { widthMm: bedWidth, heightMm: bedHeight };
  return firmware === 'grblhal' ? (grblHalHomedArea(settings, travel) ?? travel) : travel;
}

function grblHalHomedArea(
  settings: ControllerSettingsSnapshot,
  travel: ReportedWorkArea,
): ReportedWorkArea | null {
  const { hardLimitsEnabled, homingPullOffMm, homingDirectionMask } = settings;
  if (settings.homingEnabled !== true || homingDirectionMask === undefined) return null;
  // With hard limits off grblHAL's envelope is the whole travel.
  if (hardLimitsEnabled !== true) return null;
  if (homingPullOffMm === undefined || settings.homingForceSetOrigin === undefined) return null;
  const limits = jogTravelLimits({
    firmware: 'grblhal',
    travelMm: { x: travel.widthMm, y: travel.heightMm },
    homingDirectionMask,
    forceOrigin: settings.homingForceSetOrigin,
    hardLimits: true,
    pullOffMm: homingPullOffMm,
    // The envelope itself, without the jog rounding margin.
    softLimitsEnforced: false,
    stepsPerMm: { x: undefined, y: undefined },
  });
  if (limits === null) return null;
  return {
    widthMm: roundToThousandth(limits.x.maxMm - limits.x.minMm),
    heightMm: roundToThousandth(limits.y.maxMm - limits.y.minMm),
  };
}
