import { useEffect, useRef, useState } from 'react';
import type { RasterImage } from '../../core/scene';
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import { photoEngravingImage } from './photo-engraving-apply';
import { previewPhotoEngravingInWorker } from './photo-engraving-preview-client';
import { photoPreviewSourceSizeError } from './photo-engraving-preview-budget';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import { photoEngravingPatch, type PhotoEngravingDraft } from './photo-engraving-settings';
import type { PhotoEngravingSession } from './photo-engraving-store';

export function usePhotoEngravingPreview(
  session: PhotoEngravingSession,
  draft: PhotoEngravingDraft,
  current: boolean,
  materialView = false,
): PhotoEngravingPreviewResult | null {
  const hydratedSource = useRef<{
    readonly session: PhotoEngravingSession;
    readonly image: RasterImage;
  } | null>(null);
  const [completed, setCompleted] = useState<{
    readonly draft: PhotoEngravingDraft;
    readonly session: PhotoEngravingSession;
    readonly materialView: boolean;
    readonly result: PhotoEngravingPreviewResult;
  } | null>(null);
  useEffect(() => {
    if (!current) return;
    const abort = new AbortController();
    const finish = (result: PhotoEngravingPreviewResult): void =>
      setCompleted({ draft, session, materialView, result });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const sourceError = photoPreviewSourceSizeError(
            session.image.pixelWidth,
            session.image.pixelHeight,
          );
          if (sourceError !== null) {
            finish({ kind: 'error', message: sourceError });
            return;
          }
          const hydrated =
            hydratedSource.current?.session === session
              ? hydratedSource.current.image
              : await hydratePagedRasterImage(session.image, undefined, abort.signal);
          if (abort.signal.aborted) return;
          hydratedSource.current = { session, image: hydrated };
          const image = photoEngravingImage(
            hydrated,
            session.operation,
            photoEngravingPatch(draft),
          );
          const result = await previewPhotoEngravingInWorker(
            {
              image,
              layer: session.operation,
              device: session.device,
              sceneObjects: session.sceneObjects,
              materialView,
            },
            abort.signal,
          );
          if (!abort.signal.aborted) finish(result);
        } catch (error) {
          if (abort.signal.aborted) return;
          finish({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Photo preview could not be prepared.',
          });
        }
      })();
    }, 150);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [session, draft, current, materialView]);
  return current &&
    completed?.draft === draft &&
    completed.session === session &&
    completed.materialView === materialView
    ? completed.result
    : null;
}
