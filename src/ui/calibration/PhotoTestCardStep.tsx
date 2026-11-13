import type { ChangeEvent } from 'react';
import { photoTestCardAxes } from '../../core/job/photo-test-card';
import {
  photoTestWindow,
  photoTestWindowSizeMm,
  type PhotoTestSource,
} from '../../core/job/photo-test-patch';
import { calibrationGridStyle } from './calibration-dialog-styles';
import { CalibrationNumberField } from './CalibrationNumberField';
import {
  photoTestRanges,
  photoTestWindowOptions,
  type PhotoTestCardDraft,
  type PhotoTestSeed,
} from './photo-test-card-draft';
import { describeProcessing } from './PhotoTestPickStep';
import { PhotoTestPatchPicker } from './PhotoTestPatchPicker';

/** The photo's stored pixels, read when the dialog opens. */
export type PhotoTestSourceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly source: PhotoTestSource }
  | { readonly status: 'error'; readonly message: string };

type FieldKey = Exclude<keyof PhotoTestCardDraft, 'centreX' | 'centreY'>;

const CARD_FIELDS: ReadonlyArray<{
  readonly key: FieldKey;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | 'any';
}> = [
  { key: 'columns', label: 'Powers across', min: 1, max: 8, step: 1 },
  { key: 'rows', label: 'Speeds down', min: 1, max: 8, step: 1 },
  { key: 'powerMin', label: 'Lowest power (%)', min: 0, max: 100, step: 'any' },
  { key: 'powerMax', label: 'Highest power (%)', min: 0, max: 100, step: 'any' },
  { key: 'speedMin', label: 'Slowest speed (mm/min)', min: 1, max: undefined, step: 'any' },
  { key: 'speedMax', label: 'Fastest speed (mm/min)', min: 1, max: undefined, step: 'any' },
  { key: 'cellSizeMm', label: 'Square size (mm)', min: 5, max: 50, step: 'any' },
  { key: 'gapMm', label: 'Gap (mm)', min: 0, max: 20, step: 'any' },
];

export function PhotoTestCardStep(props: {
  readonly draft: PhotoTestCardDraft;
  readonly seed: PhotoTestSeed | null;
  readonly source: PhotoTestSourceState;
  readonly valid: boolean;
  readonly maxFeedMmPerMin: number | undefined;
  readonly onChange: (patch: Partial<PhotoTestCardDraft>) => void;
}): JSX.Element {
  const { draft, seed, onChange } = props;
  if (seed === null)
    return (
      <p className="lf-tone-calibration__intro">
        Select one photo on the canvas, then open Photo Test Card again. The card is made from a
        piece of that photo.
      </p>
    );
  const text =
    (key: keyof PhotoTestCardDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void =>
      onChange({ [key]: event.target.value });
  return (
    <>
      <p className="lf-tone-calibration__intro">
        Find the power and speed for this photo on your material. Every square burns the same piece
        of your photo, at the size and with the settings the photo will burn with. Only power and
        speed change from square to square.
      </p>
      <p className="lf-tone-calibration__hint">
        Squares cut from <strong>{seed.sourceName}</strong>, burned with{' '}
        {describeProcessing(seed.settings)}. Its tones, sharpening and other image settings burn the
        squares too.
      </p>
      <div className="lf-photo-test-card__layout">
        <PatchChoice {...props} seed={seed} text={text} />
        <div style={calibrationGridStyle}>
          {CARD_FIELDS.map((field) => (
            <CalibrationNumberField
              key={field.key}
              label={field.label}
              value={draft[field.key]}
              min={field.min}
              max={field.max}
              step={field.step}
              onChange={text(field.key)}
            />
          ))}
        </div>
      </div>
      {props.valid ? <CardSummary {...props} seed={seed} /> : null}
      <p className="lf-tone-calibration__hint">
        Generate replaces the current project with the card (you are asked to save first, and Undo
        brings the photo back). Burn the card on a scrap of the same material with Frame and Start
        as usual, then reopen Photo Test Card and pick the best square.
      </p>
    </>
  );
}

function PatchChoice(props: {
  readonly draft: PhotoTestCardDraft;
  readonly seed: PhotoTestSeed;
  readonly source: PhotoTestSourceState;
  readonly valid: boolean;
  readonly onChange: (patch: Partial<PhotoTestCardDraft>) => void;
  readonly text: (key: keyof PhotoTestCardDraft) => (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  const { draft, source } = props;
  return (
    <div className="lf-photo-test-card__patch">
      {source.status === 'ready' && props.valid ? (
        <PhotoTestPatchPicker
          source={source.source}
          window={photoTestWindow(source.source, photoTestWindowOptions(draft, props.seed))}
          onPick={(centreX, centreY) =>
            props.onChange({ centreX: String(centreX), centreY: String(centreY) })
          }
        />
      ) : (
        <p className="lf-tone-calibration__hint" role="status">
          {source.status === 'error'
            ? source.message
            : source.status === 'loading'
              ? 'Reading the photo…'
              : 'Fix the fields to see the piece.'}
        </p>
      )}
      <div style={calibrationGridStyle}>
        <CalibrationNumberField
          label="Across the photo (%)"
          value={draft.centreX}
          min={0}
          max={100}
          step="any"
          onChange={props.text('centreX')}
        />
        <CalibrationNumberField
          label="Down the photo (%)"
          value={draft.centreY}
          min={0}
          max={100}
          step="any"
          onChange={props.text('centreY')}
        />
      </div>
      <p className="lf-tone-calibration__hint">
        Click the photo to choose the piece. The eyes show a good burn best.
      </p>
    </div>
  );
}

// The piece snaps to whole stored pixels, so 10 mm may be 9.99: show a tenth.
function roundedMm(value: number): string {
  return String(Number(value.toFixed(1)));
}

// What Generate will make, in the card's own numbers.
function CardSummary(props: {
  readonly draft: PhotoTestCardDraft;
  readonly seed: PhotoTestSeed;
  readonly source: PhotoTestSourceState;
  readonly maxFeedMmPerMin: number | undefined;
}): JSX.Element {
  const { speedAxis, powerAxis } = photoTestCardAxes({
    ...photoTestRanges(props.draft),
    ...(props.maxFeedMmPerMin === undefined ? {} : { maxFeedMmPerMin: props.maxFeedMmPerMin }),
  });
  const size =
    props.source.status === 'ready'
      ? photoTestWindowSizeMm(
          props.source.source,
          photoTestWindow(props.source.source, photoTestWindowOptions(props.draft, props.seed)),
        )
      : null;
  return (
    <p className="lf-tone-calibration__hint" role="status" aria-label="Card summary">
      {powerAxis.values.length * speedAxis.values.length} squares
      {size === null ? '' : ` of ${roundedMm(size.widthMm)} × ${roundedMm(size.heightMm)} mm`}.
      Power across: {powerAxis.labels.join(', ')} %. Speed down: {speedAxis.labels.join(', ')}{' '}
      mm/min.
    </p>
  );
}
