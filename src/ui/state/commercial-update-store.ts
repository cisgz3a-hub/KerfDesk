// The desktop app's own update status (ADR-547), published by
// CommercialUpdates inside the licensed edition and read by the status bar's
// Update ready button. A dedicated Zustand slice keeps the two decoupled, as
// pwa-update-store does for the web app. Null in the web app and until the
// main process first answers.

import { create } from 'zustand';
import type { CommercialUpdateStatus } from '../../platform/types';

type CommercialUpdateState = {
  readonly status: CommercialUpdateStatus | null;
  readonly setStatus: (status: CommercialUpdateStatus | null) => void;
};

export const useCommercialUpdateStore = create<CommercialUpdateState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));
