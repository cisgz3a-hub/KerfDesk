import { useEffect, useState } from 'react';
import type { RasterImage, SceneObject } from '../../core/scene';
import { readRasterSourceFile } from '../import/paged-raster-source';
import type { useToastStore } from '../state/toast-store';
import { useStore } from '../state/store';
import { bindTraceSourceMask, traceSourceMaskMatches } from './trace-source-mask';

export function useCanvasTraceSourceFile(
  seed: RasterImage,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): File | null {
  const maskObject = useStore((s) =>
    s.project.scene.objects.find((object) => object.id === seed.imageMaskId),
  );
  return useTraceSourceFile(seed, pushToast, maskObject);
}

export function useTraceSourceFile(
  seed: RasterImage,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  maskObject?: SceneObject,
): File | null {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    readRasterSourceFile(seed, seed.source, undefined, controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setFile(bindTraceSourceMask(file, seed, maskObject));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          pushToast(`Could not read ${seed.source} for tracing.`, 'error');
      });
    return () => controller.abort();
    // The immutable seed also owns the asset lookup for a page-backed raster.
  }, [seed, pushToast, maskObject]);
  return file !== null && traceSourceMaskMatches(file, seed, maskObject) ? file : null;
}
