import { useState } from 'react';
import type { Layer } from '../../core/scene';
import { Icon } from '../kit';
import { useStore } from '../state';

export function OperationContextActions(props: {
  readonly affected: number;
  readonly selectedUsingActive: number;
  readonly overrideEditing: boolean;
  readonly onMakeUnique: () => void;
  readonly onAdd: () => void;
}): JSX.Element {
  const shared = props.affected > props.selectedUsingActive;
  return (
    <div className="lf-operation-context">
      <p className="lf-artwork-hint">
        {props.overrideEditing
          ? `Editing settings for ${props.selectedUsingActive} artwork${props.selectedUsingActive === 1 ? '' : 's'}.`
          : `Affects ${props.affected} artwork${props.affected === 1 ? '' : 's'}.`}
        {shared && !props.overrideEditing ? ' Shared edits apply to all of them.' : null}
      </p>
      <div className="lf-operation-context__actions">
        {shared ? (
          <button
            type="button"
            className="lf-btn"
            title="Give only this artwork a copy of the operation so it can be edited independently"
            onClick={props.onMakeUnique}
          >
            Make unique
          </button>
        ) : null}
        <button
          type="button"
          className="lf-btn lf-btn--ghost"
          title="Add another operation to this artwork, then edit its settings"
          onClick={props.onAdd}
        >
          <Icon name="plus" size={14} />
          Add operation
        </button>
      </div>
    </div>
  );
}

export function OperationToggles({
  operation,
  affected,
}: {
  readonly operation: Layer;
  readonly affected: number;
}): JSX.Element {
  const setLayerParam = useStore((state) => state.setLayerParam);
  return (
    <div className="lf-operation-output">
      {affected > 1 ? (
        <p className="lf-artwork-hint">
          Visibility and output apply to all {affected} artworks using this operation.
        </p>
      ) : null}
      <div className="lf-operation-output__toggles">
        <label title="Show or hide this operation on the workspace">
          <input
            type="checkbox"
            checked={operation.visible}
            aria-label={`Show ${operation.name}`}
            onChange={(event) => setLayerParam(operation.id, { visible: event.target.checked })}
          />
          Show on canvas
        </label>
        <label title="Include this operation in preview and machine output">
          <input
            type="checkbox"
            checked={operation.output}
            aria-label={`Output ${operation.name}`}
            onChange={(event) => setLayerParam(operation.id, { output: event.target.checked })}
          />
          Include in output
        </label>
      </div>
      {!operation.output ? (
        <p className="lf-artwork-hint" role="status">
          This operation is excluded from output. Turn on Include in output to use it in the job.
        </p>
      ) : null}
    </div>
  );
}

// Rejected blank names must snap back to the stored name on every blur.
export function OperationNameInput(props: {
  readonly operationId: string;
  readonly name: string;
  readonly onRename: (operationId: string, name: string) => void;
}): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  return (
    <input
      key={`${props.operationId}:${props.name}:${attempt}`}
      defaultValue={props.name}
      aria-label="Operation name"
      title="Give this operation a useful name, such as Engrave lettering or Cut outline"
      onBlur={(event) => {
        const typed = event.currentTarget.value;
        setAttempt((value) => value + 1);
        props.onRename(props.operationId, typed);
      }}
    />
  );
}

export function OperationSelect(props: {
  readonly operations: ReadonlyArray<Layer>;
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  return (
    <label className="lf-operation-chooser">
      <span>Operation to edit</span>
      <select
        aria-label="Operation to inspect"
        title="Choose which operation settings to edit for this artwork"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.operations.map((operation, index) => (
          <option key={operation.id} value={operation.id}>
            {index + 1}. {operation.name}
          </option>
        ))}
      </select>
    </label>
  );
}
