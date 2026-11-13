import { dpiToLinesPerMm, linesPerMmToDpi, linesPerMmToLineIntervalMm } from '../../core/raster';
import {
  SHARPEN_AMOUNT_MAX,
  SHARPEN_RADIUS_MAX,
  SHARPEN_RADIUS_MIN,
} from '../../core/raster/luma-sharpen';
import type { RasterImage } from '../../core/scene';
import { Button } from '../kit';
import { DraftNumberInput } from '../kit/DraftNumberInput';
import { DitherSwatchPicker } from '../layers/DitherSwatchPicker';
import { IMAGE_GAMMA_DIRECTION_HINT } from './gamma-direction';
import { imageDensityBounds } from './image-density-bounds';
import { PhotoTestedBurnField } from './PhotoTestedBurnField';
import { PhotoToneCalibrationField } from './PhotoToneCalibrationField';
import { PHOTO_RECIPES, photoRecipe } from './photo-recipes';
import {
  photoProcessing,
  photoSourceDimensions,
  type PhotoEngravingDraft,
  type PhotoProcessing,
} from './photo-engraving-settings';

const NO_RECIPE = 'none';

type PhotoEngravingFieldsProps = {
  readonly draft: PhotoEngravingDraft;
  readonly image: RasterImage;
  readonly storedLinesPerMm: number;
  /** ADR-685: the chosen material recipe, and whether Auto tones can read the photo yet. */
  readonly recipeId: string | null;
  readonly onRecipe: (recipeId: string | null) => void;
  readonly autoTonesReady: boolean;
  /** A recipe's Auto tones still wait for the preview's histogram. */
  readonly recipeTonesPending?: boolean;
  readonly onAutoTones: () => void;
  readonly spotSizeMm?: { readonly x: number; readonly y: number } | undefined;
  /** From the photo's stored mode, so Grayscale stays offered after another is picked. */
  readonly processingChoices: ReadonlyArray<PhotoProcessing>;
  /** The operation's burn power (the photo's multiplier applied) and speed.
   * A tested power and speed in the draft replace them (ADR-711). */
  readonly power: number;
  readonly speed: number;
  readonly onChange: (patch: Partial<PhotoEngravingDraft>) => void;
  readonly onCalibrateTones: () => void;
  readonly onBurnTestCard: () => void;
};

export function PhotoEngravingFields(props: PhotoEngravingFieldsProps): JSX.Element {
  const { draft, onChange } = props;
  return (
    <div className="lf-photo-engraving__controls">
      <PhotoRecipeField {...props} />
      {/* A div, not a label: a label would hand a click on its name to the first swatch. */}
      <div className="lf-photo-engraving__field">
        <span>Photo processing</span>
        <DitherSwatchPicker
          value={draft.ditherAlgorithm}
          algorithms={props.processingChoices}
          ariaLabel="Photo processing"
          title="Choose the dot pattern used to reproduce photographic shading."
          onChange={(algorithm) => onChange({ ditherAlgorithm: photoProcessing(algorithm) })}
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
      <PhotoTestedBurnField
        draft={draft}
        operationPower={props.power}
        operationSpeed={props.speed}
        onChange={onChange}
        onBurnTestCard={props.onBurnTestCard}
      />
      {/* A tone calibration depends on the power and speed the photo burns with. */}
      <PhotoToneCalibrationField
        draft={draft}
        power={draft.testedBurn?.power ?? props.power}
        speed={draft.testedBurn?.speed ?? props.speed}
        onChange={onChange}
        onCalibrate={props.onCalibrateTones}
      />
      <PhotoToneFields {...props} />
      <PhotoResolutionFields {...props} />
      <PhotoSharpenFields draft={draft} onChange={onChange} />
    </div>
  );
}

