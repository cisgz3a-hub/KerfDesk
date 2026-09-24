import { useEffect, useState } from 'react';
import type { RasterImage } from '../../core/scene';
import { readRasterSourceFile } from '../import/paged-raster-source';
import type { useToastStore } from '../state/toast-store';

export function useTraceSourceFile(
  seed: RasterImage,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): File | null {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    readRasterSourceFile(seed, seed.source, undefined, controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setFile(file);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          pushToast(`Could not read ${seed.source} for tracing.`, 'error');
      });
    return () => controller.abort();
    // The immutable seed also owns the asset lookup for a page-backed raster.
  }, [seed, pushToast]);
  return file;
}
