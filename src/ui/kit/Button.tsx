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
  title,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const hoverTitle = title === undefined ? titleFromChildren(children) : title;
  return (
    <button
      {...rest}
      type={type}
      title={hoverTitle}
      className={VARIANT_CLASS[variant]}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
    >
      {children}
    </button>
  );
}

function titleFromChildren(children: React.ReactNode): string | undefined {
  if (typeof children === 'string') {
    const text = children.trim();
    return text === '' ? undefined : text;
  }
  if (typeof children === 'number') return String(children);
  return undefined;
}
