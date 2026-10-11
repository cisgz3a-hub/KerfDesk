import { useEffect, useRef, useState } from 'react';
import type { RasterImage } from '../../core/scene';
import { evaluateRasterBudget } from '../../core/raster/raster-budget';
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import { photoEngravingImage } from './photo-engraving-apply';
import { previewPhotoEngravingInWorker } from './photo-engraving-preview-client';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import { photoEngravingPatch, type PhotoEngravingDraft } from './photo-engraving-settings';
import type { PhotoEngravingSession } from './photo-engraving-store';

export function usePhotoEngravingPreview(
  session: PhotoEngravingSession,
  draft: PhotoEngravingDraft,
  current: boolean,
): PhotoEngravingPreviewResult | null {
  const hydratedSource = useRef<{
    readonly session: PhotoEngravingSession;
    readonly image: RasterImage;
  } | null>(null);
  const [completed, setCompleted] = useState<{
    readonly draft: PhotoEngravingDraft;
    readonly session: PhotoEngravingSession;
    readonly result: PhotoEngravingPreviewResult;
  } | null>(null);
  useEffect(() => {
    if (!current) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const sourceBudget = evaluateRasterBudget(1, 1, {
            sourcePixelCount: session.image.pixelWidth * session.image.pixelHeight,
            sourceWorkingBytesPerPixel: 12,
          });
          if (sourceBudget.kind === 'too-large') {
            setCompleted({
              draft,
              session,
              result: {
                kind: 'error',
                message: `Photo preview is unavailable at this size: ${sourceBudget.reason}. You can still apply the settings.`,
              },
            });
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
            },
            abort.signal,
          );
          if (!abort.signal.aborted) setCompleted({ draft, session, result });
        } catch (error) {
          if (abort.signal.aborted) return;
          setCompleted({
            draft,
            session,
            result: {
              kind: 'error',
              message:
                error instanceof Error ? error.message : 'Photo preview could not be prepared.',
            },
          });
        }
      })();
    }, 150);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [session, draft, current]);
  return current && completed?.draft === draft && completed.session === session
    ? completed.result
    : null;
}
