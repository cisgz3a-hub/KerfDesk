import { useState } from 'react';
import { evaluateNumericEntry, type NumericEntryKind } from '../../core/numeric-expression';

export function CompoundNumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly kind?: NumericEntryKind;
  readonly integer?: boolean;
  readonly commit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<{ text: string; base: number } | null>(null);
  const shown = Number(props.value.toFixed(6)).toString();
  const text = draft?.base === props.value ? draft.text : shown;
  const result = evaluateNumericEntry(text, { kind: props.kind ?? 'length' });
  const valid =
    result.kind === 'ok' &&
    (!props.integer || (Number.isInteger(result.value) && result.value >= 1));
  const commit = (): void => {
    if (
      draft?.base === props.value &&
      valid &&
      result.kind === 'ok' &&
      result.value !== props.value
    )
      props.commit(result.value);
    setDraft(null);
  };
  return (
    <label className="lf-field">
      <span>{props.label}</span>
      <input
        className="lf-input"
        type="text"
        inputMode="decimal"
        aria-label={props.label}
        aria-invalid={!valid}
        title="Type a value or arithmetic; length fields also accept mm, cm or in. Enter or blur updates the preview."
        value={text}
        onChange={(event) => setDraft({ text: event.currentTarget.value, base: props.value })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commit();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </label>
  );
}
