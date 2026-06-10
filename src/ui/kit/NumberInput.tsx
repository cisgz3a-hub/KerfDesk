// NumberInput — a dumb forwarding wrapper: <input type="number"> with the
// shared .lf-input chrome. Carries NO state and NO parsing — value/onChange/
// onBlur pass straight through, so use-debounced-commit consumers keep their
// contract untouched.

export type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'className' | 'type'
>;

export function NumberInput(props: NumberInputProps): JSX.Element {
  return <input {...props} type="number" className="lf-input" />;
}
