import type { Toolpath } from '../../core/job';
import { MAX_COMPILED_MOTION_SEGMENTS } from '../../core/preflight/compiled-work';

/** The compiled-work advisory also bounds the optional second preview route. */
export const MAX_PLAN_PREVIEW_ROUTE_SEGMENTS = MAX_COMPILED_MOTION_SEGMENTS;

/**
 * Count motion inside each step, not just the step records: a contour or CNC
 * pass can carry hundreds of thousands of vertices in one cut step. Retaining
 * an emitted plan for it costs every edge. Count at least one per step to also
 * bound records with no drawable edge, and stop as soon as the budget is spent.
 */
export function previewRouteExceedsBudget(route: Toolpath): boolean {
  if (route.steps.length > MAX_PLAN_PREVIEW_ROUTE_SEGMENTS) return true;
  let segments = 0;
  for (const step of route.steps) {
    segments += step.kind === 'cut' ? Math.max(1, step.polyline.length - 1) : 1;
    if (segments > MAX_PLAN_PREVIEW_ROUTE_SEGMENTS) return true;
  }
  return false;
}
