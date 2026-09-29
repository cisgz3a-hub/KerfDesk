import { useEffect, useRef } from 'react';

/** A control that can hand its choice to the engine (ADR-434 Amendment 1):
 *  while Auto is ticked the value checkbox is indeterminate and disabled. */
export type TraceAutoChoice = {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
};

export function TraceCheckboxRow(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
  readonly auto?: TraceAutoChoice;
}): JSX.Element {
  const auto = props.auto?.checked === true;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current !== null) input.current.indeterminate = auto;
  }, [auto]);
  const row = (
    <label style={checkboxRowStyle}>
      <input
        ref={input}
        type="checkbox"
        aria-label={props.label}
        checked={!auto && props.checked}
        disabled={props.disabled === true || auto}
        title={traceCheckboxTitle(props.label)}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
  if (props.auto === undefined) return row;
  return (
    <div style={autoRowStyle}>
      {row}
      <TraceAutoCheckbox label={props.label} auto={props.auto} />
    </div>
  );
}

export function TraceAutoCheckbox(props: {
  readonly label: string;
  readonly auto: TraceAutoChoice;
}): JSX.Element {
  const onChange = props.auto.onChange;
  return (
    <label style={autoLabelStyle}>
      <input
        type="checkbox"
        aria-label={`${props.label}: Auto`}
        checked={props.auto.checked}
        title={AUTO_TITLE}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Auto</span>
    </label>
  );
}

const AUTO_TITLE =
  'Judge each small mark on its tone and surroundings: keep drawn dots and texture, remove scan dust and threshold cracks. Untick to set an exact value.';

function traceCheckboxTitle(label: string): string {
  switch (label) {
    case 'Fill tiny holes':
      return 'Ticked fills every enclosed hairline hole in solid ink; unticked fills none. Open gaps always stay open. Tick Auto to fill only faint threshold cracks.';
    case 'Invert':
      return 'Trace light artwork on a dark background: light areas become the traced shapes. Transparent areas stay background.';
    case 'Trace background colour':
      return 'Also trace the paper colour as its own layer. Its operation starts with output off, so the paper is still not burned until you turn it on.';
    case 'Trace alpha mask':
      return 'Only changes images with transparent pixels; opaque images trace the same.';
    default:
      return `Toggle ${label.toLowerCase()} for tracing.`;
  }
}

const autoRowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};

const autoLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};

const checkboxRowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
