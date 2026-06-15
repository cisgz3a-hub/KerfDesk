// NumberInput — a dumb forwarding wrapper: <input type="number"> with the
// shared .lf-input chrome. Carries NO state and NO parsing — value/onChange/
// onBlur pass straight through, so use-debounced-commit consumers keep their
// contract untouched.

export type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'className' | 'type'
>;

export function NumberInput({
  title,
  'aria-label': ariaLabel,
  ...props
}: NumberInputProps): JSX.Element {
  const hoverTitle = title ?? (typeof ariaLabel === 'string' ? ariaLabel : undefined);
  return (
    <input
      {...props}
      type="number"
      className="lf-input"
      aria-label={ariaLabel}
      title={hoverTitle}
    />
  );
}
