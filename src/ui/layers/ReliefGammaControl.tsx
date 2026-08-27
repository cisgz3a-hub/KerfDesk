import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { NumberInput } from '../kit';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

/** Exposes the persisted positive-finite gamma curve without imposing a policy range. */
export function ReliefGammaControl(props: {
  readonly relief: HeightfieldReliefObject;
}): JSX.Element {
  const setReliefParams = useStore((state) => state.setReliefParams);
  const gamma = props.relief.reliefSource.mapping.curve.gamma;
  const debounced = useDebouncedCommit<number>({
    value: gamma,
    commit: (nextGamma) => setReliefParams(props.relief.id, { gamma: nextGamma }),
    parse: (input) => positiveFiniteOr(input, gamma),
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Gamma</span>
      <span style={controlStyle}>
        <NumberInput
          step="any"
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label="Relief gamma"
          title="Positive finite exponent applied to normalized source samples before polarity. Gamma 1 is linear; values are not capped or clamped."
          style={inputStyle}
        />
        <span style={unitStyle}>1 = linear</span>
      </span>
    </label>
  );
}

function positiveFiniteOr(input: string, fallback: number): number {
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
const unitStyle: React.CSSProperties = {
  minWidth: 58,
  fontSize: 11,
  color: 'var(--lf-text-faint)',
};
