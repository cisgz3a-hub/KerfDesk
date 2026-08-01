import type { DeviceProfile } from '../../core/devices';
import { effectiveScanOffsetCalibrationStatus } from '../../core/devices/scan-offset-profile';
import type { Layer, SceneObject, TracedImage } from '../../core/scene';

/**
 * Applies the conservative one-way default to fresh, uncalibrated generic
 * traced Scan Line operations while preserving explicit or qualified choices.
 */
export function applyFreshTraceScanDirection(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
  device: DeviceProfile,
): ReadonlyArray<Layer> {
  if (!shouldDefaultTraceToOneWay(object, device)) return operations;
  return operations.map((operation) =>
    operation.mode === 'fill' && operation.fillStyle === 'scanline'
      ? { ...operation, fillBidirectional: false }
      : operation,
  );
}

function shouldDefaultTraceToOneWay(object: SceneObject, device: DeviceProfile): boolean {
  if (object.kind !== 'traced-image') return false;
  if (object.traceMode === 'centerline' || object.traceMode === 'edge') return false;
  if (hasExplicitTraceScanPolicy(object)) return false;
  if (device.gcodeDialect.dialectId === 'neotronics-4040-safe') return false;
  const calibrationStatus = effectiveScanOffsetCalibrationStatus(device);
  return calibrationStatus !== 'verified' && calibrationStatus !== 'legacy-verified';
}

function hasExplicitTraceScanPolicy(object: TracedImage): boolean {
  const override = object.operationOverride;
  return (
    override?.mode === 'line' ||
    override?.fillStyle === 'offset' ||
    override?.fillStyle === 'island' ||
    typeof override?.fillBidirectional === 'boolean'
  );
}
