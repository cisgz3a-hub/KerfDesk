// PWA update readiness, published by PwaUpdateWatcher (ui/app) and consumed by
// the status-bar Update button (ui/common) — ADR-227. A dedicated Zustand slice
// keeps the service-worker watcher and the status bar decoupled: neither knows
// the other exists. The `ready` variant carries the apply callback because only
// the watcher owns the plugin's updateServiceWorker handle; the button just
// invokes whatever it was handed.

import { create } from 'zustand';

export type PwaUpdateAvailability =
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly applyUpdate: () => Promise<void> };

type PwaUpdateState = {
  readonly availability: PwaUpdateAvailability;
  readonly setAvailability: (availability: PwaUpdateAvailability) => void;
};

export const usePwaUpdateStore = create<PwaUpdateState>((set) => ({
  availability: { kind: 'none' },
  setAvailability: (availability) => set({ availability }),
}));
