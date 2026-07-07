// NumberField - a clearable numeric input. Shows your keystrokes (including an
// empty box while you retype), commits a clamped number once a valid one is
// typed, and restores the last committed value on blur if left blank. Wraps the
// shared useDebouncedCommit so every ad-hoc numeric input can adopt the same
// clear-to-retype behaviour instead of re-implementing parse-and-commit - the
// source of the "can't erase the box" bug across the app.

import { useDebouncedCommit } from '../layers/use-debounced-commit';
import { NumberInput } from '../kit';

export function NumberField(props: {
  readonly ariaLabel: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly title?: string;
  readonly onCommit: (value: number) => void;
  readonly style?: React.CSSProperties;
  // Local-state fields (no store undo) can pass 0 to commit valid input immediately.
  readonly debounceMs?: number;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (input) => {
      const parsed = Number.parseFloat(input);
      if (!Number.isFinite(parsed)) return props.value;
      return Math.min(props.max, Math.max(props.min, parsed));
    },
    ...(props.debounceMs === undefined ? {} : { debounceMs: props.debounceMs }),
  });
  return (
    <NumberInput
      aria-label={props.ariaLabel}
      title={props.title ?? props.ariaLabel}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      style={props.style}
    />
  );
}
