// Toasts — transient non-blocking notifications used by the import / save /
// open flows (WORKFLOW.md F-A3, F-A7, F-A9, F-A11, F-A12). Kept in a
// dedicated Zustand store so neither the project slice nor the laser slice
// has to know about UI ephemera, and so the auto-dismiss timer doesn't sit
// inside React render code.
//
// Variants intentionally limited to four — anything richer than this (e.g.
// action buttons, "show details" expansion) belongs in a modal, not a toast.

import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

// Advisories and failures stay long enough to read. A success confirms
// something the operator can already see on screen, so it leaves twice as
// fast (maintainer, 2026-09-19: the green pop-ups were lingering in the way).
const AUTO_DISMISS_MS: Readonly<Record<ToastVariant, number>> = {
  info: 8000,
  success: 4000,
  warning: 8000,
  error: 8000,
};

export type Toast = {
  readonly id: string;
  readonly message: string;
  readonly variant: ToastVariant;
  /** A keyed toast is one slot: pushing the same key again rewrites it. */
  readonly key?: string;
};

export type ToastOptions = { readonly key?: string };

type ToastState = {
  readonly toasts: ReadonlyArray<Toast>;
  readonly pushToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
  readonly dismissToast: (id: string) => void;
  readonly dismissToastKey: (key: string) => void;
};

// Active auto-dismiss timers, keyed by toast id. Held outside the store
// (R-L1 audit finding): when the user manually dismisses a toast, we must
// clear the matching setTimeout to stop a stale callback from firing later.
// Without this, a rapid burst of pushes followed by manual dismissals leaves
// orphaned timers resident in the event loop until they fire as no-op
// filters. Not a leak per se, but accumulates work and prevents tests/JSDOM
// from quiescing.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  pushToast: (message, variant = 'info', options = {}) => {
    const { key } = options;
    const existing = key === undefined ? undefined : get().toasts.find((t) => t.key === key);
    if (existing !== undefined) {
      // Same slot, new text: progress reads as one updating line, not a stack.
      clearTimeout(timers.get(existing.id));
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === existing.id ? { ...t, message, variant } : t)),
      }));
      scheduleDismiss(existing.id, variant, get);
      return;
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      toasts: [...s.toasts, { id, message, variant, ...(key === undefined ? {} : { key }) }],
    }));
    scheduleDismiss(id, variant, get);
  },
  dismissToast: (id) => {
    const handle = timers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  dismissToastKey: (key) => {
    const keyed = get().toasts.find((t) => t.key === key);
    if (keyed !== undefined) get().dismissToast(keyed.id);
  },
}));

function scheduleDismiss(id: string, variant: ToastVariant, get: () => ToastState): void {
  // Schedule auto-dismiss out of band — toast lifetime is decoupled from
  // React commit cycles so a fast burst of toasts doesn't extend each
  // other's lifetimes.
  const handle = setTimeout(() => {
    timers.delete(id);
    get().dismissToast(id);
  }, AUTO_DISMISS_MS[variant]);
  timers.set(id, handle);
}
