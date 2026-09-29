import { selectControllerDriver } from '../../../core/controllers';
import {
  controllerCompatibleProfile,
  type ControllerKind,
  type ControllerProfileCorrection,
  type DeviceProfile,
} from '../../../core/devices';

export function controllerProfileForSelection(
  profile: DeviceProfile,
  controllerKind: ControllerKind,
): DeviceProfile {
  const compatible = controllerCompatibleProfile(profile, controllerKind).profile;
  // Switching to another protocol family drops the vendor command contract.
  // Correcting a GRBL / grblHAL label keeps the machine's vendor commands.
  const { controllerCommandSet, ...familyProfile } = compatible;
  return {
    ...familyProfile,
    ...(controllerCommandSet !== undefined &&
    (controllerKind === 'grbl-v1.1' || controllerKind === 'grblhal')
      ? { controllerCommandSet }
      : {}),
    controllerKind,
    baudRate: selectControllerDriver(controllerKind).defaultBaudRate,
    minPowerS: 0,
    maxPowerS: defaultPowerScale(controllerKind),
  };
}

/** One draft value that choosing another controller changes. */
export type ControllerSelectionChange = {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
};

/**
 * What choosing `controllerKind` changes in the draft besides the controller:
 * the compatibility policy's streaming, receive-window and dialect corrections,
 * a dropped vendor command set, the baud and power range the selection resets,
 * and a scan-offset calibration it clears. Machine Setup lists these before
 * "Use detected" applies them (ADR-375).
 */
export function controllerSelectionChanges(
  profile: DeviceProfile,
  controllerKind: ControllerKind,
): ReadonlyArray<ControllerSelectionChange> {
  const next = controllerProfileForSelection(profile, controllerKind);
  return [
    ...controllerCompatibleProfile(profile, controllerKind).corrections.flatMap(correctionChange),
    ...changed('Vendor commands', vendorCommandsText(profile), vendorCommandsText(next)),
    ...changed('Baud rate', String(baudRateOf(profile)), String(baudRateOf(next))),
    ...changed('Power range', powerRangeText(profile), powerRangeText(next)),
    ...scanCalibrationChange(profile, next),
  ];
}

function correctionChange(
  correction: ControllerProfileCorrection,
): ReadonlyArray<ControllerSelectionChange> {
  const { field, from, to, reason } = correction;
  switch (field) {
    case 'controllerKind':
      return [];
    case 'streamingMode':
      return [{ label: 'Streaming', from, to, reason }];
    case 'rxBufferBytes':
      return [{ label: 'RX window', from: `${from} bytes`, to: `${to} bytes`, reason }];
    case 'gcodeDialect':
      return [{ label: 'Output dialect', from, to, reason }];
  }
}

function changed(
  label: string,
  from: string,
  to: string,
): ReadonlyArray<ControllerSelectionChange> {
  return from === to ? [] : [{ label, from, to }];
}

function vendorCommandsText(profile: DeviceProfile): string {
  return profile.controllerCommandSet === undefined
    ? 'None'
    : selectControllerDriver(profile.controllerKind, profile.controllerCommandSet).label;
}

function baudRateOf(profile: DeviceProfile): number {
  return profile.baudRate ?? selectControllerDriver(profile.controllerKind).defaultBaudRate;
}

function powerRangeText(profile: DeviceProfile): string {
  return `${profile.minPowerS}–${profile.maxPowerS} S`;
}

// controllerCompatibleProfile clears a calibration when the controller or the
// output dialect changes: the offsets were measured with the old ones.
function scanCalibrationChange(
  before: DeviceProfile,
  after: DeviceProfile,
): ReadonlyArray<ControllerSelectionChange> {
  const points = before.scanningOffsets.length;
  if (points === 0 || after.scanningOffsets.length > 0) return [];
  const status = before.scanOffsetCalibrationStatus;
  const statusText =
    status === 'verified' ? ', verified' : status === 'pending' ? ', verification pending' : '';
  return [
    {
      label: 'Raster scan-offset calibration',
      from: `${points} point${points === 1 ? '' : 's'}${statusText}`,
      to: 'Not calibrated',
      reason: 'It was measured with the current controller; calibrate again after the change.',
    },
  ];
}

function defaultPowerScale(controllerKind: ControllerKind): number {
  if (controllerKind === 'marlin' || controllerKind === 'fluidnc') return 255;
  if (controllerKind === 'smoothieware') return 1;
  return 1000;
}
