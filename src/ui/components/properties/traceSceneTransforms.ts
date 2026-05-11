/**
 * T1-140: pure scene transforms for the image-trace flow extracted
 * from `PropertiesPanel.handleTrace`. Pre-T1-140 the trace flow had
 * ~40 lines of pure data manipulation wedged between window.confirm
 * dialogs, requestAnimationFrame yields, async trace calls, and
 * showAlert side effects. Two pure pieces lift cleanly:
 *
 *   - `scaleSubPathsForTrace(subPaths, scaleX, scaleY)`: applies a
 *     per-axis scale to every endpoint AND every control point in
 *     a path geometry's subpaths, preserving segment types and the
 *     closed flag.
 *   - `buildSceneAfterTrace(input)`: composes the post-trace scene —
 *     scales the traced PathGeometry, applies the source object's
 *     transform to the traced object, then either replaces the source
 *     image with the traced path (when `deleteImageAfterTrace`) or
 *     appends the traced path alongside.
 *
 * The async + UI parts of `handleTrace` (confirm dialog, scene-stale
 * guard, trace-async call, alert dispatch, isTracing flag,
 * trace-storm probe lifecycle) stay in the component. Side-effect
 * boundaries are explicit.
 */
import type { Scene } from '../../../core/scene/Scene';
import type {
  Geometry,
  PathGeometry,
  SceneObject,
  SubPath,
} from '../../../core/scene/SceneObject';
import type { Layer } from '../../../core/scene/Layer';

/**
 * Scale every endpoint and every control point in `subPaths` by
 * (`scaleX`, `scaleY`). `close` segments are returned unchanged.
 * Move/line segments scale `to`. Quadratic scales `cp` and `to`.
 * Cubic scales `cp1`, `cp2`, and `to`. Returns a NEW array — never
 * mutates the input.
 */
export function scaleSubPathsForTrace(
  subPaths: ReadonlyArray<SubPath>,
  scaleX: number,
  scaleY: number,
): SubPath[] {
  return subPaths.map((sp) => ({
    ...sp,
    segments: sp.segments.map((seg) => {
      if (seg.type === 'close') return seg;
      if (seg.type === 'move' || seg.type === 'line') {
        return { ...seg, to: { x: seg.to.x * scaleX, y: seg.to.y * scaleY } };
      }
      if (seg.type === 'quadratic') {
        return {
          ...seg,
          cp: { x: seg.cp.x * scaleX, y: seg.cp.y * scaleY },
          to: { x: seg.to.x * scaleX, y: seg.to.y * scaleY },
        };
      }
      if (seg.type === 'cubic') {
        return {
          ...seg,
          cp1: { x: seg.cp1.x * scaleX, y: seg.cp1.y * scaleY },
          cp2: { x: seg.cp2.x * scaleX, y: seg.cp2.y * scaleY },
          to: { x: seg.to.x * scaleX, y: seg.to.y * scaleY },
        };
      }
      return seg;
    }),
  }));
}

/** Inputs the trace-commit transform needs. */
export interface BuildSceneAfterTraceInput {
  scene: Scene;
  /** Source image object the trace was run against. */
  sourceImage: SceneObject;
  /** The newly-traced SceneObject (PathGeometry). */
  traced: SceneObject;
  /** Per-axis scale factor from grayscale pixels back to mm. */
  scaleX: number;
  scaleY: number;
  /** Target layer ID the traced path should belong to. */
  targetLayerId: string;
  /** Layers list to use in the new scene (may include a freshly-created layer). */
  layersForCommit: Layer[];
  /** Whether to delete the source image after the trace completes. */
  deleteImageAfterTrace: boolean;
}

/** Result of the trace-commit transform. */
export interface BuildSceneAfterTraceResult {
  scene: Scene;
  /** ID of the newly-added traced object (UI may select it). */
  addedObjectId: string;
}

/**
 * Compose the post-trace scene: scale the traced PathGeometry back
 * into mm space, inherit the source image's transform, then either
 * replace the source image with the traced path or append.
 *
 * The traced object's `transform` is set to the source image's
 * transform so the new path lands where the image was. The source
 * image's `id` is filtered out when `deleteImageAfterTrace`. The
 * `activeLayerId` is set to `targetLayerId` so the layer panel
 * surfaces the new path's layer.
 */
export function buildSceneAfterTrace(input: BuildSceneAfterTraceInput): BuildSceneAfterTraceResult {
  const { scene, sourceImage, traced, scaleX, scaleY, targetLayerId, layersForCommit, deleteImageAfterTrace } = input;
  const pathGeom = traced.geometry as PathGeometry;
  const scaledSubPaths = scaleSubPathsForTrace(pathGeom.subPaths, scaleX, scaleY);

  const finalObj: SceneObject = {
    ...traced,
    transform: { ...sourceImage.transform },
    geometry: { ...pathGeom, subPaths: scaledSubPaths } as Geometry,
  };

  const nextObjects = deleteImageAfterTrace
    ? [...scene.objects.filter((o) => o.id !== sourceImage.id), finalObj]
    : [...scene.objects, finalObj];

  return {
    scene: {
      ...scene,
      layers: layersForCommit,
      activeLayerId: targetLayerId,
      objects: nextObjects,
    },
    addedObjectId: finalObj.id,
  };
}
