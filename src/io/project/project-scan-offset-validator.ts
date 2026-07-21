import {
  isScanOffsetCalibrationStatus,
  isScanOffsetTable,
} from '../../core/devices/scan-offset-profile';

export function validateProjectScanOffsetProfile(device: Record<string, unknown>): string | null {
  const offsets = device['scanningOffsets'];
  // Structural validity only: finite offsets with unique positive speeds. The
  // magnitude cap (scanOffsetMagnitudeLimitMm) is a heuristic policy, so an
  // over-cap legacy project must still OPEN (rule 7 / ADR-228) — the Start
  // path surfaces the same finding as a Job Review warning instead.
  if (offsets !== undefined && !isScanOffsetTable(offsets)) {
    return 'missing or invalid `device.scanningOffsets`';
  }

  const status = device['scanOffsetCalibrationStatus'];
  if (status === undefined) return null;
  if (!isScanOffsetCalibrationStatus(status) || !Array.isArray(offsets) || offsets.length === 0) {
    return 'missing or invalid `device.scanOffsetCalibrationStatus`';
  }
  return null;
}
