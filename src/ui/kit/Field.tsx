// Field — a labeled control row (label · control · optional unit). Replaces
// the five near-identical private Field/Row helpers the dialogs and layer
// panel each rolled. Purely presentational: children remain the caller's
// inputs, so debounced-commit consumers keep their exact wiring.

export function Field(props: {
  readonly label: string;
  readonly labelWidth?: 'sm' | 'md';
  readonly unit?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  const labelClass = `lf-field-label lf-field-label--${props.labelWidth ?? 'sm'}`;
  return (
    <label className="lf-field">
      <span className={labelClass}>{props.label}</span>
      {props.children}
      {props.unit === undefined ? null : <span className="lf-field-unit">{props.unit}</span>}
    </label>
  );
}
