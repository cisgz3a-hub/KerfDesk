import { dpiToLinesPerMm, linesPerMmToDpi, linesPerMmToLineIntervalMm } from '../../core/raster';
import type { RasterImage } from '../../core/scene';
import { Button } from '../kit';
import { DraftNumberInput } from '../kit/DraftNumberInput';
import { imageDensityBounds } from './image-density-bounds';
import {
  PHOTO_DITHER_CHOICES,
  photoDither,
  photoSourceDimensions,
  type PhotoEngravingDraft,
} from './photo-engraving-settings';

type PhotoEngravingFieldsProps = {
  readonly draft: PhotoEngravingDraft;
  readonly image: RasterImage;
  readonly storedLinesPerMm: number;
  readonly onChange: (patch: Partial<PhotoEngravingDraft>) => void;
};

export function PhotoEngravingFields(props: PhotoEngravingFieldsProps): JSX.Element {
  const { draft, onChange } = props;
  return (
    <div className="lf-photo-engraving__controls">
      <label>
        <span>Photo processing</span>
        <select
          className="lf-select"
          title="Choose the dot pattern used to reproduce photographic shading."
          value={draft.ditherAlgorithm}
          onChange={(event) => onChange({ ditherAlgorithm: photoDither(event.target.value) })}
        >
          {PHOTO_DITHER_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Material marking</span>
        <select
          className="lf-select"
          title="Choose whether engraving makes dark or light marks on your material."
          value={draft.negativeImage ? 'light' : 'dark'}
          onChange={(event) => onChange({ negativeImage: event.target.value === 'light' })}
        >
          <option value="dark">Dark marks on a light surface</option>
          <option value="light">Light marks on a dark surface</option>
        </select>
      </label>
      <p className="lf-photo-engraving__hint">
        {draft.negativeImage
          ? 'For surfaces such as slate that mark lighter. Reverses the engraving and shows light marks in the preview.'
          : 'For surfaces such as wood that mark darker. Darker parts of the photo use more laser dots.'}
      </p>
      <PhotoToneFields draft={draft} onChange={onChange} />
      <PhotoResolutionFields {...props} />
    </div>
  );
}

function PhotoToneFields({
  draft,
  onChange,
}: Pick<PhotoEngravingFieldsProps, 'draft' | 'onChange'>): JSX.Element {
  return (
    <>
      <div className="lf-photo-engraving__tone-heading">
        <h3>Photo tones</h3>
        <Button variant="ghost" onClick={() => onChange({ brightness: 0, contrast: 0, gamma: 1 })}>
          Reset tones
        </Button>
      </div>
      <PhotoNumber
        label="Brightness"
        value={draft.brightness}
        min={-100}
        max={100}
        onChange={(brightness) => onChange({ brightness })}
      />
      <PhotoNumber
        label="Contrast"
        value={draft.contrast}
        min={-100}
        max={100}
        onChange={(contrast) => onChange({ contrast })}
      />
      <PhotoNumber
        label="Midtones (gamma)"
        value={draft.gamma}
        min={0.1}
        max={5}
        onChange={(gamma) => onChange({ gamma })}
      />
      <p className="lf-photo-engraving__hint">
        Higher gamma lightens midtones. Keep detail in the eyes, cheeks and hair before adding
        contrast.
      </p>
    </>
  );
}

function PhotoResolutionFields(props: PhotoEngravingFieldsProps): JSX.Element {
  const { draft, onChange } = props;
  const dpiBounds = imageDensityBounds(props.storedLinesPerMm).dpi;
  const dimensions = photoSourceDimensions(props.image);
  const dpi = linesPerMmToDpi(draft.linesPerMm);
  return (
    <>
      <h3>Engraving resolution</h3>
      <label className="lf-photo-engraving__number">
        <span>DPI</span>
        <DraftNumberInput
          aria-label="Photo engraving DPI"
          value={dpi}
          min={dpiBounds.min}
          max={dpiBounds.max}
          step="any"
          format={(value) => String(Number(value.toFixed(2)))}
          normalize={(value) => linesPerMmToDpi(dpiToLinesPerMm(value))}
          onValueChange={(value) => onChange({ linesPerMm: dpiToLinesPerMm(value) })}
        />
      </label>
      <p className="lf-photo-engraving__hint">
        {linesPerMmToLineIntervalMm(draft.linesPerMm).toFixed(3)} mm between scan lines. Placed at{' '}
        {dimensions.widthMm.toFixed(1)} × {dimensions.heightMm.toFixed(1)} mm. Source detail: about{' '}
        {Math.round(dimensions.sourceDpi)} DPI at this size.
      </p>
      {dpi > dimensions.sourceDpi * 1.05 ? (
        <p className="lf-photo-engraving__hint">
          Increasing DPI beyond the source resolution adds dots, but cannot recover missing facial
          detail.
        </p>
      ) : null}
    </>
  );
}

function PhotoNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="lf-photo-engraving__number">
      <span>{props.label}</span>
      <DraftNumberInput
        aria-label={`Photo ${props.label.toLowerCase()}`}
        value={props.value}
        min={props.min}
        max={props.max}
        step="any"
        normalize={(value) => Math.max(props.min, Math.min(props.max, value))}
        onValueChange={props.onChange}
      />
    </label>
  );
}
