import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { NumberInput } from '../kit';
import { useStore } from '../state';
import { MAX_RELIEF_INPUT_CODE, parseReliefInputCode } from './relief-input-code';
import { useDebouncedCommit } from './use-debounced-commit';

/** Edits the exact U16 input-level codes used by a canonical relief heightfield. */
export function ReliefInputLevelsControl(props: {
  readonly relief: HeightfieldReliefObject;
}): JSX.Element {
  const setReliefParams = useStore((state) => state.setReliefParams);
  const mapping = props.relief.reliefSource.mapping;
  return (
    <div role="group" aria-label="Relief input levels" style={groupStyle}>
      <ReliefInputCodeField
        label="Input low"
        value={mapping.inputLowCode}
        onCommit={(inputLowCode) => setReliefParams(props.relief.id, { inputLowCode })}
      />
      <ReliefInputCodeField
        label="Input high"
        value={mapping.inputHighCode}
        onCommit={(inputHighCode) => setReliefParams(props.relief.id, { inputHighCode })}
      />
      <span style={explanationStyle}>
        {
          'Source codes are 0–65535. Low < high clips outside the endpoints and redistributes the range. Crossed endpoints reverse the response and are valid. Equal endpoints produce a flat normalized 0.5 before gamma and polarity.'
        }
      </span>
    </div>
  );
}

function ReliefInputCodeField(props: {
  readonly label: 'Input low' | 'Input high';
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (input) => parseReliefInputCode(input, props.value),
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>
        <NumberInput
          min={0}
          max={MAX_RELIEF_INPUT_CODE}
          step={1}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label={`Relief ${props.label.toLowerCase()} source code`}
          title="Exact unsigned 16-bit source code (0–65535). Endpoints may be ordered, crossed, or equal."
          style={inputStyle}
        />
        <span style={unitStyle}>code</span>
      </span>
    </label>
  );
}

const groupStyle: React.CSSProperties = { margin: 0, padding: 0 };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const explanationStyle: React.CSSProperties = {
  display: 'block',
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  lineHeight: 1.25,
  margin: '-2px 0 6px 100px',
};
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
