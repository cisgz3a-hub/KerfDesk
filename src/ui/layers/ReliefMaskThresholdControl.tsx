import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { NumberInput } from '../kit';
import { useStore } from '../state';
import {
  MAX_RELIEF_MASK_THRESHOLD,
  MIN_RELIEF_MASK_THRESHOLD,
  parseReliefMaskThreshold,
} from './relief-mask-threshold';
import { useDebouncedCommit } from './use-debounced-commit';

/** Edits the exact mask byte threshold used by a canonical masked heightfield. */
export function ReliefMaskThresholdControl(props: {
  readonly relief: HeightfieldReliefObject;
}): JSX.Element | null {
  const setReliefParams = useStore((state) => state.setReliefParams);
  const reliefSource = props.relief.reliefSource;
  const threshold = reliefSource.mapping.inclusionThreshold;
  const debounced = useDebouncedCommit<number>({
    value: threshold,
    commit: (inclusionThreshold) => setReliefParams(props.relief.id, { inclusionThreshold }),
    parse: (input) => parseReliefMaskThreshold(input, threshold),
  });
  if (reliefSource.inclusionMask === undefined) return null;
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Mask threshold</span>
      <span style={controlStyle}>
        <span style={inputRowStyle}>
          <NumberInput
            min={MIN_RELIEF_MASK_THRESHOLD}
            max={MAX_RELIEF_MASK_THRESHOLD}
            step={1}
            value={debounced.displayValue}
            onChange={debounced.onChange}
            onBlur={debounced.onBlur}
            aria-label="Relief mask threshold"
            title="Exact mask byte threshold (1–255)."
            style={inputStyle}
          />
          <span style={unitStyle}>byte</span>
        </span>
        <span style={explanationStyle}>
          Mask bytes at or above {threshold} use mapped depth; lower bytes use the selected outside
          meaning.
        </span>
      </span>
    </label>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const inputRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
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
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  lineHeight: 1.25,
};
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
