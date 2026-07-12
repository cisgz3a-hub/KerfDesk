import type {
  ProjectVariableData,
  VariableAdvancementPolicy,
  VariableCsvDataset,
} from '../../core/scene';
import { parseVariableCsv } from '../../core/variables';
import { Button, NumberInput } from '../kit';
import type { useStore } from '../state';
import type { useToastStore } from '../state/toast-store';

type ControlsProps = {
  readonly variables: ProjectVariableData;
  readonly inputRef: React.RefObject<HTMLInputElement>;
  readonly firstColumn: string | undefined;
  readonly onInsert: (source: string) => void;
  readonly setCsv: (csv: VariableCsvDataset | undefined) => void;
  readonly setSettings: ReturnType<typeof useStore.getState>['setVariableSettings'];
  readonly advance: () => void;
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
};

export function VariableTextControls(props: ControlsProps): JSX.Element {
  return (
    <>
      <div style={buttonStyle} aria-label="Insert variable field">
        {FIELD_BUTTONS.map((field) => (
          <Insert key={field.source} {...field} insert={props.onInsert} />
        ))}
        {props.firstColumn === undefined ? null : (
          <Insert
            label={`CSV: ${props.firstColumn}`}
            source={`{{csv:${props.firstColumn}}}`}
            insert={props.onInsert}
          />
        )}
      </div>
      <div style={settingsStyle}>
        <CsvInput {...props} />
        <Counter
          label="Record"
          value={props.variables.recordIndex + 1}
          onChange={(value) => props.setSettings({ recordIndex: Math.max(0, value - 1) })}
        />
        <Counter
          label="Serial"
          value={props.variables.serialValue}
          onChange={(serialValue) => props.setSettings({ serialValue })}
        />
        <Advancement value={props.variables.advancement} setSettings={props.setSettings} />
        <Button onClick={props.advance}>Next record</Button>
      </div>
    </>
  );
}

function CsvInput(props: ControlsProps): JSX.Element {
  return (
    <>
      <Button onClick={() => props.inputRef.current?.click()}>Import CSV...</Button>
      <input
        ref={props.inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        title="Choose a CSV file to embed in this project."
        aria-label="Import variable CSV"
        onChange={(event) => void importCsvFile(event.currentTarget, props)}
      />
    </>
  );
}

async function importCsvFile(input: HTMLInputElement, props: ControlsProps): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) return;
  const result = parseVariableCsv(file.name, await file.text());
  if (!result.ok) {
    props.pushToast(`${result.message} Row ${result.row}, column ${result.column}.`, 'error');
    return;
  }
  props.setCsv(result.dataset);
  props.pushToast(`Embedded ${result.dataset.records.length} CSV record(s).`, 'success');
}

function Advancement(props: {
  readonly value: VariableAdvancementPolicy;
  readonly setSettings: ControlsProps['setSettings'];
}): JSX.Element {
  return (
    <select
      aria-label="Variable advancement"
      title="Choose when the record and serial advance."
      value={props.value}
      onChange={(event) =>
        props.setSettings({ advancement: event.currentTarget.value as VariableAdvancementPolicy })
      }
    >
      <option value="manual">Manual</option>
      <option value="after-successful-stream">After completed job</option>
      <option value="after-successful-export">After successful export</option>
    </select>
  );
}

function Insert(props: {
  readonly label: string;
  readonly source: string;
  readonly insert: (source: string) => void;
}): JSX.Element {
  return (
    <Button
      title={`Insert ${props.label.toLowerCase()} field.`}
      onClick={() => props.insert(props.source)}
    >
      {props.label}
    </Button>
  );
}

function Counter(props: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={counterStyle}>
      <span>{props.label}</span>
      <NumberInput
        aria-label={`Variable ${props.label.toLowerCase()}`}
        min={1}
        step={1}
        value={props.value}
        onChange={(event) =>
          props.onChange(Math.max(1, Math.floor(event.currentTarget.valueAsNumber)))
        }
      />
    </label>
  );
}

const FIELD_BUTTONS = [
  { label: 'Date', source: '{{date}}' },
  { label: 'Time', source: '{{time}}' },
  { label: 'Serial', source: '{{serial:4}}' },
  { label: 'Power', source: '{{power}}' },
  { label: 'Speed', source: '{{speed}}' },
  { label: 'Passes', source: '{{passes}}' },
] as const;
const buttonStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4 };
const settingsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
};
const counterStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 72px',
  gap: 4,
};
