export function TraceCheckboxRow(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkboxRowStyle}>
      <input
        type="checkbox"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled === true}
        title={traceCheckboxTitle(props.label)}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function traceCheckboxTitle(label: string): string {
  switch (label) {
    case 'Fill tiny holes':
      return 'Fill every enclosed hairline hole in solid ink; open gaps stay open. Left unset, Line Art fills only faint threshold cracks and keeps real tiny holes.';
    case 'Trace alpha mask':
      return 'Only changes images with transparent pixels; opaque images trace the same.';
    default:
      return `Toggle ${label.toLowerCase()} for tracing.`;
  }
}

const checkboxRowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
