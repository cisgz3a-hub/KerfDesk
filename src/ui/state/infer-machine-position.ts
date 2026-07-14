import type { StatusReport } from '../../core/controllers/grbl';
import type { WorkCoordinateOffset } from './origin-actions';

export function inferCurrentMachinePosition(
  report: StatusReport | null,
  wcoCache: WorkCoordinateOffset | null,
): WorkCoordinateOffset | null {
  if (report?.mPos !== null && report?.mPos !== undefined) return report.mPos;
  if (report?.wPos !== null && report?.wPos !== undefined && wcoCache !== null) {
    return {
      x: report.wPos.x + wcoCache.x,
      y: report.wPos.y + wcoCache.y,
      z: report.wPos.z + wcoCache.z,
    };
  }
  return null;
}

/**
 * The bit's Z in the WORK frame right now: WPos.z directly, or MPos.z minus the
 * cached work offset. Null when the height is unknowable (MPos without a cached
 * WCO, or no report). The Z-only dual of {@link inferCurrentMachinePosition},
 * used by the Zero-Z overwrite guard and CNC framing to reason about how far the
 * bit sits above the established work zero.
 */
export function currentWorkZMm(
  report: Pick<StatusReport, 'mPos' | 'wPos'> | null,
  wcoCache: WorkCoordinateOffset | null,
): number | null {
  if (report?.wPos !== null && report?.wPos !== undefined) return report.wPos.z;
  if (report?.mPos !== null && report?.mPos !== undefined && wcoCache !== null) {
    return report.mPos.z - wcoCache.z;
  }
  return null;
}
