import { useState } from 'react';
import type { FixtureTemplate } from '../../../core/camera/fixtures/fixture-template';
import { fixtureObservationMetrics } from '../../../core/camera/fixtures/fixture-layout';
import { Button, Dialog, DialogActions } from '../../kit';
import { FixtureLayoutPreview } from './FixtureLayoutPreview';
import { useFixtureReview, type FixtureReview } from './use-fixture-review';
import { FixtureQualificationDialog } from './FixtureQualificationDialog';

export function FixtureReviewDialog(props: {
  readonly template: FixtureTemplate;
  readonly onClose: () => void;
}): JSX.Element {
  const review = useFixtureReview(props.template, props.onClose);
  const [observing, setObserving] = useState(false);
  if (observing)
    return (
      <FixtureQualificationDialog
        template={props.template}
        onClose={() => setObserving(false)}
        onSaved={review.close}
      />
    );
  return (
    <Dialog
      title={`Review Fixture: ${props.template.name}`}
      size="md"
      as="form"
      onClose={review.close}
      onSubmit={(event) => {
        event.preventDefault();
        review.apply();
      }}
    >
      <p>
        Saved {props.template.createdAt}. Coordinates: scene mm, {props.template.basis.bedWidthMm} ×{' '}
        {props.template.basis.bedHeightMm} mm.{' '}
        {props.template.sample === undefined
          ? 'Designs are centred on each slot.'
          : 'The saved sample offset and orientation are reused without scaling.'}
      </p>
      <FixtureLayoutPreview
        template={props.template}
        plan={review.plan?.kind === 'ok' ? review.plan.value : null}
      />
      <FixtureSlotChoices template={props.template} review={review} />
      {review.warnings.map((warning) => (
        <p key={warning} role="status" style={{ fontSize: 12 }}>
          {warning}
        </p>
      ))}
      <FixtureObservationSummary template={props.template} />
      <p style={{ fontSize: 12 }}>
        Camera calibration fit errors describe its calibration target. Manual observations describe
        only the measured checkpoints at their recorded setup. Neither establishes a universal
        accuracy or machine completion.
      </p>
      <label>
        <input
          type="checkbox"
          checked={review.reviewed}
          disabled={!review.current}
          title="Confirm that you reviewed the saved coordinate basis, physical fixture alignment, selected slots and design dimensions for this batch."
          onChange={(event) => review.confirm(event.currentTarget.checked)}
        />{' '}
        I reviewed the fixture basis, actual alignment and proposed placements for this batch.
      </label>
      <p role="status">
        {!review.current
          ? 'Document or selection changed. Reopen the fixture review.'
          : review.owner.design === null
            ? 'Select the design to repeat before opening the fixture.'
            : review.plan?.kind === 'error'
              ? review.plan.error.message
              : 'Placement changes artwork in one undo step. Review the job and complete its ordinary Frame before Start.'}
      </p>
      <FixtureReviewActions review={review} observe={() => setObserving(true)} />
    </Dialog>
  );
}
function FixtureSlotChoices({
  template,
  review,
}: {
  readonly template: FixtureTemplate;
  readonly review: FixtureReview;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Saved fixture slot choices"
      style={{ maxHeight: 120, overflowY: 'auto' }}
    >
      {template.slots.map((slot, index) => (
        <label key={slot.id} style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={review.included.includes(slot.id)}
            title="Include this recorded slot in the proposed layout."
            onChange={(event) => review.choose(slot.id, event.currentTarget.checked)}
          />{' '}
          {index + 1}. {slot.piece.rect.length.toFixed(2)} × {slot.piece.rect.width.toFixed(2)} mm ·{' '}
          {slot.piece.rect.axisDeg.toFixed(1)}°{slot.piece.partial ? ' · partial observation' : ''}
        </label>
      ))}
    </div>
  );
}
function FixtureObservationSummary({
  template,
}: {
  readonly template: FixtureTemplate;
}): JSX.Element {
  const context = template.camera;
  const qualification = template.qualification;
  const metrics = qualification === undefined ? null : fixtureObservationMetrics(qualification);
  return (
    <>
      {context !== undefined && (
        <p>
          Recorded calibration fit: RMS {context.model.accuracy.rmsErrorMm.toFixed(3)} mm, maximum{' '}
          {context.model.accuracy.maxErrorMm.toFixed(3)} mm, {context.model.accuracy.foundMarks}{' '}
          marks. Recorded surface: {context.surfaceHeightMm} mm.
        </p>
      )}
      {qualification === undefined || metrics === null ? (
        <p>No manual placement observations are saved for this fixture.</p>
      ) : (
        <p>
          Manual observations {qualification.recordedAt}: {metrics.samples} point(s), RMS{' '}
          {metrics.rmsErrorMm.toFixed(3)} mm, maximum {metrics.maxErrorMm.toFixed(3)} mm.{' '}
          {qualification.camera === undefined
            ? 'No camera context was recorded for these observations.'
            : `Observed at surface height ${qualification.camera.surfaceHeightMm} mm; calibration ${qualification.camera.model.calibratedAt}.`}{' '}
          {qualification.notes}
        </p>
      )}
    </>
  );
}

function FixtureReviewActions({
  review,
  observe,
}: {
  readonly review: FixtureReview;
  readonly observe: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <Button onClick={review.close}>Cancel</Button>
      <Button onClick={review.remove} disabled={!review.current}>
        Delete fixture
      </Button>
      <Button onClick={observe} disabled={!review.current}>
        Record placement observations
      </Button>
      <Button
        type="submit"
        variant="primary"
        disabled={!review.current || !review.reviewed || review.plan?.kind !== 'ok'}
      >
        Place reviewed selection
      </Button>
    </DialogActions>
  );
}
