import { useState } from 'react';
import { isRegistrationLayer, type Layer, type SceneObject } from '../../core/scene';
import { useStore } from '../state';
import { canMove, usesOnly } from '../state/operation-assignment';

/** The inspector's Move to operation: the operation rows' Move selection here
 * for the artwork this inspector shows, as one undoable step. */
export function MoveToOperationControl(props: {
  readonly objects: ReadonlyArray<SceneObject>;
}): JSX.Element | null {
  const scene = useStore((state) => state.project.scene);
  const assignObjectsToLayer = useStore((state) => state.assignObjectsToLayer);
  const [targetId, setTargetId] = useState('');
  const movable = props.objects.filter(canMove);
  const targets = scene.layers.filter(
    (layer) =>
      !isRegistrationLayer(layer) && !movable.every((object) => usesOnly(object, scene, layer.id)),
  );
  if (movable.length === 0 || targets.length === 0) return null;
  const target = targets.find((layer) => layer.id === targetId);
  const artwork = movable.length === 1 ? 'this artwork' : `these ${movable.length} artworks`;
  const move = (): void => {
    if (target === undefined) return;
    assignObjectsToLayer(
      movable.map((object) => object.id),
      target.id,
    );
    setTargetId('');
  };
  return (
    <div className="lf-operation-move">
      <label className="lf-operation-chooser">
        <span>Move to operation</span>
        <select
          aria-label="Operation to move artwork to"
          title={`Choose an existing operation to run ${artwork} with`}
          value={target?.id ?? ''}
          onChange={(event) => setTargetId(event.target.value)}
        >
          <option value="">Choose an operation…</option>
          {targets.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {targetLabel(layer)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="lf-btn"
        disabled={target === undefined}
        title={`Move ${artwork} onto the chosen operation. Undo moves it back.`}
        onClick={move}
      >
        Move
      </button>
    </div>
  );
}

function targetLabel(layer: Layer): string {
  return layer.visible ? layer.name : `${layer.name} (hidden)`;
}
