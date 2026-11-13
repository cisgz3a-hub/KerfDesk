import { useEffect, useState } from 'react';
import type { PhotoTestCardOptions } from '../../core/job/photo-test-card';
import { cropPhotoTestPatch, photoTestWindow } from '../../core/job/photo-test-patch';
import { MAX_RASTER_SOURCE_READ_PIXELS } from '../../core/raster/raster-budget';
import type { RasterImage } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { readRasterImageLuma } from '../raster/crop-image';
import { persistCalibrationDraft, restoreCalibrationDraft } from './calibration-draft-storage';
import {
  DEFAULT_PHOTO_TEST_CARD_DRAFT,
  PHOTO_TEST_CARD_DRAFT_FIELDS,
  PHOTO_TEST_CARD_DRAFT_KEY,
  photoTestCardOptions,
  photoTestDraftIssues,
  photoTestPlacement,
  photoTestSourceShape,
  photoTestWindowOptions,
  readLastPhotoTestCard,
  seededPhotoTestDraft,
  type PhotoTestCardDraft,
  type PhotoTestCardRecord,
  type PhotoTestSeed,
} from './photo-test-card-draft';
import type { PhotoTestCardStep as StepName } from './photo-test-card-store';
import { photoTestResultLabel, type PhotoTestResult } from './photo-test-library';
import { PhotoTestCardStep, type PhotoTestSourceState } from './PhotoTestCardStep';
import { EMPTY_PHOTO_TEST_PICK, PhotoTestPickStep, type PhotoTestPick } from './PhotoTestPickStep';
import './tone-calibration.css';
import './photo-test-card.css';

type ReadLuma = (image: RasterImage) => Promise<Uint8Array>;

