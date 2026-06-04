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
