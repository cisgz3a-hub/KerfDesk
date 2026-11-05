// The canvas Preview's burned-image bitmaps are compiled off the UI thread
// (perf audit S4-P3-1): a bed-sized photo blocked the window 0.67-0.74 s while
// its raster compiled here. One worker per build, so cancelling a superseded
// build stops its compile. Without workers (tests, an old browser) the build
// runs here, as before, and reports before this returns.

import type { DeviceProfile } from '../../core/devices';
import type { Layer, RasterImage, SceneObject } from '../../core/scene';
import {
  rasterPreviewBitmap,
  type RasterPreviewBitmap,
  type RasterPreviewBitmapInput,
} from './raster-preview-bitmap';

export function buildRasterPreviewBitmap(
  image: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  sceneObjects: ReadonlyArray<SceneObject>,
  done: (bitmap: RasterPreviewBitmap | null) => void,
): () => void {
  // The compile reads luma, never the display source, and of the rest of the
  // scene only the raster's image mask.
  const { dataUrl: _display, ...compiled } = image;
  const input: RasterPreviewBitmapInput = {
    image: compiled,
    layer,
    device,
    sceneObjects: sceneObjects.filter((object) => object.id === image.imageMaskId),
  };
  const worker = createWorker();
  if (worker === null) {
    done(rasterPreviewBitmap({ ...input, image, sceneObjects }));
    return () => undefined;
  }
  let open = true;
  const close = (): void => {
    open = false;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  };
  worker.onmessage = (event: MessageEvent<RasterPreviewBitmap | null>): void => {
    if (!open) return;
    close();
    done(event.data);
  };
  worker.onerror = (): void => {
    if (!open) return;
    close();
    // The worker could not run here: compile in the window, as before.
    done(rasterPreviewBitmap({ ...input, image, sceneObjects }));
  };
  worker.postMessage(input);
  return close;
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./raster-preview-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
