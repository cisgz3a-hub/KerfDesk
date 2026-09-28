// The labelled row and uncontrolled number box every Cut Settings group uses,
// shared by CutSettingsCommonFields and LineTabFields.

export function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
  readonly title?: string;
  readonly onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <input
      name={props.name}
      type="number"
      className="lf-input"
      min={props.min}
      {...(props.max !== undefined ? { max: props.max } : {})}
      step={props.step ?? 1}
      defaultValue={props.value}
      onChange={props.onChange}
      style={numberStyle}
      aria-label={`Cut settings ${props.label ?? props.name}`}
      title={props.title ?? `Set cut settings ${props.label ?? props.name}.`}
    />
  );
}

export function Field(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

export const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
