import type { InputHTMLAttributes } from 'react';
import { useDebouncedCommit } from '../layers/use-debounced-commit';

type DraftNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange'
> & {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  /** Preserve the owning field's existing clamp, rounding or rejection rule. */
  readonly normalize?: (value: number) => number;
  readonly format?: (value: number) => string;
  readonly debounceMs?: number;
  /** For editors whose commit sorts or replaces the row being edited. */
  readonly commitOnBlur?: boolean;
};

/** A numeric model with a separate, clearable typing draft. */
export function DraftNumberInput({
  value,
  onValueChange,
  normalize,
  format,
  debounceMs = 0,
  commitOnBlur = false,
  onBlur,
  onKeyDown,
  className = 'lf-input',
  title,
  'aria-label': ariaLabel,
  ...props
}: DraftNumberInputProps): JSX.Element {
  const field = useDebouncedCommit({
    value,
    commit: onValueChange,
    parse: (text) => {
      const parsed = Number(text);
      if (text.trim() === '' || !Number.isFinite(parsed)) return value;
      const next = normalize?.(parsed) ?? parsed;
      return Number.isFinite(next) ? next : value;
    },
    validate: (text) => (Number.isFinite(Number(text)) ? null : 'Enter a finite number.'),
    ...(format === undefined ? {} : { format }),
    debounceMs,
    commitOnBlur,
  });
  return (
    <input
      {...props}
      type="number"
      className={className}
      title={title ?? ariaLabel}
      aria-label={ariaLabel}
      value={field.displayValue}
      onChange={field.onChange}
      onBlur={(event) => {
        field.onBlur(event);
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === 'Enter' && !event.defaultPrevented) {
          if (commitOnBlur) event.preventDefault();
          field.onBlur();
        }
      }}
    />
  );
}
