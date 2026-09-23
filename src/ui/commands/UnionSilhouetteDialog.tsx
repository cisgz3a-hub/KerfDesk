import { useState } from 'react';
import { pathUsesOperation, type Scene } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';

export function UnionSilhouetteDialog(props: {
  readonly scene: Scene;
  readonly selectedIds: ReadonlyArray<string>;
  readonly onCancel: () => void;
  readonly onApply: (operationId: string) => void;
}): JSX.Element {
  const selected = props.scene.objects.filter((object) => props.selectedIds.includes(object.id));
  const operations = props.scene.layers.filter((operation) =>
    selected.some(
      (object) =>
        'paths' in object &&
        object.paths.some((path) => pathUsesOperation(object, path, operation)),
    ),
  );
  const [chosenId, setChosenId] = useState(operations[0]?.id ?? '');
  const validSelection =
    selected.length > 0 &&
    selected.length === props.selectedIds.length &&
    selected.every(
      (object) =>
        object.locked !== true &&
        'paths' in object &&
        object.paths.length > 0 &&
        object.paths.every((path) =>
          path.curves === undefined
            ? path.polylines.length > 0 && path.polylines.every((line) => line.closed)
            : path.curves.length > 0 && path.curves.every((curve) => curve.closed),
        ),
    );
  const canApply = validSelection && operations.some((operation) => operation.id === chosenId);
  return (
    <Dialog
      title="Union silhouette"
      size="sm"
      onClose={props.onCancel}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply) props.onApply(chosenId);
      }}
    >
      <p>Combine the selected closed shapes into one silhouette and remove overlapping outlines.</p>
      <label className="lf-field">
        <span>Result operation</span>
        <select
          className="lf-input"
          value={chosenId}
          onChange={(event) => setChosenId(event.currentTarget.value)}
        >
          {operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.name} ({operation.mode}
              {operation.output ? '' : ', output off'})
            </option>
          ))}
        </select>
      </label>
      <p>
        The result uses only this operation's settings. Individual artwork settings are replaced.
      </p>
      {!canApply ? (
        <p role="status">Select closed, unlocked vector shapes and choose a result operation.</p>
      ) : null}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canApply}>
          Union shapes
        </Button>
      </DialogActions>
    </Dialog>
  );
}
