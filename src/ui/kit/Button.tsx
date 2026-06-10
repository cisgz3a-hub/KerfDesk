// Button — the shared chrome button (ADR-047). Styling lives in tokens.css
// (.lf-btn + variants) so hover/active/disabled finally exist; this
// component just picks classes and defaults type="button" (raw <button>
// inside a <form> defaults to submit — a recurring footgun).

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

export type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style'
> & {
  readonly variant?: ButtonVariant;
  // Renders aria-pressed for toggle buttons (e.g. the Preview toggle);
  // tokens.css styles [aria-pressed='true'] as the accent fill.
  readonly pressed?: boolean;
};

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  default: 'lf-btn',
  primary: 'lf-btn lf-btn--primary',
  danger: 'lf-btn lf-btn--danger',
  ghost: 'lf-btn lf-btn--ghost',
};

export function Button({
  variant = 'default',
  pressed,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      className={VARIANT_CLASS[variant]}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
    />
  );
}
