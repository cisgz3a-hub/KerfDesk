import { useSaveFixtureReview } from './use-save-fixture-review';
import { Button, Dialog, DialogActions } from '../../kit';
export function SaveFixtureDialog(props: { readonly onClose: () => void }): JSX.Element {
  const { owner, name, setName, current, result, save } = useSaveFixtureReview(props.onClose);
  return (
    <Dialog
      title="Save Fixture Intent"
      size="sm"
      as="form"
      onClose={props.onClose}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="lf-field">
        <span>Fixture name</span>
        <input
          className="lf-input"
          value={name}
          maxLength={120}
          aria-label="Fixture name"
          title="A name for the saved geometry and setup context."
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <p>
        Included slots:{' '}
        {owner.scan?.pieces.length === undefined
          ? 0
          : owner.scan.pieces.length - owner.scan.excluded.size}
        . Coordinates: scene millimetres on a {owner.project.device.bedWidth} ×{' '}
        {owner.project.device.bedHeight} mm bed.
      </p>
      <p>
        {result?.kind === 'ok' && result.value.sample !== undefined
          ? 'The sample design frame is recorded for repeated offset and orientation.'
          : 'A sample is recorded only when the selected design lies on an included piece. Otherwise later selections are centred on each slot.'}
      </p>
      <p>
        {owner.camera === undefined
          ? 'No active calibrated camera context is available; physical alignment must be verified independently.'
          : `Camera calibration: ${owner.camera.model.calibratedAt}. Surface height: ${owner.camera.surfaceHeightMm} mm. This archive does not change the camera.`}
      </p>
      <p role="status">
        {!current
          ? 'Artwork, camera scan or selection changed. Reopen this save review.'
          : result?.kind === 'error'
            ? result.error.message
            : 'Saved geometry is reusable intent, not a fresh physical placement or completion record.'}
      </p>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!current || result?.kind !== 'ok'}>
          Save fixture
        </Button>
      </DialogActions>
    </Dialog>
  );
}
