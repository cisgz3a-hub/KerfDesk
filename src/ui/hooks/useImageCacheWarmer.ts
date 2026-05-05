/**
 * T1-17 Pass 4c: warm the JobCompiler image-pipeline cache off-thread
 * after the user commits a brightness/contrast/gamma/invert change in
 * the PropertiesPanel.
 *
 * The flow is:
 *   1. Slider drag fires `previewImageSettings` (cheap, ctx.filter only).
 *   2. Slider release fires `commitImageSettings` which persists the
 *      new settings to history via `onSceneCommit`.
 *   3. Immediately after the commit, this helper kicks off
 *      `processImage(...)` (worker if available, main-thread fallback
 *      otherwise — see imagePrepClient).
 *   4. When the worker resolves, the helper re-reads the live scene
 *      and verifies the brightness/contrast/gamma/invert fingerprint
 *      hasn't drifted (user dragged again before the worker was done).
 *      If still current, the result is written to
 *      `geom.processedData` + `geom.processedSettings` via the live
 *      (history-skipping) channel.
 *   5. Next compile picks up the cached buffer (Pass 4b) and skips the
 *      legacy ImageProcessing.ts pipeline.
 *
 * The fingerprint check at write time is the load-bearing piece — it
 * protects against the obvious race where two commits in flight
 * resolve out of order. The older worker's result is correctly
 * discarded.
 *
 * Fire-and-forget — callers do not await this. Errors are logged and
 * swallowed so the user never sees the cache-warm path surface as a
 * UI error; the legacy fallback in JobCompiler keeps working either way.
 */

import { processImage, type ImageProcessSettings } from '../../workers/imagePrepClient';
import type { Scene } from '../../core/scene/Scene';
import type { ImageGeometry } from '../../core/scene/SceneObject';

export interface WarmCacheSettings {
  brightness: number;
  contrast: number;
  gamma: number;
  invert: boolean;
}

export async function warmProcessedImageCache(
  objId: string,
  settings: WarmCacheSettings,
  getScene: () => Scene,
  applyScene: (scene: Scene) => void,
): Promise<void> {
  const before = getScene();
  const target = before.objects.find(o => o.id === objId && o.geometry.type === 'image');
  if (!target || target.geometry.type !== 'image') return;
  const geom = target.geometry as ImageGeometry;
  if (!geom.grayscaleData || !geom.grayscaleWidth || !geom.grayscaleHeight) return;

  const processSettings: ImageProcessSettings = {
    brightness: settings.brightness,
    contrast: settings.contrast,
    gamma: settings.gamma,
    invert: settings.invert,
    threshold: null,
  };

  let processedData: Uint8Array;
  try {
    processedData = await processImage(
      geom.grayscaleData,
      geom.grayscaleWidth,
      geom.grayscaleHeight,
      processSettings,
    );
  } catch (err) {
    console.warn('[T1-17 Pass 4c] processImage failed; cache not warmed:', err);
    return;
  }

  // Re-read the live scene. The worker may have run for tens of ms
  // during which the user dragged again — in that case the geom's
  // brightness/contrast/gamma/invert no longer match what we processed
  // and writing the cache would persist a stale buffer. Skip silently.
  const after = getScene();
  const cur = after.objects.find(o => o.id === objId && o.geometry.type === 'image');
  if (!cur || cur.geometry.type !== 'image') return;
  const cg = cur.geometry as ImageGeometry;
  if (
    (cg.brightness ?? 0) !== settings.brightness ||
    (cg.contrast ?? 0) !== settings.contrast ||
    (cg.gamma ?? 1) !== settings.gamma ||
    (cg.invert ?? false) !== settings.invert
  ) {
    return;
  }

  applyScene({
    ...after,
    objects: after.objects.map(o => {
      if (o.id !== objId || o.geometry.type !== 'image') return o;
      const og = o.geometry as ImageGeometry;
      return {
        ...o,
        geometry: {
          ...og,
          processedData,
          processedSettings: { ...settings },
        } as ImageGeometry,
      };
    }),
  });
}
