// Toasts — transient non-blocking notifications used by the import / save /
// open flows (WORKFLOW.md F-A3, F-A7, F-A9, F-A11, F-A12). Kept in a
// dedicated Zustand store so neither the project slice nor the laser slice
// has to know about UI ephemera, and so the auto-dismiss timer doesn't sit
// inside React render code.
//
// Variants intentionally limited to four — anything richer than this (e.g.
// action buttons, "show details" expansion) belongs in a modal, not a toast.

import { create } from 'zustand';

const AUTO_DISMISS_MS = 3000;

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export type Toast = {
  readonly id: string;
  readonly message: string;
  readonly variant: ToastVariant;
};

type ToastState = {
  readonly toasts: ReadonlyArray<Toast>;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly dismissToast: (id: string) => void;
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  pushToast: (message, variant = 'info') => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    // Schedule auto-dismiss out of band — toast lifetime is decoupled from
    // React commit cycles so a fast burst of toasts doesn't extend each
    // other's lifetimes.
    setTimeout(() => get().dismissToast(id), AUTO_DISMISS_MS);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
