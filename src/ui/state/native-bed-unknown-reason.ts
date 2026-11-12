// native-bed-unknown-reason — why KerfDesk has no bed mapping, in the
// operator's words, with what can be done today (annoyance audit A2 B3-P2-2,
// ADR-322 Amendment 4).
//
// One sentence said "Home with a supported coordinate mapping" to everyone.
// On three families no Home can help, because nothing they report places their
// homed coordinates on the bed:
// - FluidNC sets a homed axis to its `homing/mpos_mm` config value and derives
//   its limits from that value, `max_travel_mm` and `positive_direction`. Its
//   `$$` reports `$130`-`$132` (travel) and `$23` (direction) but not
//   `mpos_mm`, and has no `$27`.
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Machine/Homing.cpp
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Limit.cpp
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SettingsDefinitions.cpp
// - Marlin sets a homed axis to `base_home_pos(axis)`, a build constant.
//   KerfDesk reads no travel or home position from Marlin.
//   https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp
// - Smoothieware sets a homed axis to `homing_position + home_offset` from its
//   config file (0 or 200 by default), and no command KerfDesk sends prints it.
//   https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp
// An unknown mapping only limits display, Move laser here and advisories. It
// never gates Frame or Start (ADR-228).

import type { DeviceProfile } from '../../core/devices';
import { formatUpTo3Decimals } from '../../core/util/number-format';
import {
  nativeBedFrameStatus,
  type NativeBedEvidence,
  type NativeBedUnknownReason,
} from './native-bed-frame';

/** What works on every machine, mapped or not. */
export const BED_UNKNOWN_WORKAROUND =
  'Place the job with User Origin or Current Position and run Frame to see where it burns.';

/** Null when the mapping is known. */
export function nativeBedUnknownReason(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): NativeBedUnknownReason | null {
  return nativeBedFrameStatus(device, evidence).reason;
}

/** Why there is no mapping, as one or two sentences. */
export function nativeBedUnknownWhy(reason: NativeBedUnknownReason, device: DeviceProfile): string {
  switch (reason.kind) {
    case 'firmware':
      return firmwareWhy(reason.firmware);
    case 'homing-off':
      return 'This machine profile has homing off, so there is no fixed point to measure the bed from. If the machine has homing switches, turn homing on in Machine Setup, then Home.';
    case 'not-homed':
      return 'The machine has not been homed in this connection. Press Home: the bed position is known once Home completes.';
    case 'settings-unread':
      return "KerfDesk has not read this controller's settings in this connection, and it needs them to place the bed. Reconnect, or read the settings in Machine Setup, then Home.";
    case 'report-incomplete':
      return "The controller's settings report does not give a homed area: KerfDesk needs homing on, X and Y both in the homing cycle, and the travel, pull-off and origin settings.";
    case 'bed-differs':
      return `The machine profile's bed is ${size(device.bedWidth, device.bedHeight)}, but the controller's homed area is ${size(reason.homedArea.widthMm, reason.homedArea.heightMm)}, so KerfDesk cannot tell where the bed sits inside it. Machine Setup offers the controller's values.`;
  }
}

/** Whether anything the operator does in this session can earn a mapping. */
export function nativeBedMappingIsReachable(reason: NativeBedUnknownReason): boolean {
  return reason.kind !== 'firmware';
}

function firmwareWhy(
  firmware: Extract<NativeBedUnknownReason, { kind: 'firmware' }>['firmware'],
): string {
  switch (firmware) {
    case 'fluidnc':
      return 'FluidNC does not report where its homed coordinates sit on the bed: the homing position (mpos_mm) is in its config file, not in the settings it sends. So Home does not tell KerfDesk where the bed is.';
    case 'marlin':
      return "Marlin's home position and travel are fixed in the firmware build, and KerfDesk does not read them. So Home does not tell KerfDesk where the bed is.";
    case 'smoothieware':
      return "Smoothieware's homing position is in the board's config file, which KerfDesk does not read. So Home does not tell KerfDesk where the bed is.";
    case 'vendor-mismatch':
      return "The controller's greeting does not match the controller type in the machine profile, so KerfDesk does not apply either one's coordinate rules. Check the controller type in Machine Setup.";
    case 'grbl-v1.1':
    case 'grblhal':
    case 'ruida':
    case 'moshi':
    case 'lihuiyu':
    case 'jcz-lmc':
      return 'This controller does not report how its coordinates map to the bed.';
  }
}

/** Job Review's extra sentence after the general unknown-bed note. */
export function nativeBedUnknownReviewNote(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): string | null {
  const reason = nativeBedUnknownReason(device, evidence);
  return reason === null ? null : `Why: ${nativeBedUnknownWhy(reason, device)}`;
}

/** The refusal when a canvas click cannot be turned into a machine target. */
export function positionLaserUnavailableMessage(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): string {
  const reason = nativeBedUnknownReason(device, evidence);
  const lead = 'Move laser here needs to know where the bed is.';
  if (reason === null) return lead;
  const instead = nativeBedMappingIsReachable(reason) ? '' : ' Jog the head to the point instead.';
  return `${lead} ${nativeBedUnknownWhy(reason, device)}${instead}`;
}

/** The status line's hover while the canvas shows a relative view. */
export function relativeViewHelp(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
  connected: boolean,
): string {
  const lead =
    "KerfDesk can't yet tell where on the bed this job will burn, so the start markers are shown relative to your origin.";
  const reason = connected ? nativeBedUnknownReason(device, evidence) : disconnectedReason(device);
  if (reason === null) return lead;
  if (!connected && nativeBedMappingIsReachable(reason) && reason.kind !== 'homing-off') {
    return `${lead} This is normal until your machine is connected and homed.`;
  }
  return `${lead} ${nativeBedUnknownWhy(reason, device)} ${BED_UNKNOWN_WORKAROUND}`;
}

// Before a connection only the profile says which firmware it will be.
function disconnectedReason(device: DeviceProfile): NativeBedUnknownReason {
  const kind = device.controllerKind ?? 'grbl-v1.1';
  const mappable = kind === 'grbl-v1.1' || kind === 'grblhal';
  if (!mappable) return { kind: 'firmware', firmware: kind };
  return device.homing.enabled ? { kind: 'not-homed' } : { kind: 'homing-off' };
}

function size(widthMm: number, heightMm: number): string {
  return `${formatUpTo3Decimals(widthMm)} × ${formatUpTo3Decimals(heightMm)} mm`;
}
