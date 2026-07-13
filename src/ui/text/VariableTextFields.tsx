import { useRef } from 'react';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { VariableTextControls } from './VariableTextControls';

export function VariableTextFields(props: {
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onInsert: (source: string) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const variables = useStore((state) => state.project.variables) ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const setCsv = useStore((state) => state.setVariableCsv);
  const setSettings = useStore((state) => state.setVariableSettings);
  const advance = useStore((state) => state.advanceVariablesManually);
  const retreat = useStore((state) => state.retreatVariablesManually);
  const reset = useStore((state) => state.resetVariablesManually);
  const pushToast = useToastStore((state) => state.pushToast);
  const firstColumn = variables.csv?.headers[0];
  return (
    <section aria-label="Variable text" style={sectionStyle}>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={props.enabled}
          title="Evaluate typed fields when previewing, framing, exporting, or starting this job."
          onChange={(event) => props.onEnabledChange(event.currentTarget.checked)}
        />
        Variable text
      </label>
      {props.enabled ? (
        <VariableTextControls
          variables={variables}
          inputRef={inputRef}
          firstColumn={firstColumn}
          onInsert={props.onInsert}
          setCsv={setCsv}
          setSettings={setSettings}
          advance={advance}
          retreat={retreat}
          reset={reset}
          pushToast={pushToast}
        />
      ) : null}
    </section>
  );
}

const sectionStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
