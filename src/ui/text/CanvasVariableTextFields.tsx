import { useToastStore } from '../state/toast-store';
import { VariableTextControls } from './VariableTextControls';
import type { CanvasTextVariables } from './use-canvas-text-variables';
import type { DialogFields } from './use-text-dialog-fields';

export function CanvasVariableTextFields(props: {
  readonly fields: DialogFields;
  readonly variables: CanvasTextVariables;
  readonly onInsert: (text: string) => void;
}): JSX.Element {
  const pushToast = useToastStore((state) => state.pushToast);
  const { fields, variables } = props;
  return (
    <section aria-label="Variable text" style={sectionStyle}>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={fields.variableEnabled}
          title="Evaluate typed fields when previewing, framing, exporting, or starting this job."
          onChange={(event) => fields.setVariableEnabled(event.currentTarget.checked)}
        />
        Variable text
      </label>
      {fields.variableEnabled ? (
        <>
          <VariableTextControls
            variables={variables.variables}
            firstColumn={variables.variables.csv?.headers[0]}
            onInsert={props.onInsert}
            setCsv={variables.setCsv}
            setSettings={variables.setSettings}
            advance={variables.advance}
            retreat={variables.retreat}
            reset={variables.reset}
            pushToast={pushToast}
          />
          <p className="lf-canvas-text-help" style={hintStyle}>
            Variable data is saved with this text. Cancel discards these changes.
          </p>
        </>
      ) : null}
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const hintStyle: React.CSSProperties = { padding: 0 };
