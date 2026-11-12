// Toasts — transient non-blocking notifications used by the import / save /
// open flows (WORKFLOW.md F-A3, F-A7, F-A9, F-A11, F-A12). Kept in a
// dedicated Zustand store so neither the project slice nor the laser slice
// has to know about UI ephemera, and so the auto-dismiss timer doesn't sit
// inside React render code.
//
// Variants intentionally limited to four — anything richer than this (e.g.
// action buttons) belongs in a modal, not a toast. The one exception is a
// short list of notes folded under one line (`details`), so a burst of
// expert notes after Save G-code takes one slot (UX audit U3-P3-6, ADR-687).
//
// The rules a toast lives by are ADR-708: its lifetime grows with its text,
// the countdown stops while the operator points at it or has focus inside it,
// a keyed toast is one slot that is rewritten, and every warning and error is
// also kept in the session's notice history.

import { create } from 'zustand';
import { useNoticeHistory } from './notice-history';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

/** How many toasts the stack shows; older ones wait in the store. Three
 * single-line toasts fit the band reserved beside the canvas. */
export const VISIBLE_TOASTS = 3;

// The shortest a toast stays. Advisories and failures stay long enough to
// read. A success confirms something the operator can already see on screen,
// so it leaves twice as fast (maintainer, 2026-09-19: the green pop-ups were
// lingering in the way).
const MIN_LIFETIME_MS: Readonly<Record<ToastVariant, number>> = {
  info: 8000,
  success: 4000,
  warning: 8000,
  error: 8000,
};
// Reading time: two seconds to notice the toast, then 60 ms a character
// (about 200 words a minute). Past the cap a text is too long for a toast.
const NOTICE_MS = 2000;
const MS_PER_CHARACTER = 60;
const MAX_LIFETIME_MS = 30_000;
// A toast the pointer has just left stays at least this long, so it cannot
// vanish the moment the operator moves on.
const MIN_RESUME_MS = 2000;

/**
 * How long a toast stays before it leaves by itself: long enough to read its
 * text, never shorter than its variant's minimum, never longer than 30 s
 * (annoyance audit A5-P2-5).
 */
export function toastLifetimeMs(variant: ToastVariant, message: string): number {
  const reading = NOTICE_MS + MS_PER_CHARACTER * message.length;
  return Math.min(MAX_LIFETIME_MS, Math.max(MIN_LIFETIME_MS[variant], reading));
}

export type Toast = {
  readonly id: string;
  readonly message: string;
  readonly variant: ToastVariant;
  /** A keyed toast is one slot: pushing the same key again rewrites it. */
  readonly key?: string;
  /** Notes folded under the message, shown when the operator opens them. */
  readonly details?: ReadonlyArray<string>;
};

export type ToastOptions = {
  readonly key?: string;
  readonly details?: ReadonlyArray<string>;
};

type ToastState = {
  readonly toasts: ReadonlyArray<Toast>;
  readonly pushToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
  readonly dismissToast: (id: string) => void;
  readonly dismissToastKey: (key: string) => void;
  /** Stops a toast's auto-dismiss: the operator opened it to read. */
  readonly holdToast: (id: string) => void;
  /** Stops the countdown while the operator points at the toast or has focus in it. */
  readonly pauseToast: (id: string) => void;
  /** Starts the countdown again with the time that was left. */
  readonly resumeToast: (id: string) => void;
};

// Active auto-dismiss timers, keyed by toast id. Held outside the store
// (R-L1 audit finding): when the user manually dismisses a toast, we must
// clear the matching setTimeout to stop a stale callback from firing later.
// Without this, a rapid burst of pushes followed by manual dismissals leaves
// orphaned timers resident in the event loop until they fire as no-op
// filters. Not a leak per se, but accumulates work and prevents tests/JSDOM
// from quiescing.
type Countdown = { readonly handle: ReturnType<typeof setTimeout>; readonly endsAt: number };
const timers = new Map<string, Countdown>();
// Paused toasts and the milliseconds each had left.
const paused = new Map<string, number>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  pushToast: (message, variant = 'info', options = {}) => {
    const { key, details } = options;
    const folded = details === undefined || details.length === 0 ? {} : { details };
    if (variant === 'warning' || variant === 'error') {
      useNoticeHistory.getState().recordNotice({ message, variant, ...folded });
    }
    const lifetime = toastLifetimeMs(variant, message);
    const existing = key === undefined ? undefined : get().toasts.find((t) => t.key === key);
    if (existing !== undefined) {
      // Same slot, new text: progress reads as one updating line, not a stack.
      const rewritten = { ...withoutDetails(existing), message, variant, ...folded };
      set((s) => ({ toasts: rewriteSlot(s.toasts, rewritten) }));
      // Rewritten under the pointer, it stays paused with a fresh lifetime.
      if (paused.has(existing.id)) paused.set(existing.id, lifetime);
      else scheduleDismiss(existing.id, lifetime, get);
      return;
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id, message, variant, ...(key === undefined ? {} : { key }), ...folded },
      ],
    }));
    scheduleDismiss(id, lifetime, get);
  },
  dismissToast: (id) => {
    stopCountdown(id);
    paused.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  dismissToastKey: (key) => {
    const keyed = get().toasts.find((t) => t.key === key);
    if (keyed !== undefined) get().dismissToast(keyed.id);
  },
  holdToast: (id) => {
    stopCountdown(id);
    paused.delete(id);
  },
  pauseToast: (id) => {
    const countdown = timers.get(id);
    // No countdown: already paused, held open, or gone.
    if (countdown === undefined) return;
    stopCountdown(id);
    paused.set(id, Math.max(0, countdown.endsAt - Date.now()));
  },
  resumeToast: (id) => {
    const remaining = paused.get(id);
    if (remaining === undefined) return;
    paused.delete(id);
    scheduleDismiss(id, Math.max(MIN_RESUME_MS, remaining), get);
  },
}));

function withoutDetails(toast: Toast): Toast {
  if (toast.details === undefined) return toast;
  const { details: _details, ...rest } = toast;
  return rest;
}

// A rewritten slot keeps its place while it is on screen. One that newer
// toasts pushed out of the visible stack comes back as the newest, or its new
// text would never be seen.
function rewriteSlot(toasts: ReadonlyArray<Toast>, rewritten: Toast): ReadonlyArray<Toast> {
  const index = toasts.findIndex((t) => t.id === rewritten.id);
  if (index >= toasts.length - VISIBLE_TOASTS) {
    return toasts.map((t) => (t.id === rewritten.id ? rewritten : t));
  }
  return [...toasts.filter((t) => t.id !== rewritten.id), rewritten];
}

function stopCountdown(id: string): void {
  const countdown = timers.get(id);
  if (countdown === undefined) return;
  clearTimeout(countdown.handle);
  timers.delete(id);
}

function scheduleDismiss(id: string, lifetimeMs: number, get: () => ToastState): void {
  // Schedule auto-dismiss out of band — toast lifetime is decoupled from
  // React commit cycles so a fast burst of toasts doesn't extend each
  // other's lifetimes.
  stopCountdown(id);
  const handle = setTimeout(() => {
    timers.delete(id);
    get().dismissToast(id);
  }, lifetimeMs);
  timers.set(id, { handle, endsAt: Date.now() + lifetimeMs });
}
