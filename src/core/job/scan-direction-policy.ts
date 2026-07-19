import type { DeviceProfile } from '../devices/device-profile';
import { effectiveScanOffsetCalibrationStatus } from '../devices/scan-offset-profile';
import type { Layer } from '../scene';

export type ScanDirectionReason =
  | 'requested-one-way'
  | 'requested-bidirectional'
  | 'calibrated-bidirectional'
  | 'calibration-baseline'
  | 'calibration-verification'
  | 'expert-override'
  | 'sensitive-island-one-way'
  | 'pending-calibration-4040-fallback'
  | 'uncalibrated-4040-fallback';

export type EffectiveScanDirection = {
  readonly bidirectional: boolean;
  readonly reason: ScanDirectionReason;
};

export function resolveEffectiveScanDirection(
  device: DeviceProfile,
  requestedBidirectional: boolean,
  allowUncalibratedBidirectionalScan = false,
  calibrationMode?: Layer['scanOffsetCalibrationMode'],
): EffectiveScanDirection {
  if (!requestedBidirectional) {
    return { bidirectional: false, reason: 'requested-one-way' };
  }
  if (device.gcodeDialect.dialectId !== 'neotronics-4040-safe') {
    return { bidirectional: true, reason: 'requested-bidirectional' };
  }
  if (calibrationMode === 'baseline') {
    return { bidirectional: true, reason: 'calibration-baseline' };
  }
  if (calibrationMode === 'verification' && device.scanningOffsets.length > 0) {
    return { bidirectional: true, reason: 'calibration-verification' };
  }
  const calibrationStatus = effectiveScanOffsetCalibrationStatus(device);
  if (calibrationStatus === 'pending') {
    return { bidirectional: false, reason: 'pending-calibration-4040-fallback' };
  }
  if (calibrationStatus === 'verified' || calibrationStatus === 'legacy-verified') {
    return { bidirectional: true, reason: 'calibrated-bidirectional' };
  }
  if (allowUncalibratedBidirectionalScan) {
    return { bidirectional: true, reason: 'expert-override' };
  }
  return { bidirectional: false, reason: 'uncalibrated-4040-fallback' };
}

export function resolveFillScanDirection(
  device: DeviceProfile,
  layer: Layer,
): EffectiveScanDirection {
  return resolveEffectiveScanDirection(
    device,
    layer.fillBidirectional,
    layer.allowUncalibratedBidirectionalScan,
    layer.scanOffsetCalibrationMode,
  );
}

export function resolveImageScanDirection(
  device: DeviceProfile,
  layer: Layer,
): EffectiveScanDirection {
  return resolveEffectiveScanDirection(
    device,
    layer.imageBidirectional,
    layer.allowUncalibratedBidirectionalScan,
    layer.scanOffsetCalibrationMode,
  );
}

export function resolveIslandFillScanDirection(
  device: DeviceProfile,
  layer: Layer,
  sensitiveIslandFill: boolean,
): EffectiveScanDirection {
  if (sensitiveIslandFill && layer.fillBidirectional) {
    return { bidirectional: false, reason: 'sensitive-island-one-way' };
  }
  return resolveFillScanDirection(device, layer);
}
