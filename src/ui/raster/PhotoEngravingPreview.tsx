import { useEffect, useRef } from 'react';
import type { DeviceProfile } from '../../core/devices';
import type { RasterImage } from '../../core/scene';
import {
  drawPhotoEngravingPreview,
  type PhotoPreviewColours,
} from './draw-photo-engraving-preview';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import type { PhotoMaterialSpread } from './photo-engraving-preview-types';

type PreviewProps = {
  readonly image: RasterImage;
  readonly device: DeviceProfile;
  readonly result: PhotoEngravingPreviewResult | null;
  readonly negativeImage: boolean;
  readonly current: boolean;
  /** ADR-685: show the marks as the laser spot spreads them, in material colours. */
  readonly materialView: boolean;
  readonly onMaterialViewChange: (materialView: boolean) => void;
  readonly colours?: PhotoPreviewColours | undefined;
  readonly materialName?: string | undefined;
};

export function PhotoEngravingPreview(props: PreviewProps): JSX.Element {
  const canvas = usePreviewCanvas(props);
  const { result } = props;
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
        <PreviewCaption {...props} />
        <div
          className="lf-photo-engraving__preview-surface"
          aria-busy={props.current && result === null}
        >
          <canvas
            ref={canvas}
            aria-label="Photo engraving preview"
            hidden={result?.kind !== 'ok'}
          />
          {result?.kind !== 'ok' ? (
            <p role="status">{previewStatus(props.current, result)}</p>
          ) : null}
        </div>
        <p role="status">{gridDescription(result)}</p>
      </figure>
      <p className="lf-photo-engraving__preview-note">
        {previewNote(props.materialView, result)}
        {result?.kind === 'ok' && result.scanCount > 1
          ? ' Shows the first scan; review all passes in the job Preview.'
          : ''}
      </p>
    </div>
  );
}

function usePreviewCanvas(props: PreviewProps): React.RefObject<HTMLCanvasElement> {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, device, negativeImage, materialView, colours } = props;
  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    if (result?.kind !== 'ok') {
      target.width = 1;
      target.height = 1;
      return;
    }
    drawPhotoEngravingPreview(target, result, device, negativeImage, {
      material: materialView,
      ...(materialView && colours !== undefined ? { colours } : {}),
    });
  }, [result, device, negativeImage, materialView, colours]);
  return canvas;
}

function PreviewCaption(props: PreviewProps): JSX.Element {
  const name =
    props.materialView && props.materialName !== undefined
      ? `On ${props.materialName}`
      : props.negativeImage
        ? 'Light engraving marks'
        : 'Dark engraving marks';
  return (
    <figcaption className="lf-photo-engraving__preview-caption">
      <span>{name}</span>
      <select
        className="lf-select"
        aria-label="Preview view"
        title="Dots shows each scan cell. On material draws each mark as wide as the laser spot, in the material's colours."
        value={props.materialView ? 'material' : 'dots'}
        onChange={(event) => props.onMaterialViewChange(event.target.value === 'material')}
      >
        <option value="dots">Dots</option>
        <option value="material">On material</option>
      </select>
    </figcaption>
  );
}

function previewNote(materialView: boolean, result: PhotoEngravingPreviewResult | null): string {
  return materialView
    ? materialNote(result?.kind === 'ok' ? result.materialSpread : undefined)
    : 'Simulated marks from the selected scan grid. Material colour, beam width and heat spread need a material test.';
}

function materialNote(spread: PhotoMaterialSpread | undefined): string {
  if (spread === undefined) return 'Preparing the material view…';
  if (spread.kind === 'unknown-spot') {
    return 'This machine profile has no laser spot size, so each mark is drawn one scan cell wide. Choose your laser module to include beam spread.';
  }
  return `Each mark is drawn as the ${spread.spotMm.toFixed(2)} mm laser spot over ${spread.cellMm.toFixed(3)} mm scan cells, so overlapping dots darken as they burn. Colours are a guide; how the material darkens needs a material test or tone calibration.`;
}

function previewStatus(current: boolean, result: PhotoEngravingPreviewResult | null): string {
  if (!current) return 'The source changed.';
  return result?.kind === 'error' ? result.message : 'Preparing engraving pixels…';
}

function gridDescription(result: PhotoEngravingPreviewResult | null): string {
  if (result?.kind !== 'ok') return 'Preview updates as you adjust the photo.';
  return `${result.sourceWidth} × ${result.sourceHeight} engraving pixels${result.displayDecimated ? ' · averaged to fit this view' : ''}`;
}
