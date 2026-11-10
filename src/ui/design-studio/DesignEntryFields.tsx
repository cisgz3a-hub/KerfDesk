// DesignEntryFields — the typed-entry boxes a draw tool puts in the options bar
// (ADR-272 Amendment 5, DS-3c).
//
// Idle, the boxes are disabled and say what can be typed once a shape is
// started. Drawing, they track the live values; typing one locks it (accent
// border), Tab locks it and moves on, Enter locks it and finishes the step, Esc
// drops the typing and hands the keyboard back to the canvas. Emptying a box
// releases its lock. A digit typed on the canvas lands in the first unlocked
// box, so the mouse never has to leave the drawing.

import { useEffect, useRef, useState } from 'react';
import { fieldDecimals } from './design-field-format';
import { isEntrySeedKey, useDesignEntryFocus } from './design-entry-focus';
import { useDesignStudioStore } from './design-studio-store';
import {
  completeEntryStep,
  entryFieldsFor,
  isEntryGestureLive,
  lockedFieldValue,
  typeEntryField,
  type EntryFieldView,
} from './design-typed-entry';

export function DesignEntryFields(): JSX.Element | null {
  const session = useDesignStudioStore((state) => state.session);
  if (session === null) return null;
  const fields = entryFieldsFor(session);
  const live = isEntryGestureLive(session);
  const seedTarget = fields.find((field) => !field.locked)?.key ?? fields[0]?.key;
  return (
    <>
      {fields.map((field) => (
        <EntryInput
          key={field.key}
          field={field}
          live={live}
          lockedValue={lockedFieldValue(session, field)}
          seedTarget={field.key === seedTarget}
        />
      ))}
    </>
  );
}

function EntryInput(props: {
  readonly field: EntryFieldView;
  readonly live: boolean;
  readonly lockedValue: number | null;
  readonly seedTarget: boolean;
}): JSX.Element {
  const { field, live } = props;
  const entry = useEntryInput(props);
  const noun = field.label.toLowerCase();
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{field.label}</span>
      <input
        ref={entry.inputRef}
        type="text"
        inputMode="decimal"
        value={entry.shown}
        disabled={!live}
        placeholder="—"
        aria-label={`${field.label} in ${field.unit === 'mm' ? 'mm' : 'degrees'}`}
        aria-invalid={entry.error !== null}
        data-locked={field.locked ? 'true' : undefined}
        title={
          entry.error !== null
            ? `Not used: ${entry.error}.`
            : live
              ? `Type a ${noun} to lock it. Enter finishes; empty the box to let the pointer drive it again.`
              : `Start drawing, then type a ${noun}.`
        }
        onChange={(event) => entry.setText(event.target.value)}
        onBlur={entry.onBlur}
        onKeyDown={entry.onKeyDown}
        style={inputStyleFor(field.locked, entry.error !== null)}
      />
      <span style={unitStyle}>{field.unit === 'mm' ? 'mm' : '°'}</span>
    </label>
  );
}

type EntryInputState = {
  readonly inputRef: React.RefObject<HTMLInputElement>;
  readonly shown: string;
  readonly error: string | null;
  readonly setText: (text: string) => void;
  readonly onBlur: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

function useEntryInput(props: {
  readonly field: EntryFieldView;
  readonly live: boolean;
  readonly lockedValue: number | null;
  readonly seedTarget: boolean;
}): EntryInputState {
  const { field, live, lockedValue, seedTarget } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Enter and Esc hand focus back to the canvas, which blurs this box. That
  // blur must not lock the text again: after Enter the gesture has moved on
  // (a polyline's NEXT segment would inherit the value), after Esc it was dropped.
  const skipBlur = useRef(false);
  useSeededFocus(inputRef, seedTarget && live, text, (seed) => {
    setError(null);
    setText(seed);
  });
  // A finished or abandoned gesture takes any half-typed value with it.
  useEffect(() => {
    if (!live) {
      setText(null);
      setError(null);
    }
  }, [live]);

  const shownValue = lockedValue ?? field.value;
  const shown = text ?? (shownValue === null ? '' : shownValue.toFixed(fieldDecimals(field.unit)));
  const lockTyped = (): boolean => {
    if (text === null) return true;
    const parsed = typeEntryField(field, text);
    if (parsed.kind === 'invalid') {
      setError(parsed.message);
      return false;
    }
    setText(null);
    setError(null);
    return true;
  };
  const handBack = (): void => {
    skipBlur.current = true;
    returnFocusToStudio(inputRef.current);
  };
  return {
    inputRef,
    shown,
    error,
    setText,
    onBlur: () => {
      if (skipBlur.current) {
        skipBlur.current = false;
        return;
      }
      if (!lockTyped()) setText(null);
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!lockTyped()) return;
        completeEntryStep(() => crypto.randomUUID());
        handBack();
        return;
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        setText(null);
        setError(null);
        handBack();
      }
    },
  };
}

// A digit typed on the canvas arrives as a seed: put it in this box, then focus
// the box with the caret after it so the next keystrokes continue the number.
function useSeededFocus(
  inputRef: React.RefObject<HTMLInputElement>,
  enabled: boolean,
  text: string | null,
  onSeed: (text: string) => void,
): void {
  const caretPending = useRef(false);
  useSeed(enabled, (seed) => {
    caretPending.current = true;
    onSeed(seed);
  });
  useEffect(() => {
    const input = inputRef.current;
    if (!caretPending.current || input === null) return;
    caretPending.current = false;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [inputRef, text]);
}

function useSeed(enabled: boolean, onSeed: (text: string) => void): void {
  const seed = useDesignEntryFocus((state) => state.seed);
  const seen = useRef(seed?.nonce ?? 0);
  useEffect(() => {
    if (seed === null || seed.nonce === seen.current) return;
    seen.current = seed.nonce;
    if (enabled && isEntrySeedKey(seed.text)) onSeed(seed.text);
  }, [enabled, onSeed, seed]);
}

// The Studio's keymap listens on the overlay root, so the keyboard goes back
// there — not to the page body, where a tool letter would do nothing.
function returnFocusToStudio(input: HTMLInputElement | null): void {
  const root = input?.closest<HTMLElement>('[role="dialog"]');
  root?.focus();
}

const fieldStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 };

const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };

function inputStyleFor(locked: boolean, invalid: boolean): React.CSSProperties {
  const border = invalid ? 'var(--lf-danger)' : locked ? 'var(--lf-accent)' : 'var(--lf-border)';
  return {
    width: 62,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: locked ? 600 : 400,
    textAlign: 'right',
    padding: '1px 5px',
    borderRadius: 4,
    border: `1px solid ${border}`,
    background: 'var(--lf-bg-input)',
    color: 'var(--lf-text)',
  };
}

const unitStyle: React.CSSProperties = { fontSize: 10, color: 'var(--lf-text-muted)' };
