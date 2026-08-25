import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';

type OutsideMaskMeaning = HeightfieldReliefObject['reliefSource']['mapping']['outsideMask'];

/** Shows how below-threshold mask bytes materialize for a canonical masked heightfield. */
export function ReliefMaskOutsideMeaningControl(props: {
  readonly relief: HeightfieldReliefObject;
}): JSX.Element | null {
  const setReliefParams = useStore((state) => state.setReliefParams);
  if (props.relief.reliefSource.inclusionMask === undefined) return null;
  const threshold = props.relief.reliefSource.mapping.inclusionThreshold;
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Mask below {threshold}</span>
      <span style={controlStyle}>
        <select
          value={props.relief.reliefSource.mapping.outsideMask}
          onChange={(event) => {
            const outsideMask = parseOutsideMaskMeaning(event.currentTarget.value);
            if (outsideMask !== null) setReliefParams(props.relief.id, { outsideMask });
          }}
          aria-label="Relief outside-mask meaning"
          title={`Mask bytes at or above ${threshold} use mapped depth; lower bytes use the selected meaning.`}
          style={selectStyle}
        >
          <option value="excluded">Excluded from carving</option>
          <option value="stock-top">Keep at stock top</option>
          <option value="relief-floor">Carve to relief floor</option>
        </select>
        <span style={thresholdStyle}>
          Stored mask threshold: {threshold} (read-only here). Bytes at or above {threshold} use
          mapped depth; lower bytes use this meaning.
        </span>
      </span>
    </label>
  );
}

function parseOutsideMaskMeaning(value: string): OutsideMaskMeaning | null {
  if (value === 'excluded' || value === 'stock-top' || value === 'relief-floor') return value;
  return null;
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
const thresholdStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  lineHeight: 1.25,
};
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
