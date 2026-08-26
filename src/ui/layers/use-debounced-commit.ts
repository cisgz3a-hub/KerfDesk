// useDebouncedCommit — drives a controlled input where the field shows the
// user's current keystroke immediately, but commits to the store only after
// a quiet period (or on blur). WORKFLOW.md F-A7 mandates 300ms debouncing
// on layer-parameter inputs: "the LF1 audit found this missing; do not
// repeat." Without this, typing "1500" produces four undo frames.
//
// The pure scheduling logic lives in `debouncer.ts` so it's testable
// without rendering React; this hook is the thin React-wired wrapper.

import { useEffect, useRef, useState } from 'react';
import { createDebouncer, type Debouncer } from './debouncer';
import { validateEnglishDecimalInput } from './english-decimal-input';

const DEFAULT_DEBOUNCE_MS = 300;

export type UseDebouncedCommitArgs<T> = {
  readonly value: T;
  readonly commit: (next: T) => void;
  readonly parse: (input: string) => T;
  readonly format?: (value: T) => string;
  readonly debounceMs?: number;
  // Extra reconciliation trigger for fields whose DISPLAY depends on more
  // than `value`: a shape field shows spec × transform scale, so a toolbar
  // resize changes what the box should read while `value` (the spec) stays
  // put. Without re-reconciling, the stale draft is written back on blur —
  // silently undoing the resize. Pass the extra display input (e.g. the
  // scale) here; leave unset for fields whose display is a pure function of
  // `value`.
  readonly reconcileKey?: unknown;
  readonly validate?: (input: string) => string | null;
};

export type DebouncedCommit = {
  readonly displayValue: string;
  readonly onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onBlur: (event?: React.FocusEvent<HTMLInputElement>) => void;
  readonly errorMessage: string | null;
};

export function useDebouncedCommit<T>(args: UseDebouncedCommitArgs<T>): DebouncedCommit {
  const { value, commit, parse } = args;
  const format = args.format ?? defaultFormat<T>;
  const debounceMs = args.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [draft, setDraft] = useState<string>(() => format(value));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Mirror callbacks + draft via refs so the reconcile-effect below can
  // depend only on `value` (the deliberate trigger) without the
  // exhaustive-deps rule flagging the closure-captures as missing
  // deps. Adding draft/parse/format to the dep array would re-fire the
  // effect on every keystroke and wipe the user's input.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const formatRef = useRef(format);
  formatRef.current = format;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const validateRef = useRef(args.validate);
  validateRef.current = args.validate;
  const validationError = (input: string): string | null => {
    const validate = validateRef.current;
    if (validate !== undefined) return validate(input);
    return typeof value === 'number' ? validateEnglishDecimalInput(input) : null;
  };

  const debouncerRef = useRef<Debouncer<T>>();
  if (debouncerRef.current === undefined) {
    debouncerRef.current = createDebouncer<T>({
      initial: value,
      debounceMs,
      // The debounce timer commits the parsed value to the STORE only (F-A7
      // undo-batching) — it must NOT rewrite the visible draft. The timer can't
      // tell "done typing" from a mid-number reading pause, so snapping the text
      // here yanked characters out from under an active edit (typing 0.5 into a
      // min-0.05 field, pausing after "0", jumped the box to the min; "12." lost
      // its decimal). Display reconciliation happens only on the real "done"
      // signals: blur (onBlur) and external value changes (the effect below).
      // M25 (AUDIT-2026-06-10) is still satisfied — a clamped field shows the
      // enforced value (9999 → 6000) once you leave it, instead of lying.
      commit: (next) => {
        commitRef.current(next);
      },
    });
  }

  // Reconcile when the store changes the canonical value out from under us
  // (e.g. undo / external setLayerParam from a different surface), or when
  // reconcileKey reports the display mapping itself moved (toolbar resize
  // rescaling a shape field). We only overwrite the local draft when the
  // parsed draft doesn't already match — otherwise the user's in-flight
  // typing would be wiped mid-keystroke.
  useEffect(() => {
    // A canonical store update or display-mapping change owns the field now.
    // Drop work parsed against the previous state before acknowledging the new
    // baseline, or its stale timer can overwrite undo/toolbar/document changes.
    debouncerRef.current?.cancel();
    debouncerRef.current?.acknowledge(value);
    setErrorMessage(null);
    if (parseRef.current(draftRef.current) !== value) {
      setDraft(formatRef.current(value));
    }
  }, [value, args.reconcileKey]);

  // Clean up the pending timer on unmount so we don't commit after the
  // component is gone (avoids ghost writes during route changes).
  useEffect(() => {
    return (): void => {
      debouncerRef.current?.cancel();
    };
  }, []);

  const handlerContext: DebouncedHandlerContext<T> = {
    value,
    draft,
    debounceMs,
    parse,
    format,
    validationError,
    debouncer: debouncerRef.current,
    setDraft,
    setErrorMessage,
  };
  return {
    displayValue: draft,
    errorMessage,
    onChange: createChangeHandler(handlerContext),
    onBlur: createBlurHandler(handlerContext),
  };
}

type DebouncedHandlerContext<T> = {
  readonly value: T;
  readonly draft: string;
  readonly debounceMs: number;
  readonly parse: (input: string) => T;
  readonly format: (value: T) => string;
  readonly validationError: (input: string) => string | null;
  readonly debouncer: Debouncer<T> | undefined;
  readonly setDraft: (value: string) => void;
  readonly setErrorMessage: (value: string | null) => void;
};

function createChangeHandler<T>(context: DebouncedHandlerContext<T>): DebouncedCommit['onChange'] {
  return (event): void => {
    const nextText = event.target.value;
    context.setDraft(nextText);
    // Blank is a valid transient edit, but never a value to commit.
    if (nextText.trim() === '') {
      context.debouncer?.cancel();
      context.setErrorMessage(null);
      setInputValidity(event.target, '');
      return;
    }
    const error = context.validationError(nextText);
    context.setErrorMessage(error);
    setInputValidity(event.target, error ?? '');
    if (error !== null) {
      context.debouncer?.cancel();
      return;
    }
    const parsed = context.parse(nextText);
    if (context.debounceMs <= 0) context.debouncer?.flush(parsed);
    else context.debouncer?.schedule(parsed);
  };
}

function createBlurHandler<T>(context: DebouncedHandlerContext<T>): DebouncedCommit['onBlur'] {
  return (event): void => {
    if (context.draft.trim() === '') {
      context.debouncer?.cancel();
      context.setDraft(context.format(context.value));
      context.setErrorMessage(null);
      setInputValidity(event?.currentTarget, '');
      return;
    }
    const error = context.validationError(context.draft);
    if (error !== null) {
      context.debouncer?.cancel();
      context.setErrorMessage(error);
      setInputValidity(event?.currentTarget, error, true);
      return;
    }
    const committed = context.parse(context.draft);
    context.debouncer?.flush(committed);
    // Reconcile clamped text even when the canonical value did not change.
    context.setDraft(context.format(committed));
    context.setErrorMessage(null);
    setInputValidity(event?.currentTarget, '');
  };
}

function setInputValidity(
  input: HTMLInputElement | undefined,
  message: string,
  report = false,
): void {
  input?.setCustomValidity?.(message);
  if (report) input?.reportValidity?.();
}

function defaultFormat<T>(v: T): string {
  return typeof v === 'number' ? String(v) : (v as unknown as string);
}
