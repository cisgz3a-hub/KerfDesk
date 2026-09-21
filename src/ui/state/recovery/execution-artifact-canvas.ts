import type { CanvasMotionPlan } from '../canvas-motion-plan';
import type { ExecutionArtifactV1 } from './execution-artifact';
import {
  hasPackedMotionEncoding,
  isPackedMotionManifest,
  packMotionManifest,
  unpackMotionManifest,
  type PackedMotionManifest,
} from './packed-motion-manifest';

const PACK_MANIFEST_MINIMUM_BLOCKS = 4_096;

export type ArchivedCanvasMotionPlan =
  | CanvasMotionPlan
  | (Omit<CanvasMotionPlan, 'manifest'> & {
      readonly manifest: PackedMotionManifest;
    });

const hydratedPlans = new WeakMap<ArchivedCanvasMotionPlan, CanvasMotionPlan>();

/** Archive every exact path point without object-per-point storage overhead. */
export function archiveCanvasMotionPlan(plan: CanvasMotionPlan): ArchivedCanvasMotionPlan {
  // Minimal pre-existing fixtures and small legacy plans retain their shape.
  if (plan.manifest === undefined || plan.manifest.blocks.length < PACK_MANIFEST_MINIMUM_BLOCKS)
    return plan;
  return { ...plan, manifest: packMotionManifest(plan.manifest) };
}

/** Hydrate only the selected archive, keeping repository history compact and
 * returning a stable plan during canvas zoom, selection, and recovery review. */
export function executionArtifactCanvasPlan(
  artifact: Pick<ExecutionArtifactV1, 'canvasPlan'>,
): CanvasMotionPlan {
  const plan = artifact.canvasPlan;
  if (!hasPackedMotionEncoding(plan.manifest)) return plan as CanvasMotionPlan;
  const cached = hydratedPlans.get(plan);
  if (cached !== undefined) return cached;
  if (!isPackedMotionManifest(plan.manifest))
    throw new Error('The archived motion manifest is invalid.');
  const hydrated = { ...plan, manifest: unpackMotionManifest(plan.manifest) };
  hydratedPlans.set(plan, hydrated);
  return hydrated;
}

export function isArchivedCanvasMotionPlan(
  value: unknown,
  rawLines: number,
  sendableLines: number,
): value is ArchivedCanvasMotionPlan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const manifest = (value as Record<string, unknown>)['manifest'];
  if (!hasPackedMotionEncoding(manifest)) {
    // Keep historical plain manifests compatible, but do not mistake a packed
    // payload with a missing encoding tag for a plain manifest.
    return (
      manifest === undefined ||
      (typeof manifest === 'object' &&
        manifest !== null &&
        Array.isArray((manifest as Record<string, unknown>)['blocks']))
    );
  }
  return isPackedMotionManifest(manifest, { rawLines, sendableLines });
}
