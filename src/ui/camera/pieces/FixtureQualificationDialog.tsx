import { useMemo, useState } from 'react';
import { fixtureObservationMetrics } from '../../../core/camera/fixtures/fixture-layout';
import { normalizeQualification } from '../../../core/camera/fixtures/fixture-template-normalize';
import {
  FIXTURE_LIMITS,
  type FixtureTemplate,
} from '../../../core/camera/fixtures/fixture-template';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useActiveCameraModel } from '../active-camera-model';
import { fixtureBasis } from '../../state/fixture-template-actions';
import { fixtureCameraContextNow } from './fixture-camera-context';
import { commitFixtureTemplate } from './fixture-template-commit';
import { Button, Dialog, DialogActions } from '../../kit';

type ObservationForm = {
  readonly expectedX: string;
  readonly expectedY: string;
  readonly observedX: string;
  readonly observedY: string;
};
const COLUMNS: ReadonlyArray<readonly [keyof ObservationForm, string]> = [
  ['expectedX', 'Expected X'],
  ['expectedY', 'Expected Y'],
  ['observedX', 'Observed X'],
  ['observedY', 'Observed Y'],
];

export function FixtureQualificationDialog(props: {
  readonly template: FixtureTemplate;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const review = useQualificationReview(props);
  return (
    <Dialog
      title="Record Fixture Observations"
      size="md"
      as="form"
      onClose={props.onClose}
      onSubmit={(event) => {
        event.preventDefault();
        review.save();
      }}
    >
      <p>
        Enter independently observed positions in scene millimetres for known checkpoints. This
        records your measurements at the current coordinate and camera/height context. It does not
        calibrate a camera or establish machine completion.
      </p>
      <FixtureObservationFields review={review} />
      <label className="lf-field">
        <span>Measurement notes</span>
        <textarea
          className="lf-input"
          aria-label="Measurement notes"
          value={review.notes}
          maxLength={2000}
          title="Measurement method, actual material/height, fixture seating and limitations."
          onChange={(event) => review.setNotes(event.currentTarget.value)}
        />
      </label>
      <p role="status">
        {!review.current
          ? 'The setup changed. Reopen this observation record.'
          : review.metrics === null
            ? 'Enter finite independently observed coordinates for every checkpoint.'
            : `${review.metrics.samples} point(s): RMS ${review.metrics.rmsErrorMm.toFixed(3)} mm, maximum ${review.metrics.maxErrorMm.toFixed(3)} mm. Mean offset X ${review.metrics.meanDxMm.toFixed(3)}, Y ${review.metrics.meanDyMm.toFixed(3)} mm.`}
      </p>
      <p style={{ fontSize: 12 }}>
        Saving replaces this fixture's prior observation record, with one undo step. The recorded
        template calibration stays unchanged; the new observations carry their own context.
      </p>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!review.current || review.record === undefined}
        >
          Save observations
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function useQualificationReview(props: {
  readonly template: FixtureTemplate;
  readonly onSaved: () => void;
}) {
  const [owner] = useState(() => {
    const state = useStore.getState(),
      camera = useCameraStore.getState();
    return {
      project: state.project,
      epoch: state.projectDocumentEpoch,
      source: camera.sourceState,
      height: camera.surfaceHeightMm,
      areas: camera.heightAreas,
      camera: fixtureCameraContextNow(),
      now: new Date().toISOString(),
    };
  });
  const [rows, setRows] = useState<ReadonlyArray<ObservationForm>>(() => [
    emptyObservation(props.template),
  ]);
  const [notes, setNotes] = useState('');
  const project = useStore((state) => state.project),
    epoch = useStore((state) => state.projectDocumentEpoch);
  const source = useCameraStore((state) => state.sourceState),
    height = useCameraStore((state) => state.surfaceHeightMm),
    areas = useCameraStore((state) => state.heightAreas);
  const model = useActiveCameraModel();
  const current =
    project === owner.project &&
    epoch === owner.epoch &&
    source === owner.source &&
    height === owner.height &&
    areas === owner.areas &&
    (owner.camera === undefined || model === owner.camera.model);
  const record = useMemo(
    () =>
      normalizeQualification({
        recordedAt: owner.now,
        method: 'manual-observation',
        basis: fixtureBasis(owner.project),
        ...(owner.camera === undefined ? {} : { camera: owner.camera }),
        notes,
        points: rows.map((row) => ({
          expectedMm: { x: coordinate(row.expectedX), y: coordinate(row.expectedY) },
          observedMm: { x: coordinate(row.observedX), y: coordinate(row.observedY) },
        })),
      }),
    [owner, notes, rows],
  );
  const metrics = record === undefined ? null : fixtureObservationMetrics(record);
  const isCurrent = (): boolean =>
    useStore.getState().project === owner.project &&
    useStore.getState().projectDocumentEpoch === owner.epoch &&
    useCameraStore.getState().sourceState === owner.source &&
    JSON.stringify(fixtureCameraContextNow()) === JSON.stringify(owner.camera);
  const save = (): void => {
    if (record !== undefined && current && isCurrent())
      commitFixtureTemplate(
        owner.project,
        owner.epoch,
        { ...props.template, updatedAt: owner.now, qualification: record },
        props.onSaved,
        isCurrent,
      );
  };
  const change = (index: number, key: keyof ObservationForm, value: string): void =>
    setRows((previous) => previous.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const add = (): void => setRows((previous) => [...previous, emptyObservation(props.template)]);
  const remove = (index: number): void =>
    setRows((previous) => previous.filter((_, i) => i !== index));
  return { rows, notes, setNotes, current, record, metrics, save, change, add, remove };
}
function emptyObservation(template: FixtureTemplate): ObservationForm {
  const centre = template.slots[0]?.piece.rect.centre;
  return {
    expectedX: String(centre?.x ?? 0),
    expectedY: String(centre?.y ?? 0),
    observedX: '',
    observedY: '',
  };
}
function coordinate(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function FixtureObservationFields({
  review,
}: {
  readonly review: ReturnType<typeof useQualificationReview>;
}): JSX.Element {
  return (
    <>
      {' '}
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {review.rows.map((row, index) => (
          <div
            key={index}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4,1fr) auto',
              gap: 6,
              marginBottom: 8,
            }}
          >
            {COLUMNS.map(([key, label]) => (
              <label className="lf-field" key={key}>
                <span>
                  {label} {index + 1}
                </span>
                <input
                  className="lf-input"
                  type="text"
                  inputMode="decimal"
                  aria-label={`${label} ${index + 1}`}
                  value={row[key]}
                  title="Measured checkpoint coordinate in scene millimetres."
                  onChange={(event) => review.change(index, key, event.currentTarget.value)}
                />
              </label>
            ))}
            <Button disabled={review.rows.length === 1} onClick={() => review.remove(index)}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button disabled={review.rows.length >= FIXTURE_LIMITS.observations} onClick={review.add}>
        Add checkpoint
      </Button>
    </>
  );
}
