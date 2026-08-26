// CncLayerPrimitives — the shared row + labelled-number-input controls and
// styles used across the CNC layer card (CncLayerFields and CncLayerAdvancedFields).
// Extracted so those field groups stay under the file-size cap
// and share one visual language.

import type { Layer } from '../../core/scene';
import { useDebouncedCommit } from './use-debounced-commit';

export function Row(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      {props.label.length > 0 ? <span style={labelStyle}>{props.label}</span> : null}
      <div style={valueStyle}>{props.children}</div>
    </div>
  );
}

type NumberFieldRange =
  | { readonly positiveOnly: true; readonly min?: never; readonly max?: never }
  | { readonly positiveOnly?: false; readonly min: number; readonly max: number };

type NumberFieldProps = {
  readonly layer: Layer;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly step: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
} & NumberFieldRange;

export function NumberField(props: NumberFieldProps): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return props.value;
      if (props.positiveOnly === true) return n > 0 ? n : props.value;
      return Math.max(props.min, Math.min(props.max, n));
    },
  });
  return (
    <Row label={props.label}>
      <input
        type="number"
        {...(props.positiveOnly === true ? {} : { min: props.min, max: props.max })}
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

// Layout only — paint (borders, padding, font size) comes from the
// .lf-pane-form scope in tokens.css so every rail control matches.
export const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
export const labelStyle: React.CSSProperties = {
  flex: '0 0 100px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
// 120px basis: 100px label + 8px gap + 120px value fits the 300px rail even
// with its scrollbar, so rows keep label-left instead of wrapping to stacked.
export const valueStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 120px',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};
export const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};
// 84px: leaves room for the longest unit (mm/min) beside the input in the
// 300px rail, so units never wrap under their field.
export const inputStyle: React.CSSProperties = {
  width: 84,
  boxSizing: 'border-box',
};
export const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
