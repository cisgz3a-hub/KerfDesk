import {
  isScanOffsetCalibrationStatus,
  isScanOffsetTableForProfile,
} from '../../core/devices/scan-offset-profile';

export function validateProjectScanOffsetProfile(device: Record<string, unknown>): string | null {
  const offsets = device['scanningOffsets'];
  const bedWidth = device['bedWidth'];
  const bedHeight = device['bedHeight'];
  if (
    offsets !== undefined &&
    (typeof bedWidth !== 'number' ||
      typeof bedHeight !== 'number' ||
      !isScanOffsetTableForProfile(offsets, { bedWidth, bedHeight }))
  ) {
    return 'missing or invalid `device.scanningOffsets`';
  }

  const status = device['scanOffsetCalibrationStatus'];
  if (status === undefined) return null;
  if (!isScanOffsetCalibrationStatus(status) || !Array.isArray(offsets) || offsets.length === 0) {
    return 'missing or invalid `device.scanOffsetCalibrationStatus`';
  }
  return null;
}
