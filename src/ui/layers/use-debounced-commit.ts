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

const DEFAULT_DEBOUNCE_MS = 300;

export type UseDebouncedCommitArgs<T> = {
  readonly value: T;
  readonly commit: (next: T) => void;
  readonly parse: (input: string) => T;
  readonly format?: (value: T) => string;
  readonly debounceMs?: number;
};

export type DebouncedCommit = {
  readonly displayValue: string;
  readonly onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onBlur: () => void;
};

export function useDebouncedCommit<T>(args: UseDebouncedCommitArgs<T>): DebouncedCommit {
  const { value, commit, parse } = args;
  const format = args.format ?? defaultFormat<T>;
  const debounceMs = args.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [draft, setDraft] = useState<string>(() => format(value));
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

  const debouncerRef = useRef<Debouncer<T>>();
  if (debouncerRef.current === undefined) {
    debouncerRef.current = createDebouncer<T>({
      initial: value,
      debounceMs,
      // M25 (AUDIT-2026-06-10): when the commit fires, snap the displayed
      // text to the value actually committed. parse() clamps silently, so
      // typing 9999 into Speed (max 6000) used to keep DISPLAYING 9999 while
      // the store, G-code, and ETA all used 6000 — the field lied.
      commit: (next) => {
        commitRef.current(next);
        setDraft(formatRef.current(next));
      },
    });
  }

  // Reconcile when the store changes the canonical value out from under us
  // (e.g. undo / external setLayerParam from a different surface). We only
  // overwrite the local draft when the parsed draft doesn't already match —
  // otherwise the user's in-flight typing would be wiped mid-keystroke.
  useEffect(() => {
    debouncerRef.current?.acknowledge(value);
    if (parseRef.current(draftRef.current) !== value) {
      setDraft(formatRef.current(value));
    }
  }, [value]);

  // Clean up the pending timer on unmount so we don't commit after the
  // component is gone (avoids ghost writes during route changes).
  useEffect(() => {
    return (): void => {
      debouncerRef.current?.cancel();
    };
  }, []);

  return {
    displayValue: draft,
    onChange: (e) => {
      const nextText = e.target.value;
      setDraft(nextText);
      // A blank field is a legitimate transient editing state — the operator is
      // clearing the box to retype. Do NOT schedule a commit: parse('') returns
      // a fallback number (old value / min / 0), and committing it snaps the
      // field back under the user, so the whole box can never be erased. Hold
      // the empty text; committing resumes on the next real keystroke or blur.
      if (nextText.trim() === '') {
        debouncerRef.current?.cancel();
        return;
      }
      debouncerRef.current?.schedule(parse(nextText));
    },
    onBlur: () => {
      // Left blank on blur → nothing to commit; restore the last committed
      // value (LightBurn behavior) rather than writing a fallback number.
      if (draft.trim() === '') {
        debouncerRef.current?.cancel();
        setDraft(format(value));
        return;
      }
      const committed = parse(draft);
      debouncerRef.current?.flush(committed);
      // Snap even when the clamped value equals the already-committed value
      // (flush may skip the commit callback then, but the text can still be
      // out of range — e.g. 9999 typed while the store already holds 6000).
      setDraft(format(committed));
    },
  };
}

function defaultFormat<T>(v: T): string {
  return typeof v === 'number' ? String(v) : (v as unknown as string);
}
