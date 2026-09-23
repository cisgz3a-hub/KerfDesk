import { useState } from 'react';
import type { Scene } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { unionSilhouetteOperations } from './selection-command-state';

export function UnionSilhouetteDialog(props: {
  readonly scene: Scene;
  readonly selectedIds: ReadonlyArray<string>;
  readonly onCancel: () => void;
  readonly onApply: (operationId: string) => void;
}): JSX.Element {
  const operations = unionSilhouetteOperations(props.scene, props.selectedIds);
  const [chosenId, setChosenId] = useState(operations[0]?.id ?? '');
  const canApply = operations.some((operation) => operation.id === chosenId);
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
          title="Choose the operation whose settings the combined silhouette will use."
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
