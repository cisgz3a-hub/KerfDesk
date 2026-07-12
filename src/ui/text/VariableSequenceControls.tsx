import type { ProjectVariableData, VariableSequenceSettings } from '../../core/scene';
import { resolveVariableSequence } from '../../core/variables';
import { Button, NumberInput } from '../kit';
import type { useStore } from '../state';

type SetSettings = ReturnType<typeof useStore.getState>['setVariableSettings'];
type SequencePatch = Omit<Partial<VariableSequenceSettings>, 'serialEndValue'> & {
  readonly serialEndValue?: number | undefined;
};

export function VariableSequenceControls(props: {
  readonly variables: ProjectVariableData;
  readonly setSettings: SetSettings;
  readonly previous: () => void;
  readonly next: () => void;
  readonly reset: () => void;
}): JSX.Element {
  const sequence = resolveVariableSequence(props.variables);
  const recordCount = props.variables.csv?.records.length ?? 0;
  const setSequence = (patch: SequencePatch): void => {
    if ('serialEndValue' in patch && patch.serialEndValue === undefined) {
      const { serialEndValue: _currentEnd, ...withoutEnd } = sequence;
      const { serialEndValue: _patchEnd, ...remainingPatch } = patch;
      props.setSettings({ sequence: { ...withoutEnd, ...remainingPatch } });
      return;
    }
    props.setSettings({ sequence: { ...sequence, ...patch } as VariableSequenceSettings });
  };
  return (
    <fieldset style={fieldsetStyle} aria-label="Variable sequence range">
      <legend>Sequence</legend>
      <div style={fieldsStyle}>
        <SequenceNumber
          label="Record start"
          value={sequence.recordStartIndex + 1}
          min={1}
          max={Math.max(1, recordCount)}
          disabled={recordCount === 0}
          onChange={(value) =>
            setSequence({
              recordStartIndex: value - 1,
              recordEndIndex: Math.max(sequence.recordEndIndex, value - 1),
            })
          }
        />
        <SequenceNumber
          label="Record end"
          value={sequence.recordEndIndex + 1}
          min={sequence.recordStartIndex + 1}
          max={Math.max(1, recordCount)}
          disabled={recordCount === 0}
          onChange={(value) => setSequence({ recordEndIndex: value - 1 })}
        />
        <SequenceNumber
          label="Serial start"
          value={sequence.serialStartValue}
          min={0}
          onChange={(serialStartValue) =>
            setSequence({
              serialStartValue,
              ...(sequence.serialEndValue === undefined
                ? {}
                : { serialEndValue: Math.max(sequence.serialEndValue, serialStartValue) }),
            })
          }
        />
        <SerialEndControl sequence={sequence} setSequence={setSequence} />
        <SequenceNumber
          label="Advance by"
          value={sequence.advanceBy}
          min={1}
          onChange={(advanceBy) => setSequence({ advanceBy })}
        />
      </div>
      <div style={actionsStyle}>
        <Button onClick={props.previous}>Previous</Button>
        <Button onClick={props.reset}>Reset</Button>
        <Button onClick={props.next}>Next</Button>
      </div>
    </fieldset>
  );
}

function SerialEndControl(props: {
  readonly sequence: VariableSequenceSettings;
  readonly setSequence: (patch: SequencePatch) => void;
}): JSX.Element {
  const enabled = props.sequence.serialEndValue !== undefined;
  return (
    <div style={serialEndStyle}>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          aria-label="Wrap serial"
          checked={enabled}
          title="Wrap the serial number from End back to Start."
          onChange={(event) =>
            props.setSequence(
              event.currentTarget.checked
                ? {
                    serialEndValue: Math.max(
                      props.sequence.serialStartValue,
                      props.sequence.serialStartValue + props.sequence.advanceBy,
                    ),
                  }
                : { serialEndValue: undefined },
            )
          }
        />
        Wrap serial
      </label>
      {enabled ? (
        <SequenceNumber
          label="Serial end"
          value={props.sequence.serialEndValue ?? props.sequence.serialStartValue}
          min={props.sequence.serialStartValue}
          onChange={(serialEndValue) => props.setSequence({ serialEndValue })}
        />
      ) : null}
    </div>
  );
}

function SequenceNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span>{props.label}</span>
      <NumberInput
        aria-label={`Variable ${props.label.toLowerCase()}`}
        value={props.value}
        min={props.min}
        {...(props.max === undefined ? {} : { max: props.max })}
        step={1}
        disabled={props.disabled}
        onChange={(event) => {
          const next = Number.isFinite(event.currentTarget.valueAsNumber)
            ? Math.floor(event.currentTarget.valueAsNumber)
            : props.value;
          props.onChange(Math.min(props.max ?? Number.MAX_SAFE_INTEGER, Math.max(props.min, next)));
        }}
      />
    </label>
  );
}

const fieldsetStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'grid',
  gap: 6,
  minWidth: 0,
  margin: 0,
  padding: 8,
  border: '1px solid var(--lf-border)',
};
const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 72px',
  alignItems: 'center',
  gap: 4,
};
const serialEndStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
