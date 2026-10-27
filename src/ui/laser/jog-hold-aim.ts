// jog-hold-aim - where a press-and-hold jog may travel, shared by the PC's
// JogPad and the phone's hold (ADR-375 decision 3, Amendments 4 and 8).
//
// A hold jog runs to the travel edge, so it needs the controller's own travel
// envelope. MPos is in native machine coordinates, which match the profile bed
// only through a verified native frame: homed stock GRBL puts machine space
// into negative numbers, and a machine without homing starts at MPos 0,0
// wherever the head was at power-up. Clamping raw MPos against 0..bed made a
// held arrow do nothing toward the origin and overshoot the other way (audit
// jog-home-origin-3). With soft limits on, the controller checks the target in
// MPos with or without a verified frame and refuses the whole line
// (error:15), so this session's `$$` bounds the hold as well, and the homing
// edge stays the pull-off clear of its switch (ADR-375). Stock GRBL checks from
// its own MPos even after an Unlock without Home, when KerfDesk hides the
// position, so that clamp alone aims from the controller's number then. A Home
// in this session ties MPos to the switch, so a homed grblHAL, which never has
// a frame, keeps the pull-off clear of its switch with soft limits off too
// (ADR-375 Amendment 4). With no frame, no soft limits and no Home, the hold
// asks for full travel and relies on release plus the jog-cancel byte, as it
// does with no position.

import type { StatusReport } from '../../core/controllers/grbl';
import { machineBoundsForDevice, type DeviceProfile, type MachineBounds } from '../../core/devices';
import type { NativeXyBounds } from '../../core/devices/native-bed-frame';
import type { Vec2 } from '../../core/scene';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { withheldControllerMPos } from '../state/laser-status-position';
import {
  firmwareJogCheckPosition,
  resolveFirmwareZLimits,
  resolveManualMotionLimits,
} from '../state/manual-motion-limits';
import { resolveNativeBedFrame, type NativeBedEvidence } from '../state/native-bed-frame';
import type { WorkCoordinateOffset } from '../state/origin-actions';

export type HoldJogInput = {
  readonly device: DeviceProfile;
  readonly evidence: NativeBedEvidence;
  readonly statusReport: StatusReport | null;
  readonly wcoCache: WorkCoordinateOffset | null;
  readonly reportInches: boolean;
};

/** The XY box a hold may reach and the machine position it measures from (`continuousJogVector`). */
export function holdJogAim(input: HoldJogInput): {
  readonly bounds: MachineBounds;
  readonly position: Vec2 | null;
} {
  const { device, evidence, statusReport, reportInches } = input;
  const limits = resolveManualMotionLimits(resolveNativeBedFrame(device, evidence), evidence);
  if (limits === null) return { bounds: machineBoundsForDevice(device), position: null };
  return {
    bounds: nativeTravel(limits),
    position:
      inferCurrentMachinePosition(statusReport, input.wcoCache, reportInches) ??
      firmwareJogCheckPosition(evidence, withheldControllerMPos(statusReport), reportInches),
  };
}

/**
 * How far a held Z jog may run toward `direction` inside the firmware's Z
 * envelope, the one a CNC park lift is checked against (ADR-491 Amendment 2),
 * or null when that envelope or the head's machine Z is unknown. Like the XY
 * aim, it measures from the controller's own MPos when KerfDesk withholds the
 * position, since stock GRBL with `$20=1` checks the Z target against it too
 * (ADR-375 Amendment 10).
 */
export function holdZRoomMm(input: HoldJogInput, direction: -1 | 1): number | null {
  const { evidence, statusReport, reportInches } = input;
  const limits = resolveFirmwareZLimits(evidence, input.device.zTravelMm);
  const position =
    inferCurrentMachinePosition(statusReport, input.wcoCache, reportInches) ??
    firmwareJogCheckPosition(evidence, withheldControllerMPos(statusReport), reportInches);
  if (limits === null || position === null) return null;
  return Math.max(0, direction > 0 ? limits.maxMm - position.z : position.z - limits.minMm);
}

function nativeTravel(bounds: NativeXyBounds): MachineBounds {
  return { ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}
