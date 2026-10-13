import type { JobBounds } from '../../core/job';
import type { CanvasMotionPlan } from './canvas-motion-plan';

type BoundsLoader = () => Promise<JobBounds | null>;
const loaders = new WeakMap<CanvasMotionPlan, BoundsLoader>();

/** The caller that owns the complete preparation request attaches this after
 * the worker transfer. No project, pixels or functions enter marker metadata. */
export function registerCanvasStartBoundsLoader(plan: CanvasMotionPlan, load: BoundsLoader): void {
  loaders.set(plan, load);
}

/** A settled live route may remain visible over the matching current idle
 * plan. Rebase its on-demand bounds to the live route's placement offset. */
export function inheritCanvasStartBoundsLoader(
  target: CanvasMotionPlan,
  source: CanvasMotionPlan,
): void {
  if (target.retentionKey !== source.retentionKey) return;
  const load = loaders.get(source);
  const from = source.startEditingData?.jobOriginOffset;
  const to = target.startEditingData?.jobOriginOffset;
  if (load === undefined || from === undefined || to === undefined) return;
  loaders.set(target, async () => {
    const bounds = await load();
    return bounds === null
      ? null
      : {
          minX: bounds.minX + to.x - from.x,
          maxX: bounds.maxX + to.x - from.x,
          minY: bounds.minY + to.y - from.y,
          maxY: bounds.maxY + to.y - from.y,
        };
  });
}

export function loadCanvasStartBounds(plan: CanvasMotionPlan): Promise<JobBounds | null> {
  const load = loaders.get(plan);
  if (load === undefined) return Promise.reject(new Error('Start point defaults are not ready.'));
  return load();
}

export function requestedCanvasStartBounds(plan: CanvasMotionPlan | null): JobBounds | null {
  const bounds = plan?.startEditingData?.bounds;
  if (bounds === undefined) throw new Error('Could not prepare start point defaults.');
  return bounds;
}
