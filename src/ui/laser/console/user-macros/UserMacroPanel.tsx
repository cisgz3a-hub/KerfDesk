import type { UserMacro } from './user-macro-collection';
import { useUserMacroPanelModel, type MacroEditor } from './use-user-macro-panel-model';

export function UserMacroPanel(props: {
  readonly isSending: boolean;
  readonly isInputDisabled: boolean;
  readonly onRun: (command: string, macro: UserMacro) => Promise<void>;
}): JSX.Element {
  const model = useUserMacroPanelModel(props.onRun);

  return (
    <details style={panelStyle}>
      <summary title="Show or hide saved user macros." style={summaryStyle}>
        User macros ({model.macros.length})
      </summary>
      <div style={bodyStyle}>
        <div style={provenanceStyle}>User-saved / local / one Console command</div>
        <MacroSelector
          macros={model.macros}
          selectedName={model.selected?.name ?? ''}
          onSelect={model.select}
          onNew={model.beginNew}
          onEdit={model.beginEdit}
          onDelete={model.removeSelected}
        />
        {model.editor === null ? null : (
          <MacroEditorForm
            editor={model.editor}
            onChange={model.setEditor}
            onSave={model.saveEditor}
            onCancel={model.cancelEditor}
          />
        )}
        {model.editor !== null || model.selected === null ? null : (
          <MacroRunner
            macro={model.selected}
            variables={model.variables}
            values={model.values}
            preview={model.expansion?.kind === 'ok' ? model.expansion.command : null}
            isSending={props.isSending}
            isInputDisabled={props.isInputDisabled}
            onValue={model.setValue}
            onRun={model.runSelected}
          />
        )}
        {model.error === null ? null : (
          <div role="alert" style={errorStyle}>
            {model.error}
          </div>
        )}
      </div>
    </details>
  );
}

function MacroSelector(props: {
  readonly macros: ReadonlyArray<UserMacro>;
  readonly selectedName: string;
  readonly onSelect: (name: string) => void;
  readonly onNew: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const hasSelection = props.selectedName !== '';
  return (
    <div style={rowStyle}>
      <select
        aria-label="Saved user macro"
        title="Choose a saved user macro."
        value={props.selectedName}
        disabled={props.macros.length === 0}
        onChange={(event) => props.onSelect(event.target.value)}
        style={growStyle}
      >
        {props.macros.length === 0 ? <option value="">No user macros saved</option> : null}
        {props.macros.map((macro) => (
          <option key={macro.name} value={macro.name}>
            {macro.name}
          </option>
        ))}
      </select>
      <button type="button" title="Create a new single-command user macro." onClick={props.onNew}>
        New macro
      </button>
      <button
        type="button"
        title="Edit the selected user macro."
        disabled={!hasSelection}
        onClick={props.onEdit}
      >
        Edit
      </button>
      <button
        type="button"
        title="Delete the selected user macro from this browser."
        disabled={!hasSelection}
        onClick={props.onDelete}
      >
        Delete
      </button>
    </div>
  );
}

function MacroEditorForm(props: {
  readonly editor: MacroEditor;
  readonly onChange: (editor: MacroEditor) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const update = (patch: Partial<Pick<MacroEditor, 'name' | 'template'>>): void =>
    props.onChange({ ...props.editor, ...patch });
  return (
    <div role="group" style={editorStyle} aria-label="User macro editor">
      <input
        aria-label="Macro name"
        title="Enter the local name shown for this user macro."
        value={props.editor.name}
        placeholder="Macro name"
        onChange={(event) => update({ name: event.target.value })}
      />
      <input
        aria-label="Macro command template"
        title="Enter one Console command; use double braces for numeric variables."
        value={props.editor.template}
        placeholder="G0 X{{x}} Y{{y}}"
        spellCheck={false}
        onChange={(event) => update({ template: event.target.value })}
      />
      <div style={rowStyle}>
        <button
          type="button"
          title="Validate and save this user macro locally."
          onClick={props.onSave}
        >
          Save macro
        </button>
        <button type="button" title="Discard these unsaved macro edits." onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MacroRunner(props: {
  readonly macro: UserMacro;
  readonly variables: ReadonlyArray<string>;
  readonly values: Readonly<Record<string, string>>;
  readonly preview: string | null;
  readonly isSending: boolean;
  readonly isInputDisabled: boolean;
  readonly onValue: (variable: string, value: string) => void;
  readonly onRun: () => void;
}): JSX.Element {
  return (
    <div role="group" style={runnerStyle} aria-label={`Run user macro ${props.macro.name}`}>
      {props.variables.map((variable) => (
        <label key={variable} style={variableStyle}>
          <span>{`{{${variable}}}`}</span>
          <input
            aria-label={`Macro variable ${variable}`}
            title={`Enter a finite decimal value for {{${variable}}}.`}
            inputMode="decimal"
            autoComplete="off"
            value={macroVariableValue(props.values, variable)}
            onChange={(event) => props.onValue(variable, event.target.value)}
          />
        </label>
      ))}
      <div style={previewStyle}>
        Expanded command:{' '}
        {props.preview === null ? (
          <span>Enter valid decimal values.</span>
        ) : (
          <code aria-label="Expanded macro command">{props.preview}</code>
        )}
      </div>
      <button
        type="button"
        disabled={props.isSending || props.isInputDisabled}
        title="Expand and send this one command through the existing Console path."
        onClick={props.onRun}
      >
        {props.isSending ? 'Sending...' : 'Run user macro'}
      </button>
    </div>
  );
}

function macroVariableValue(values: Readonly<Record<string, string>>, variable: string): string {
  return Object.prototype.hasOwnProperty.call(values, variable) ? (values[variable] ?? '') : '';
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
};
const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  padding: '4px 6px',
  fontWeight: 600,
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '2px 6px 6px',
};
const provenanceStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4 };
const growStyle: React.CSSProperties = { flex: 1, minWidth: 140 };
const editorStyle: React.CSSProperties = { display: 'grid', gap: 5 };
const runnerStyle: React.CSSProperties = { display: 'grid', gap: 5 };
const variableStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(80px, auto) 1fr',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'ui-monospace, Menlo, monospace',
};
const previewStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  overflowWrap: 'anywhere',
};
const errorStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontSize: 12,
  overflowWrap: 'anywhere',
};
