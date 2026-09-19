import { validateEnglishDecimalInput } from './english-decimal-input';
import { useDebouncedCommit } from './use-debounced-commit';

/** Null is a display baseline, never a committed number. Using the first
 * artwork's number as the baseline would discard an explicit edit equal to it. */
export function useMixedOperationNumber(args: {
  readonly value: number;
  readonly mixed?: boolean | undefined;
  readonly reconcileKey?: unknown;
  readonly parse: (value: string) => number;
  readonly commit: (value: number) => void;
}) {
  const debounced = useDebouncedCommit<number | null>({
    value: args.mixed ? null : args.value,
    reconcileKey: args.reconcileKey,
    parse: (value) => (value.trim() === '' ? null : args.parse(value)),
    format: (value) => (value === null ? '' : String(value)),
    validate: validateEnglishDecimalInput,
    commit: (value) => {
      if (value !== null) args.commit(value);
    },
  });
  const mixed = args.mixed === true && debounced.displayValue === '';
  return {
    ...debounced,
    inputProps: {
      placeholder: mixed ? 'Mixed' : undefined,
      'data-mixed': mixed ? 'true' : undefined,
      'aria-valuetext': mixed ? 'Mixed' : undefined,
    },
  };
}

export function mixedCheckboxProps(value: boolean, mixed = false) {
  return {
    checked: mixed ? false : value,
    'aria-checked': mixed ? ('mixed' as const) : value,
    ref: (input: HTMLInputElement | null): void => {
      if (input) input.indeterminate = mixed;
    },
  };
}
