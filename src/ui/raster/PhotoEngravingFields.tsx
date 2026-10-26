import { dpiToLinesPerMm, linesPerMmToDpi, linesPerMmToLineIntervalMm } from '../../core/raster';
import type { RasterImage } from '../../core/scene';
import { Button } from '../kit';
import { DraftNumberInput } from '../kit/DraftNumberInput';
import { DitherSwatchPicker } from '../layers/DitherSwatchPicker';
import { imageDensityBounds } from './image-density-bounds';
import { PhotoToneCalibrationField } from './PhotoToneCalibrationField';
import {
  PHOTO_DITHERS,
  photoDither,
  photoSourceDimensions,
  type PhotoEngravingDraft,
} from './photo-engraving-settings';

type PhotoEngravingFieldsProps = {
  readonly draft: PhotoEngravingDraft;
  readonly image: RasterImage;
  readonly storedLinesPerMm: number;
  /** The photo's effective power and speed, which a tone calibration also depends on. */
  readonly power: number;
  readonly speed: number;
  readonly onChange: (patch: Partial<PhotoEngravingDraft>) => void;
  readonly onCalibrateTones: () => void;
};

export function PhotoEngravingFields(props: PhotoEngravingFieldsProps): JSX.Element {
  const { draft, onChange } = props;
  return (
    <div className="lf-photo-engraving__controls">
      {/* A div, not a label: a label would hand a click on its name to the first swatch. */}
      <div className="lf-photo-engraving__field">
        <span>Photo processing</span>
        <DitherSwatchPicker
          value={draft.ditherAlgorithm}
          algorithms={PHOTO_DITHERS}
          ariaLabel="Photo processing"
          title="Choose the dot pattern used to reproduce photographic shading."
          onChange={(algorithm) => onChange({ ditherAlgorithm: photoDither(algorithm) })}
        />
      </div>
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
      <PhotoToneCalibrationField
        draft={draft}
        power={props.power}
        speed={props.speed}
        onChange={onChange}
        onCalibrate={props.onCalibrateTones}
      />
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
