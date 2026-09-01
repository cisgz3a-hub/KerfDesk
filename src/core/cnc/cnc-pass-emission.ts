import { sampleCircularArcPoints } from '../geometry/arc-representation';
import type { CncPass } from '../job';
import { cncHelicalContourCanEmit } from '../job/helical-representation';
import { assertNever } from '../scene';
import { cncContourEmissionPrecision } from './cnc-contour-emission';

/** Exact pass-level preconditions shared with the CNC emitter. */
export function cncPassCanEmit(pass: CncPass): boolean {
  switch (pass.kind) {
    case 'contour':
      return cncContourEmissionPrecision(pass) !== null;
    case 'path3d':
      return pass.points.length >= 2;
    case 'arc':
      return Number.isFinite(pass.zMm) && sampleCircularArcPoints(pass).length >= 2;
    case 'helical-contour':
      return cncHelicalContourCanEmit(pass);
    default:
      return assertNever(pass, 'CncPass');
  }
}
