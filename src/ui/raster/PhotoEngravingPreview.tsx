import { useEffect, useRef } from 'react';
import type { DeviceProfile } from '../../core/devices';
import type { RasterImage } from '../../core/scene';
import { drawPhotoEngravingPreview } from './draw-photo-engraving-preview';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';

export function PhotoEngravingPreview(props: {
  readonly image: RasterImage;
  readonly device: DeviceProfile;
  readonly result: PhotoEngravingPreviewResult | null;
  readonly negativeImage: boolean;
  readonly current: boolean;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    if (props.result?.kind !== 'ok') {
      target.width = 1;
      target.height = 1;
      return;
    }
    drawPhotoEngravingPreview(target, props.result, props.device, props.negativeImage);
  }, [props.result, props.device, props.negativeImage]);
  return (
    <div className="lf-photo-engraving__previews">
      <figure>
        <figcaption>Original photo</figcaption>
        <div className="lf-photo-engraving__preview-surface">
          <img
            src={props.image.imageAsset?.thumbnail.dataUrl ?? props.image.dataUrl}
            alt="Original photo for engraving"
          />
        </div>
        <p>
          {props.image.pixelWidth} × {props.image.pixelHeight} source pixels
        </p>
      </figure>
      <figure>
        <figcaption>
          {props.negativeImage ? 'Light engraving marks' : 'Dark engraving marks'}
        </figcaption>
        <div
          className="lf-photo-engraving__preview-surface"
          aria-busy={props.current && props.result === null}
        >
          <canvas
            ref={canvas}
            aria-label="Photo engraving preview"
            hidden={props.result?.kind !== 'ok'}
          />
          {props.result?.kind !== 'ok' ? (
            <p role="status">{previewStatus(props.current, props.result)}</p>
          ) : null}
        </div>
        <p role="status">{gridDescription(props.result)}</p>
      </figure>
      <p className="lf-photo-engraving__preview-note">
        Simulated marks from the selected scan grid. Material colour, beam width and heat spread
        need a material test.
        {props.result?.kind === 'ok' && props.result.scanCount > 1
          ? ' Shows the first scan; review all passes in the job Preview.'
          : ''}
      </p>
    </div>
  );
}

function previewStatus(current: boolean, result: PhotoEngravingPreviewResult | null): string {
  if (!current) return 'The source changed.';
  return result?.kind === 'error' ? result.message : 'Preparing engraving pixels…';
}

function gridDescription(result: PhotoEngravingPreviewResult | null): string {
  if (result?.kind !== 'ok') return 'Preview updates as you adjust the photo.';
  return `${result.sourceWidth} × ${result.sourceHeight} engraving pixels${result.displayDecimated ? ' · averaged to fit this view' : ''}`;
}
