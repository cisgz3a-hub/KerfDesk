// jog-travel-limits - the machine XY a manual move may target on GRBL-family
// firmware whose travel settings were read this session (controller audit 2,
// ADR-375).
//
// With soft limits on, stock GRBL rejects a whole `$J=` line with error:15
// when its machine target leaves [-travel, 0], whatever the homing state:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/jog.c#L35-L37
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L346-L349
// Homing puts the switch point on that envelope's homing edge and rests `$27`
// inside it so the switch does not trip again; a move ending on the edge can
// close it and, with `$21=1`, reset the controller into ALARM:1:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L110-L128
// grblHAL checks homed axes only, and with hard limits on its envelope is
// already pulled in by the pull-off on both edges:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L114-L136
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/motion_control.c#L832-L835

import { deriveMachineEnvelope, type AxisBounds } from './machine-envelope';
import { isFinitePositive } from '../../util/finite';

export type JogTravelFirmware = 'grbl' | 'grblhal';

export type JogTravelSettings = {
  readonly firmware: JogTravelFirmware;
  /** `$130` / `$131`. */
  readonly travelMm: { readonly x: number; readonly y: number };
  /** `$23`. */
  readonly homingDirectionMask: number;
  /** Force set origin: stock GRBL's `[OPT:]` Z (HOMING_FORCE_SET_ORIGIN) or
   *  grblHAL's `$22` bit 3; null when this session has not read it. */
  readonly forceOrigin: boolean | null;
  /** `$21` bit 0; undefined when `$21` was not read as a non-negative integer. */
  readonly hardLimits: boolean | undefined;
  /** `$27`; undefined when not read. */
  readonly pullOffMm: number | undefined;
  /** The firmware rejects a target outside its envelope right now. */
  readonly softLimitsEnforced: boolean;
  /** `$100` / `$101`; undefined when not read. */
  readonly stepsPerMm: { readonly x: number | undefined; readonly y: number | undefined };
};

export type JogTravelLimits = { readonly x: AxisBounds; readonly y: AxisBounds };

/** The Z half of the same envelope: `$132`, `$23` bit 2 and `$102`. */
export type ZTravelSettings = Omit<JogTravelSettings, 'travelMm' | 'stepsPerMm'> & {
  readonly travelZMm: number;
  readonly stepsPerMmZ: number | undefined;
};

type InsetSettings = Pick<
  JogTravelSettings,
  'firmware' | 'forceOrigin' | 'hardLimits' | 'pullOffMm' | 'softLimitsEnforced'
>;

// Hard limits on but `$27` unread: gSender keeps the same 1 mm off the edge
// (https://github.com/Sienci-Labs/gsender/blob/14c7084c1091dbd500d675d0dabda885484bf12e/src/server/controllers/Grbl/GrblController.js#L2119-L2133).
const UNKNOWN_PULL_OFF_MM = 1;
// A jog's distance is measured from the reported MPos, but the firmware adds
// it to its own position: the status report rounds MPos to 3 decimals, and
// after a move that ran to its end the firmware holds that move's unrounded
// target while MPos shows the step the motors reached, up to half a step away
// (only a jog cancel syncs the two). A target aimed exactly at an enforced
// edge can land past it and be refused, so every edge keeps this margin on top
// of its switch inset: 0.01 mm, or where a step is coarser half a step plus
// 0.002 mm for the report's rounding (0.0005 mm, or 0.00005 in with `$13=1`).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L142-L143
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L863-L864
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L385-L390
const ROUNDING_MARGIN_MM = 0.01;
const REPORT_ROUNDING_MM = 0.002;
// `$100` or `$101` unread: room for axes down to about 10 steps/mm.
const UNKNOWN_STEP_MARGIN_MM = 0.05;

/** The XY machine box a manual move may target, or null when the envelope is
 *  not known from these settings. */
export function jogTravelLimits(settings: JogTravelSettings): JogTravelLimits | null {
  const { x: travelX, y: travelY } = settings.travelMm;
  const mask = settings.homingDirectionMask;
  if (!isFinitePositive(travelX) || !isFinitePositive(travelY) || !isDirectionMask(mask)) {
    return null;
  }
  // Only the X and Y bits matter here; a grblHAL mask can carry more axes.
  const xyMask = mask & 3;
  // Unread force origin leaves a negative-homing axis in [0, travel] or in
  // [-travel, 0], which share no usable span.
  if (settings.forceOrigin === null && xyMask !== 0) return null;
  const envelope = deriveMachineEnvelope(
    { x: travelX, y: travelY, z: 1 },
    xyMask,
    settings.forceOrigin === true,
  );
  const x = insetAxis(settings, envelope.x, (xyMask & 1) !== 0, settings.stepsPerMm.x);
  const y = insetAxis(settings, envelope.y, (xyMask & 2) !== 0, settings.stepsPerMm.y);
  return x === null || y === null ? null : { x, y };
}

/** The machine Z range a commanded move may reach, inset from the homing
 *  switch as the XY box is, or null when these settings do not fix it. A job's
 *  park lift is checked against its top (ADR-491 Amendment 2). */
export function zTravelLimits(settings: ZTravelSettings): AxisBounds | null {
  const mask = settings.homingDirectionMask;
  if (!isFinitePositive(settings.travelZMm) || !isDirectionMask(mask)) return null;
  const homesNegative = (mask & 4) !== 0;
  if (settings.forceOrigin === null && homesNegative) return null;
  const envelope = deriveMachineEnvelope(
    { x: 1, y: 1, z: settings.travelZMm },
    mask & 4,
    settings.forceOrigin === true,
  );
  return insetAxis(settings, envelope.z, homesNegative, settings.stepsPerMmZ);
}

function insetAxis(
  settings: InsetSettings,
  envelope: AxisBounds,
  homesNegative: boolean,
  stepsPerMm: number | undefined,
): AxisBounds | null {
  const pullOff = switchPullOffMm(settings);
  // With force origin the homing edge is where the head rests after the
  // pull-off, already clear of the switch.
  const homingEdgeInset = settings.forceOrigin === true ? 0 : pullOff;
  // grblHAL's own envelope already ends a pull-off short of both edges, so the
  // margin goes on top of the inset rather than inside it.
  const farEdgeInset = settings.firmware === 'grblhal' ? pullOff : 0;
  const margin = settings.softLimitsEnforced ? positionMarginMm(stepsPerMm) : 0;
  const minInset = homesNegative ? homingEdgeInset : farEdgeInset;
  const maxInset = homesNegative ? farEdgeInset : homingEdgeInset;
  const minMm = envelope.minMm + minInset + margin;
  const maxMm = envelope.maxMm - maxInset - margin;
  return maxMm > minMm ? { minMm, maxMm } : null;
}

function positionMarginMm(stepsPerMm: number | undefined): number {
  if (stepsPerMm === undefined || !isFinitePositive(stepsPerMm)) return UNKNOWN_STEP_MARGIN_MM;
  return Math.max(ROUNDING_MARGIN_MM, 0.5 / stepsPerMm + REPORT_ROUNDING_MM);
}

// An unknown `$21` keeps the inset: the narrower box suits either value.
function switchPullOffMm(settings: InsetSettings): number {
  if (settings.hardLimits === false) return 0;
  const pullOff = settings.pullOffMm;
  return pullOff !== undefined && Number.isFinite(pullOff) && pullOff >= 0
    ? pullOff
    : UNKNOWN_PULL_OFF_MM;
}

function isDirectionMask(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
