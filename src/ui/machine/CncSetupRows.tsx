// CncSetupRows — the row grammar for the Material & Bit card: label ·
// control · unit on the rail's standard 100px label column. Extracted from
// CncSetupPanel when the redesign added grouped subheads and paired X/Y rows
// (the panel would otherwise cross the file-size caps). Paint styling comes
// from the .lf-pane-form scope in tokens.css; only layout stays inline.

import { useDebouncedCommit } from '../layers/use-debounced-commit';

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

/** One numeric input: `label` is the aria-label (and row label in NumberRow). */
export type SetupNumberSpec = {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
};

export function NumberRow(props: SetupNumberSpec & { readonly unit: string }): JSX.Element {
  return (
    <Row label={props.label}>
      <SetupNumberInput spec={props} />
      <span style={unitStyle}>{props.unit}</span>
    </Row>
  );
}

// Two related numbers on one row (stock W×H, origin X/Y, park X/Y): halves
// the machine card's row count while each input keeps its own aria-label and
// tooltip, so screen readers and the layout tests see the same fields. The
// unit moves into the row label — "Stock origin (mm)" — because the 300px
// rail's value column cannot hold two inputs, two prefixes, AND a unit.
export function NumberPairRow(props: {
  readonly label: string;
  readonly unit: string;
  readonly prefixes: readonly [string, string];
  readonly first: SetupNumberSpec;
  readonly second: SetupNumberSpec;
}): JSX.Element {
  return (
    <Row label={`${props.label} (${props.unit})`}>
      <span style={unitStyle}>{props.prefixes[0]}</span>
      <SetupNumberInput spec={props.first} compact />
      <span style={unitStyle}>{props.prefixes[1]}</span>
      <SetupNumberInput spec={props.second} compact />
    </Row>
  );
}

function SetupNumberInput(props: {
  readonly spec: SetupNumberSpec;
  readonly compact?: boolean;
}): JSX.Element {
  const { spec } = props;
  const debounced = useDebouncedCommit<number>({
    value: spec.value,
    commit: spec.onCommit,
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return spec.value;
      return Math.max(spec.min, Math.min(spec.max, n));
    },
  });
  return (
    <input
      type="number"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={props.compact === true ? pairInputStyle : inputStyle}
      aria-label={spec.label}
      title={spec.title}
    />
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = {
  width: 100,
  flexShrink: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
// min-width: 0 lets the value column shrink below its content's intrinsic
// width — without it a long <select> option (e.g. a full bit name) forces the
// column wider than the rail and the panel's overflow:hidden clips the box's
// right edge instead of the select truncating in place.
const valueStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  flex: 1,
  minWidth: 0,
};
// A solo input sits at the 84px numeric-field standard.
const inputStyle: React.CSSProperties = {
  width: 84,
  boxSizing: 'border-box',
};
// Paired inputs share the value column: the 48px basis fits two inputs plus
// their X/Y prefixes on the 300px rail's ~127px column, growing evenly with
// spare width; anything narrower wraps instead of crushing.
const pairInputStyle: React.CSSProperties = {
  flex: '1 1 48px',
  minWidth: 48,
  boxSizing: 'border-box',
};
export const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
