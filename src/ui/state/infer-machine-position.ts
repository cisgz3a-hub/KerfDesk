import type { StatusReport } from '../../core/controllers/grbl';
import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import type { WorkCoordinateOffset } from './origin-actions';

export function inferCurrentMachinePosition(
  report: StatusReport | null,
  wcoCache: WorkCoordinateOffset | null,
): WorkCoordinateOffset | null {
  if (report?.mPos !== null && report?.mPos !== undefined) return report.mPos;
  if (report?.wPos !== null && report?.wPos !== undefined) {
    // Prefer THIS frame's own WCO over the cache: a just-applied G92/G10 can
    // leave wcoCache a report behind the fresh WPos (C7). Mirrors
    // currentWorkPosition in job-placement.ts so the two never diverge.
    const offset = report.wco ?? wcoCache;
    if (offset === null) return null;
    return {
      x: report.wPos.x + offset.x,
      y: report.wPos.y + offset.y,
      z: report.wPos.z + offset.z,
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
  reportInches = false,
): number | null {
  if (report?.wPos !== null && report?.wPos !== undefined) {
    return positionUnitToMm(report.wPos.z, reportInches);
  }
  if (report?.mPos !== null && report?.mPos !== undefined && wcoCache !== null) {
    return positionUnitToMm(report.mPos.z - wcoCache.z, reportInches);
  }
  return null;
}

function positionUnitToMm(value: number, reportInches: boolean): number {
  return normalizeReportedMPosToMm([0, 0, value], reportInches)[2];
}
