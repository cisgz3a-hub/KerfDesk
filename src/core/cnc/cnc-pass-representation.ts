import { cncPassXyPoints, type CncPass } from '../job/job';
import type { Vec2 } from '../scene';
import { cncContourEmissionPoints } from './cnc-contour-emission';

/** XY motion represented by the compiled CNC output. Contours use the exact
 * coordinates retained by the GRBL parser contract; other pass kinds keep
 * their established sampled/projected motion representation. */
export function cncPassRepresentedXyPoints(pass: CncPass): ReadonlyArray<Vec2> {
  return pass.kind === 'contour' ? cncContourEmissionPoints(pass) : cncPassXyPoints(pass);
}
