/**
 * T1-130: pure scene transforms for image-layer settings preview +
 * commit. Extracted from PropertiesPanel.tsx as the first
 * PropertiesPanel decomposition slice (audit Sprint 7 — PropertiesPanel
 * was 1612 lines; the image-settings transforms were 100 of those).
 *
 * Pre-T1-130 the transforms lived inline as the bodies of two
 * useCallback wrappers — testing them required mounting the panel
 * with a fully-shaped scene + selected-ids fixture. The transforms
 * themselves are pure: scene-in → scene-out with the requested
 * image-layer / image-geometry patch applied.
 *
 * Two transforms:
 *   - `previewImageSettings(scene, objId, field, value)`: live
 *     preview during slider drag (single-field update on both the
 *     image-object's geometry AND the parent layer's `settings.image`
 *     so the rendered preview is consistent with what the compile
 *     pipeline will see).
 *   - `commitImageSettings(scene, objId, overrides)`: persisted on
 *     pointer-up. Applies brightness / contrast / gamma / invert
 *     resolved from `overrides` (falling back to whatever the
 *     image-geometry already carries). Clears `adjustedData` +
 *     `ditherMode` on the image geometry so the JobCompiler-side
 *     cache invalidates and re-derives. Reset of `_bounds` /
 *     `_worldTransform` is preserved (they're caches the renderer
 *     rebuilds lazily).
 *
 * The fire-and-forget `warmProcessedImageCache` call from
 * commitImageSettings stays in the React wrapper because it's a
 * side effect (off-thread worker dispatch), not a scene transform.
 */
import type { Scene } from '../../../core/scene/Scene';
import type { ImageGeometry } from '../../../core/scene/SceneObject';

export type ImageSettingsPreviewField = 'brightness' | 'contrast' | 'gamma' | 'invert';

export type ImageSettingsCommitOverrides =
  Partial<Pick<ImageGeometry, 'brightness' | 'contrast' | 'gamma' | 'invert'>>;

/**
 * Apply a single-field preview update for an image object. Updates
 * BOTH the object's image geometry AND the parent layer's
 * `settings.image` slice so the rendered preview matches what the
 * JobCompiler will read on next compile. Invalidates per-object
 * `_bounds` / `_worldTransform` caches.
 *
 * Returns the original scene unchanged when:
 *   - the target object doesn't exist
 *   - the target object isn't an image
 */
export function applyImageSettingsPreview(
  scene: Scene,
  objId: string,
  field: ImageSettingsPreviewField,
  value: number | boolean,
): Scene {
  const target = scene.objects.find(
    (o) => o.id === objId && o.geometry.type === 'image',
  );
  if (!target) return scene;
  return {
    ...scene,
    layers: scene.layers.map((l) => {
      if (l.id !== target.layerId) return l;
      return {
        ...l,
        settings: {
          ...l.settings,
          image: { ...l.settings.image, [field]: value },
        },
      };
    }),
    objects: scene.objects.map((o) => {
      if (o.id !== objId || o.geometry.type !== 'image') return o;
      const geom = o.geometry as ImageGeometry;
      return {
        ...o,
        geometry: { ...geom, [field]: value } as ImageGeometry,
        _bounds: null,
        _worldTransform: null,
      };
    }),
  };
}

/**
 * Apply the committed brightness / contrast / gamma / invert quad to
 * an image object. Overrides win over the object's current settings;
 * missing overrides fall back to whatever the image geometry already
 * carries (with sensible defaults: brightness 0, contrast 0, gamma
 * 1, invert false). Clears `adjustedData` + `ditherMode` so the
 * JobCompiler image-pipeline cache (T1-17 Pass 4c) re-derives.
 *
 * Returns the original scene unchanged when:
 *   - the target object doesn't exist
 *   - the target object isn't an image
 *   - the target image has no `grayscaleData` (nothing to commit
 *     because the image hasn't been decoded yet; matches pre-T1-130
 *     `if (!geom.grayscaleData) return;` guard).
 */
export function applyImageSettingsCommit(
  scene: Scene,
  objId: string,
  overrides?: ImageSettingsCommitOverrides,
): { scene: Scene; brightness: number; contrast: number; gamma: number; invert: boolean } | null {
  const target = scene.objects.find(
    (o) => o.id === objId && o.geometry.type === 'image',
  );
  if (!target || target.geometry.type !== 'image') return null;
  const geom = target.geometry as ImageGeometry;
  if (!geom.grayscaleData) return null;

  const brightness = overrides?.brightness ?? geom.brightness ?? 0;
  const contrast = overrides?.contrast ?? geom.contrast ?? 0;
  const gamma = overrides?.gamma ?? geom.gamma ?? 1;
  const invert = overrides?.invert ?? geom.invert ?? false;

  const newScene: Scene = {
    ...scene,
    layers: scene.layers.map((l) => {
      if (l.id !== target.layerId) return l;
      return {
        ...l,
        settings: {
          ...l.settings,
          image: {
            ...l.settings.image,
            brightness,
            contrast,
            gamma,
            invert,
          },
        },
      };
    }),
    objects: scene.objects.map((o) => {
      if (o.id !== objId || o.geometry.type !== 'image') return o;
      return {
        ...o,
        geometry: {
          ...(o.geometry as ImageGeometry),
          brightness,
          contrast,
          gamma,
          invert,
          adjustedData: undefined,
          ditherMode: undefined,
        } as ImageGeometry,
        _bounds: null,
        _worldTransform: null,
      };
    }),
  };

  return { scene: newScene, brightness, contrast, gamma, invert };
}
