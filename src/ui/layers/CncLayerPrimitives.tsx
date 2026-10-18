// CncLayerPrimitives — the shared row + labelled-number-input controls and
// styles used across the CNC layer card (CncLayerFields and CncLayerAdvancedFields).
// Extracted so those field groups stay under the file-size cap
// and share one visual language.

import type { Layer } from '../../core/scene';
import { useDebouncedCommit } from './use-debounced-commit';
import { useLengthUnit } from '../state/display-units';
import { MM_PER_INCH, type DisplayLengthUnit } from '../display-length';

export function Row(props: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly stacked?: boolean;
  /** Stacked rows name the unit beside the label, so every box fills its column. */
  readonly unit?: string;
}): JSX.Element {
  return (
    <div className="lf-cnc-setting-row" style={props.stacked ? stackedRowStyle : rowStyle}>
      {props.label.length > 0 ? (
        <span style={props.stacked ? stackedLabelStyle : labelStyle}>
          {props.label}
          {props.unit ? <small style={stackedUnitStyle}>{props.unit}</small> : null}
        </span>
      ) : null}
      <div className="lf-cnc-setting-value" style={props.stacked ? stackedValueStyle : valueStyle}>
        {props.children}
      </div>
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
  readonly stacked?: boolean;
  /** Spoken name when the visible label is a short form of it ("Spindle" for Spindle speed). */
  readonly ariaName?: string;
  /** A millimetre length or mm/min feed that follows the display unit (ADR-629). */
  readonly dimension?: 'length' | 'feed';
} & NumberFieldRange;

// How a mm or mm/min value shows in the operator's unit. The saved value stays
// in millimetres, and the debounced draft commits only an edited value, so
// rounding the inch display never writes back.
type FieldDisplay = {
  readonly scale: number;
  readonly unit: string;
  readonly step: number;
  readonly show: (value: number) => number;
};

function fieldDisplay(props: NumberFieldProps, unit: DisplayLengthUnit): FieldDisplay {
  if (props.dimension === undefined || unit === 'mm') {
    return { scale: 1, unit: props.unit, step: props.step, show: (value) => value };
  }
  const feed = props.dimension === 'feed';
  const decimals = feed ? 1 : 4;
  return {
    scale: MM_PER_INCH,
    unit: feed ? 'in/min' : 'in',
    step: feed ? 1 : 0.01,
    show: (value) => Number((value / MM_PER_INCH).toFixed(decimals)),
  };
}

function clampToRange(props: NumberFieldProps, value: number): number {
  if (props.positiveOnly === true) return value;
  return Math.max(props.min, Math.min(props.max, value));
}

export function NumberField(props: NumberFieldProps): JSX.Element {
  const display = fieldDisplay(props, useLengthUnit());
  const shown = display.show(props.value);
  const debounced = useDebouncedCommit<number>({
    value: shown,
    commit: (value) =>
      props.onCommit(display.scale === 1 ? value : clampToRange(props, value * display.scale)),
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return shown;
      if (props.positiveOnly === true) return n > 0 ? n : shown;
      return Math.max(props.min / display.scale, Math.min(props.max / display.scale, n));
    },
  });
  const unitBesideBox = props.stacked !== true && display.unit.length > 0;
  return (
    <Row label={props.label} {...(props.stacked ? { stacked: true, unit: display.unit } : {})}>
      <input
        type="number"
        {...(props.positiveOnly === true
          ? {}
          : { min: props.min / display.scale, max: props.max / display.scale })}
        step={display.step}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={props.stacked ? { ...inputStyle, flex: 1, minWidth: 0 } : inputStyle}
        aria-label={`${props.ariaName ?? props.label} for ${props.layer.color}`}
        title={props.title}
      />
      {unitBesideBox ? <span style={unitStyle}>{display.unit}</span> : null}
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

const stackedRowStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
  alignContent: 'start',
};
// Like the laser Power % / Speed mm/min labels: a unit that does not fit
// beside its name drops to the next line instead of squeezing the box.
const stackedLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: 4,
  fontSize: 13,
  color: 'var(--lf-text)',
};
const stackedUnitStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: 'var(--lf-text-muted)',
};
const stackedValueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
};
