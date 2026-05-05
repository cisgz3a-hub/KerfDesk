/**
 * T2-81: strip regenerable per-object caches from a Scene before
 * pushing it to history. Image objects can carry several megabytes
 * of `processedData` (T1-17 Pass 4b's JobCompiler-side cache,
 * populated by Pass 4c on slider commit). With max history size
 * 100, an image-heavy slider-drag workflow could balloon history
 * memory by 100× the image size — for a 4MP image that's 400MB.
 *
 * `processedData` is purely a cache: its content can be re-derived
 * from `grayscaleData` + `processedSettings.brightness/contrast/
 * gamma/invert` deterministically. Stripping it from history
 * snapshots removes the per-snapshot copy without losing
 * recoverability — the next slider commit (Pass 4c) repopulates
 * the cache on the live scene; before that, JobCompiler's missing-
 * cache fallback path (Pass 4b) keeps compile working.
 *
 * Out of scope (filed as T2-81-followup):
 *  - `grayscaleData` is the source-of-truth raster buffer, NOT a
 *    cache — keep in history.
 *  - `adjustedData` (post-dither preview) is read by SceneRenderer
 *    to render the dither preview on canvas; stripping would break
 *    that visual. The audit's full proposal moves both buffers to a
 *    keyed cache outside history; that's the bigger refactor.
 *
 * The MVP shipped here removes the dominant-cost cache (Pass 4c's
 * processedData per slider commit) while leaving the SceneRenderer
 * + grayscaleData paths untouched.
 */

import type { Scene } from '../../core/scene/Scene';
import type { ImageGeometry, SceneObject } from '../../core/scene/SceneObject';

/**
 * Returns a Scene with image objects rewritten to omit
 * `processedData` and `processedSettings`. Other objects share
 * references with the input — no deep clone is performed for
 * non-image objects, preserving the structural-sharing memory
 * model (HistoryManager docs §Memory).
 *
 * Returns the original Scene reference if no image object carries a
 * regenerable cache, so the no-op case is allocation-free and
 * `historyEntry.scene === inputScene` identity stays true.
 */
export function stripRegenerableImageCaches(scene: Scene): Scene {
  // Quick path: are any image objects carrying a strippable buffer?
  let needsRewrite = false;
  for (const obj of scene.objects) {
    if (obj.geometry.type !== 'image') continue;
    const g = obj.geometry as ImageGeometry;
    if (g.processedData != null || g.processedSettings != null) {
      needsRewrite = true;
      break;
    }
  }
  if (!needsRewrite) return scene;

  const newObjects: SceneObject[] = scene.objects.map((obj) => {
    if (obj.geometry.type !== 'image') return obj;
    const g = obj.geometry as ImageGeometry;
    if (g.processedData == null && g.processedSettings == null) return obj;
    const stripped: ImageGeometry = { ...g };
    delete stripped.processedData;
    delete stripped.processedSettings;
    return { ...obj, geometry: stripped };
  });

  return { ...scene, objects: newObjects };
}
