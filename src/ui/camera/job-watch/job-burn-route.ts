// The job's burn path on the bed (ADR-490), read from the started plan the
// canvas already draws its live trail from: every lit move, mapped from
// controller to bed millimetres by the same walker, at the beam's width.

import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import {
  maskGrid,
  routeMaskBuilder,
  type RouteMasks,
} from '../../../core/camera/job-watch/route-mask';
import { jobWatchRegion } from '../../../core/camera/job-watch/job-area';
import { BURN_TOLERANCE_MM } from '../../../core/camera/job-watch/burn-comparison';
import type { CanvasMotionPlan } from '../../state/canvas-motion-plan';
import { walkRouteLines } from '../../workspace/route-range-walk';

// The canvas trail's nominal beam when the machine does not say (draw-burn-trail).
const NOMINAL_LASER_KERF_MM = 0.2;

/** Whether the plan can be placed on the bed at all. */
export function planPlacesOnBed(plan: CanvasMotionPlan): boolean {
  return plan.capability !== 'unavailable' && plan.capability !== 'file-only';
}

/**
 * The job's area grown by the watch margin, on the bed; null when nothing
 * burns. The plan's frame outline is the job's own bounds and costs nothing;
 * only a plan without one walks its moves, which on a big engrave is not free
 * at the moment the job starts.
 */
export function burnRegion(plan: CanvasMotionPlan): BedArea | null {
  const bed = { width: plan.device.bedWidth, height: plan.device.bedHeight };
  if (plan.framePerimeter.length >= 2) return jobWatchRegion(plan.framePerimeter, bed);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  walkRouteLines(plan, 0, Number.POSITIVE_INFINITY, (x0, y0, x1, y1, intent) => {
    if (intent !== 'process') return true;
    bounds.minX = Math.min(bounds.minX, x0, x1);
    bounds.minY = Math.min(bounds.minY, y0, y1);
    bounds.maxX = Math.max(bounds.maxX, x0, x1);
    bounds.maxY = Math.max(bounds.maxY, y0, y1);
    return true;
  });
  if (!(bounds.maxX >= bounds.minX)) return null;
  return jobWatchRegion(
    [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
    ],
    bed,
  );
}

/**
 * The path's masks over `region`. Lit moves before `checkFromRouteMm` may
 * have burned before the first picture, so they are allowed but not checked.
 */
export function burnRouteMasks(
  plan: CanvasMotionPlan,
  region: BedArea,
  pixelsPerMm: number,
  checkFromRouteMm: number,
): RouteMasks | null {
  const grid = maskGrid(region, pixelsPerMm);
  if (grid === null) return null;
  const spot = plan.device.laserSubProfile?.spotSizeMm;
  const kerfMm = spot === undefined ? NOMINAL_LASER_KERF_MM : Math.max(spot.x, spot.y);
  const builder = routeMaskBuilder(grid, kerfMm, BURN_TOLERANCE_MM);
  const split = Math.max(0, checkFromRouteMm);
  walkRouteLines(plan, 0, split, (x0, y0, x1, y1, intent) => {
    if (intent === 'process') builder.addLine(x0, y0, x1, y1, true);
    return true;
  });
  walkRouteLines(plan, split, Number.POSITIVE_INFINITY, (x0, y0, x1, y1, intent) => {
    if (intent === 'process') builder.addLine(x0, y0, x1, y1);
    return true;
  });
  return builder.masks();
}

/** Where the first lit move starts along the route, mm; null when nothing burns. */
export function firstBurnRouteMm(plan: CanvasMotionPlan): number | null {
  const first = plan.manifest.blocks.find((block) => block.kind === 'process');
  return first?.routeStartMm ?? null;
}
