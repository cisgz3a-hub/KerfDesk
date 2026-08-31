import type { CncGroup } from '../job';
import { assertNever } from '../scene';
import { cncContourEmissionPrecision } from './cnc-contour-emission';

/** Deepest positive stock depth reached by represented compiled pass motion. */
export function cncGroupMaximumDepthMm(group: CncGroup): number {
  let deepestZ = 0;
  for (const pass of group.passes) {
    switch (pass.kind) {
      case 'contour':
        if (cncContourEmissionPrecision(pass) !== null) {
          deepestZ = Math.min(deepestZ, pass.zMm);
        }
        break;
      case 'arc':
        deepestZ = Math.min(deepestZ, pass.zMm);
        break;
      case 'path3d':
        for (const point of pass.points) deepestZ = Math.min(deepestZ, point.z);
        break;
      case 'helical-contour':
        deepestZ = Math.min(deepestZ, pass.startZMm, pass.zMm);
        break;
      default:
        assertNever(pass, 'CncPass');
    }
  }
  return Math.max(0, -deepestZ);
}
