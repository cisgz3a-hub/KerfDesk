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
          // A table row that commits on blur keeps its field: its Enter sorts
          // the rows and the operator goes on editing the same one.
          if (!commitOnBlur) releaseFocusAfterEnter(event, field.errorMessage);
        }
      }}
    />
  );
}

// Enter means "done": the value is committed, so the field lets go of the
// keyboard and Delete, Ctrl+Z and the arrow keys reach the artwork again
// (annoyance audit A4-P2-2). Besides a commit-on-blur table row, three cases
// keep focus:
//   * a field with an error, so it can be corrected;
//   * a field inside a dialog, which owns the keyboard and would hand a
//     released focus to its first control;
//   * Enter on the numeric keypad. With a machine connected the keypad digits
//     jog the head whenever no field has focus (ADR-493), so someone typing
//     the next number on the keypad must stay in the field.
function releaseFocusAfterEnter(
  event: React.KeyboardEvent<HTMLInputElement>,
  errorMessage: string | null,
): void {
  if (errorMessage !== null || event.code === 'NumpadEnter') return;
  const input = event.currentTarget;
  if (input.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null) return;
  input.blur();
}