export function PhotoTestCardDialog(props: {
  readonly initialStep: StepName;
  readonly seed: PhotoTestSeed | null;
  readonly maxFeedMmPerMin: number | undefined;
  /** Reads the photo's stored pixels; tests supply their own. */
  readonly readLuma?: ReadLuma;
  readonly onClose: () => void;
  readonly onGenerate: (options: PhotoTestCardOptions, seed: PhotoTestSeed) => void;
  readonly onSave: (result: PhotoTestResult) => void;
}): JSX.Element {
  const { seed } = props;
  const [step, setStep] = useState(props.initialStep);
  const [draft, setDraft] = useState(() => initialDraft(seed, props.maxFeedMmPerMin));
  const [pick, setPick] = useState<PhotoTestPick>(EMPTY_PHOTO_TEST_PICK);
  const [card] = useState(readLastPhotoTestCard);
  const source = usePhotoTestSource(seed, props.readLuma ?? readRasterImageLuma);
  const draftIssues = photoTestDraftIssues(draft);
  const issues =
    step === 'generate' ? generateIssues(seed, source, draftIssues) : pickIssues(card, pick);
  const submit = (): void => {
    if (issues.length > 0) return;
    if (step === 'pick') {
      const result = pickedResult(card, pick);
      if (result !== null) props.onSave(result);
      return;
    }
    if (seed === null || source.status !== 'ready') return;
    persistCalibrationDraft(PHOTO_TEST_CARD_DRAFT_KEY, draft);
    const window = photoTestWindow(source.source, photoTestWindowOptions(draft, seed));
    const patch = cropPhotoTestPatch(source.source, window, photoTestPlacement(seed.image).mirror);
    const { maxFeedMmPerMin } = props;
    props.onGenerate(photoTestCardOptions({ draft, seed, patch, maxFeedMmPerMin }), seed);
  };
  return (
    <Dialog
      title="Photo Test Card"
      size="lg"
      panelClassName="lf-tone-calibration lf-photo-test-card"
      onClose={props.onClose}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <StepTabs current={step} onSelect={setStep} />
      <div
        role="tabpanel"
        aria-label={step === 'generate' ? 'Burn the card' : 'Pick the best square'}
      >
        {step === 'generate' ? (
          <PhotoTestCardStep
            draft={draft}
            seed={seed}
            source={source}
            valid={draftIssues.length === 0}
            maxFeedMmPerMin={props.maxFeedMmPerMin}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        ) : (
          <PhotoTestPickStep
            card={card}
            pick={pick}
            onChange={(patch) => setPick((current) => ({ ...current, ...patch }))}
          />
        )}
      </div>
      {shownIssues(issues, step, seed, card).length > 0 ? (
        <p role="alert">{shownIssues(issues, step, seed, card).join(' ')}</p>
      ) : null}
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={issues.length > 0}>
          {step === 'generate' ? 'Generate card' : 'Save power and speed'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function StepTabs(props: {
  readonly current: StepName;
  readonly onSelect: (step: StepName) => void;
}): JSX.Element {
  return (
    <div className="lf-tone-calibration__steps" role="tablist" aria-label="Photo test card step">
      <StepTab step="generate" {...props}>
        1. Burn the card
      </StepTab>
      <StepTab step="pick" {...props}>
        2. Pick the best square
      </StepTab>
    </div>
  );
}

function StepTab(props: {
  readonly step: StepName;
  readonly current: StepName;
  readonly onSelect: (step: StepName) => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const selected = props.step === props.current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title="Go to this step of the photo test card"
      className={`lf-tone-calibration__step${selected ? ' is-selected' : ''}`}
      onClick={() => props.onSelect(props.step)}
    >
      {props.children}
    </button>
  );
}

function initialDraft(
  seed: PhotoTestSeed | null,
  maxFeedMmPerMin: number | undefined,
): PhotoTestCardDraft {
  const stored = restoreCalibrationDraft(
    PHOTO_TEST_CARD_DRAFT_KEY,
    DEFAULT_PHOTO_TEST_CARD_DRAFT,
    PHOTO_TEST_CARD_DRAFT_FIELDS,
  );
  return seed === null ? stored : seededPhotoTestDraft(seed, stored, maxFeedMmPerMin);
}

const READING = 'Reading the photo…';

// A step that already explains what is missing shows no second message, and
// the short wait for the photo's pixels is not an error.
function shownIssues(
  issues: ReadonlyArray<string>,
  step: StepName,
  seed: PhotoTestSeed | null,
  card: PhotoTestCardRecord | null,
): ReadonlyArray<string> {
  const explained = step === 'generate' ? seed === null : card === null;
  return explained ? [] : issues.filter((issue) => issue !== READING);
}

function generateIssues(
  seed: PhotoTestSeed | null,
  source: PhotoTestSourceState,
  draftIssues: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (seed === null) return ['Select a photo first.'];
  if (draftIssues.length > 0) return draftIssues;
  if (source.status === 'error') return [source.message];
  return source.status === 'loading' ? [READING] : [];
}

function pickIssues(card: PhotoTestCardRecord | null, pick: PhotoTestPick): ReadonlyArray<string> {
  if (card === null) return ['Burn a card first.'];
  return [
    ...(pickedCell(card, pick) === null ? ['Pick the best square.'] : []),
    ...(pick.material.trim() === '' ? ['Name the material.'] : []),
  ];
}

function pickedCell(
  card: PhotoTestCardRecord,
  pick: PhotoTestPick,
): { readonly power: number; readonly speed: number } | null {
  const power = pick.column === null ? undefined : card.powers[pick.column];
  const speed = pick.row === null ? undefined : card.speeds[pick.row];
  return power === undefined || speed === undefined ? null : { power, speed };
}

function pickedResult(
  card: PhotoTestCardRecord | null,
  pick: PhotoTestPick,
): PhotoTestResult | null {
  const cell = card === null ? null : pickedCell(card, pick);
  if (card === null || cell === null) return null;
  return {
    id: crypto.randomUUID(),
    label: photoTestResultLabel(pick.material, cell.power, cell.speed),
    power: cell.power,
    speed: cell.speed,
    savedAt: new Date().toISOString(),
    processing: card.processing,
  };
}

function usePhotoTestSource(seed: PhotoTestSeed | null, readLuma: ReadLuma): PhotoTestSourceState {
  const [state, setState] = useState<PhotoTestSourceState>({ status: 'loading' });
  useEffect(() => {
    if (seed === null) return undefined;
    let live = true;
    const shape = photoTestSourceShape(seed.image);
    // The same ceiling as a Photo engraving preview's one read (ADR-581 Amendment 1).
    if (shape.pixelWidth * shape.pixelHeight > MAX_RASTER_SOURCE_READ_PIXELS) {
      setState({ status: 'error', message: TOO_BIG });
      return undefined;
    }
    readLuma(seed.image).then(
      (luma) => {
        if (!live) return;
        setState(
          luma.length === shape.pixelWidth * shape.pixelHeight
            ? { status: 'ready', source: { luma, ...shape } }
            : { status: 'error', message: UNREADABLE },
        );
      },
      () => {
        if (live) setState({ status: 'error', message: UNREADABLE });
      },
    );
    return () => {
      live = false;
    };
  }, [seed, readLuma]);
  return state;
}

const TOO_BIG =
  'This photo is too big to make a card from. Crop it or use a smaller copy, then try again.';

const UNREADABLE =
  'KerfDesk could not read this photo’s pixels. Import the photo again, then make the card.';
