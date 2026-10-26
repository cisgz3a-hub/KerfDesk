// spin-text-field — a layer number box typed as text so it takes units
// ('10mm', '2in'; ADR-629) stays the number box it replaced: assistive
// technology hears a spin button with its value and range, and ArrowUp or
// ArrowDown step it as a number input's arrows would. Stepping only sets the
// box's text, as typing would; the box's own draft validates and commits it.

import type React from 'react';

type SpinTextField = {
  /** The box's value in its shown unit, read from the text it holds. */
  readonly current: (text: string) => number;
  readonly step: number;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** Puts new text in the box as if the operator typed it. */
  readonly change: (text: string, input: HTMLInputElement) => void;
};

export function spinTextProps(field: SpinTextField, text: string) {
  const now = text.trim() === '' ? Number.NaN : field.current(text);
  return {
    role: 'spinbutton',
    'aria-valuenow': Number.isFinite(now) ? now : undefined,
    'aria-valuemin': field.min,
    'aria-valuemax': field.max,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>): void => {
      const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
      if (direction === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
      const input = event.currentTarget;
      // A blank or Mixed box has no value to step from.
      if (input.value.trim() === '') return;
      const value = field.current(input.value);
      if (!Number.isFinite(value)) return;
      event.preventDefault();
      field.change(String(stepped(value + direction * field.step, field)), input);
    },
  };
}

// Twelve significant digits drop the float noise of adding a step
// (0.3937 + 0.01 is 0.40370000000000006).
function stepped(value: number, field: SpinTextField): number {
  const low = field.min ?? -Infinity;
  const high = field.max ?? Infinity;
  return Number(Math.max(low, Math.min(high, value)).toPrecision(12));
}
