// CncLayerPrimitives — the shared row + labelled-number-input controls and
// styles used across the CNC layer card (CncLayerFields, CncLayerAdvancedFields,
// CncMaterialRow). Extracted so those field groups stay under the file-size cap
// and share one visual language.

import type { Layer } from '../../core/scene';
import { useDebouncedCommit } from './use-debounced-commit';

export function Row(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <div style={valueStyle}>{props.children}</div>
    </div>
  );
}

export function NumberField(props: {
  readonly layer: Layer;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return props.value;
      return Math.max(props.min, Math.min(props.max, n));
    },
  });
  return (
    <Row label={props.label}>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`${props.label} for ${props.layer.color}`}
        title={props.title}
      />
      {props.unit.length > 0 ? <span style={unitStyle}>{props.unit}</span> : null}
    </Row>
  );
}

export const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
export const labelStyle: React.CSSProperties = {
  width: 96,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
export const valueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
};
export const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: '2px 4px',
};
export const inputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
export const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
