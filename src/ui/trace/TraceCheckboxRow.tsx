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
      return 'Fill every enclosed hairline hole in solid ink; open gaps stay open. Line Art and Smooth start unticked and fill only faint threshold cracks automatically; once you tick or untick it, ticked fills every hole and unticked fills none.';
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

const checkboxRowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