// ADR-685: one choice that prepares the portrait for a kind of material.
function PhotoRecipeField(props: PhotoEngravingFieldsProps): JSX.Element {
  const recipe = photoRecipe(props.recipeId);
  return (
    <>
      <label>
        <span>Material recipe</span>
        <select
          className="lf-select"
          aria-label="Material recipe"
          title="Prepare the portrait for a kind of material: marking, dot pattern, tones and sharpening. Power, speed and DPI stay as they are; a test card finds power and speed."
          value={recipe?.id ?? NO_RECIPE}
          onChange={(event) =>
            props.onRecipe(event.target.value === NO_RECIPE ? null : event.target.value)
          }
        >
          <option value={NO_RECIPE}>Choose a material…</option>
          {PHOTO_RECIPES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p className="lf-photo-engraving__hint">
        {recipe === null
          ? 'Sets the marking, Blue Noise dots, auto tones and a light sharpen for a portrait on that material. Power, speed and DPI stay yours to test: Burn a test card below finds power and speed.'
          : `${recipe.note}${recipe.mirror ? ' Flip the photo horizontally on the canvas before burning, because you view it through the material.' : ''}${recipe.lightMarks ? LIGHT_MARKS_BACKGROUND : ''}${props.recipeTonesPending === true ? ' Auto tones apply once the preview has read the photo.' : ''}`}
      </p>
    </>
  );
}

// Light marks invert the photo, so a background removed to white burns solid
// (rolling audit v9 R8-P3-1). A mask leaves it unburned.
const LIGHT_MARKS_BACKGROUND =
  ' A background removed to white burns solid with light marks: draw a closed shape around the subject and use Tools → Apply Mask to Image instead.';

function PhotoToneFields(props: PhotoEngravingFieldsProps): JSX.Element {
  const { draft, onChange } = props;
  return (
    <>
      <div className="lf-photo-engraving__tone-heading">
        <h3>Photo tones</h3>
        <span>
          <Button
            variant="ghost"
            disabled={!props.autoTonesReady}
            title={
              props.autoTonesReady
                ? 'Set brightness, contrast and midtones from this photo: its darkest and lightest 0.5% become solid and blank, and its middle tone stays put. Clears stray dots from highlights and background. Works best on a photo cropped to the face.'
                : 'Available once the preview has read the photo.'
            }
            onClick={props.onAutoTones}
          >
            Auto tones
          </Button>
          <Button
            variant="ghost"
            onClick={() => onChange({ brightness: 0, contrast: 0, gamma: 1 })}
          >
            Reset tones
          </Button>
        </span>
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
        {IMAGE_GAMMA_DIRECTION_HINT} Keep detail in the eyes, cheeks and hair before adding
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
      <SpotIntervalHint spotSizeMm={props.spotSizeMm} linesPerMm={draft.linesPerMm} />
      {dpi > dimensions.sourceDpi * 1.05 ? (
        <p className="lf-photo-engraving__hint">
          Increasing DPI beyond the source resolution adds dots, but cannot recover missing facial
          detail.
        </p>
      ) : null}
    </>
  );
}

// ADR-685: lines just touch when the interval matches the spot (LightBurn's
// Working With Images); a finer interval overlaps the dots.
function SpotIntervalHint(props: {
  readonly spotSizeMm?: { readonly x: number; readonly y: number } | undefined;
  readonly linesPerMm: number;
}): JSX.Element | null {
  const spot = props.spotSizeMm;
  if (spot === undefined || !(spot.y > 0)) return null;
  const intervalMm = linesPerMmToLineIntervalMm(props.linesPerMm);
  const touchingDpi = Math.round(25.4 / spot.y);
  return (
    <p className="lf-photo-engraving__hint">
      This laser's {spot.x.toFixed(2)} × {spot.y.toFixed(2)} mm spot makes scan lines that just
      touch at about {spot.y.toFixed(2)} mm ({touchingDpi} DPI).{' '}
      {intervalMm < spot.y * 0.95
        ? `At ${intervalMm.toFixed(3)} mm each dot overlaps its neighbours, so the burn darkens; Auto tones and a tone calibration help. Confirm with Tools → Interval Test.`
        : 'Confirm with Tools → Interval Test on your material.'}
    </p>
  );
}

// ADR-671: sharpening runs on the engraving grid, after resampling.
function PhotoSharpenFields({
  draft,
  onChange,
}: Pick<PhotoEngravingFieldsProps, 'draft' | 'onChange'>): JSX.Element {
  const radiusMm = draft.sharpenRadius * linesPerMmToLineIntervalMm(draft.linesPerMm);
  return (
    <>
      <h3>Sharpen at engraving resolution</h3>
      <PhotoNumber
        label="Sharpen amount (%)"
        value={draft.sharpenAmount}
        min={0}
        max={SHARPEN_AMOUNT_MAX}
        onChange={(sharpenAmount) => onChange({ sharpenAmount })}
      />
      <PhotoNumber
        label="Sharpen radius (lines)"
        value={draft.sharpenRadius}
        min={SHARPEN_RADIUS_MIN}
        max={SHARPEN_RADIUS_MAX}
        onChange={(sharpenRadius) => onChange({ sharpenRadius })}
      />
      <p className="lf-photo-engraving__hint">
        {draft.sharpenAmount > 0
          ? `Sharpens the eyes and hair after the photo is fitted to the scan lines, over ${radiusMm.toFixed(3)} mm. Higher amounts also bring out grain in skin.`
          : 'Off. Fitting the photo to the scan lines softens its finest detail slightly; about 30% at 0.7 lines restores it.'}
      </p>
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
