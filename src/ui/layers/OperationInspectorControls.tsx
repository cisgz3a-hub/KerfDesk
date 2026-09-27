import { useState } from 'react';
import type { Layer } from '../../core/scene';
import { Icon } from '../kit';
import { useStore } from '../state';

// One line under the operation's name says who an edit reaches, and only when
// that is not just this artwork (ADR-430). Make unique sits beside the reason
// to use it.
export function OperationScope(props: {
  readonly affected: number;
  readonly selectedUsingActive: number;
  readonly overrideEditing: boolean;
  readonly mixed: boolean;
  readonly onMakeUnique: () => void;
}): JSX.Element | null {
  const message = scopeMessage(props);
  const others = props.affected > props.selectedUsingActive;
  if (message === null && !others) return null;
  return (
    <div className="lf-operation-scope">
      {message === null ? null : <p className="lf-artwork-hint">{message}</p>}
      {others ? (
        <button
          type="button"
          className="lf-btn"
          title="Give only this artwork a copy of the operation so it can be edited independently"
          onClick={props.onMakeUnique}
        >
          Make unique
        </button>
      ) : null}
    </div>
  );
}

function scopeMessage(props: {
  readonly affected: number;
  readonly selectedUsingActive: number;
  readonly overrideEditing: boolean;
  readonly mixed: boolean;
}): string | null {
  if (props.overrideEditing) {
    if (props.mixed) return null;
    return props.selectedUsingActive === 1
      ? 'This artwork has its own settings. The values shown here are used for its output.'
      : `These ${props.selectedUsingActive} artworks have their own settings. The values shown here are used for their output.`;
  }
  return props.affected > 1
    ? `Shared by ${props.affected} artworks. Edits apply to all of them.`
    : null;
}

export function OperationFooter(props: {
  readonly operation: Layer;
  readonly affected: number;
  readonly overrideEditing: boolean;
  readonly onAdd: () => void;
}): JSX.Element {
  const { operation } = props;
  const setLayerParam = useStore((state) => state.setLayerParam);
  return (
    <div className="lf-operation-output">
      <div className="lf-operation-output__toggles">
        <label title="Include artwork using this operation in preview and machine output">
          <input
            type="checkbox"
            checked={operation.output}
            aria-label={`Output ${operation.name}`}
            title="Include artwork using this operation in preview and machine output"
            onChange={(event) => setLayerParam(operation.id, { output: event.target.checked })}
          />
          Include in output
        </label>
        <label title="Show or hide artwork using this operation on the workspace">
          <input
            type="checkbox"
            checked={operation.visible}
            aria-label={`Show ${operation.name}`}
            title="Show or hide artwork using this operation on the workspace"
            onChange={(event) => setLayerParam(operation.id, { visible: event.target.checked })}
          />
          Show on canvas
        </label>
      </div>
      {props.overrideEditing && props.affected > 1 ? (
        <p className="lf-artwork-hint">
          Output and visibility apply to all {props.affected} artworks using this operation.
        </p>
      ) : null}
      {!operation.output ? (
        <p className="lf-artwork-hint" role="status">
          This operation is excluded from output. Turn on Include in output to use it in the job.
        </p>
      ) : null}
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-operation-add"
        title="Add another operation to this artwork, then edit its settings"
        onClick={props.onAdd}
      >
        <Icon name="plus" size={14} />
        Add operation
      </button>
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
