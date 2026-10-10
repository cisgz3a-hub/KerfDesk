// The desktop app's own update status (ADR-547), published by
// CommercialUpdates inside the licensed edition and read by the status bar's
// Update ready button and the canvas update prompt. A dedicated Zustand slice
// keeps them decoupled, as pwa-update-store does for the web app. Null in the
// web app and until the main process first answers.

import { create } from 'zustand';
import type { CommercialUpdateStatus } from '../../platform/types';

type UpdateAction = (() => Promise<void>) | undefined;

/** The update owner's actions for the canvas prompt (ADR-561 Amendment 5). */
export type CommercialUpdateControls = {
  readonly busy: boolean;
  readonly feedback: string | null;
  /** Help > Check for Updates is showing, so the prompt stands aside. */
  readonly panelOpen: boolean;
  readonly download: UpdateAction;
  readonly installOnQuit: UpdateAction;
  readonly installAndClose: UpdateAction;
};

type CommercialUpdateState = {
  readonly status: CommercialUpdateStatus | null;
  readonly setStatus: (status: CommercialUpdateStatus | null) => void;
  /** Null without a desktop update owner, as in the web app. */
  readonly controls: CommercialUpdateControls | null;
  readonly setControls: (controls: CommercialUpdateControls | null) => void;
};

export const useCommercialUpdateStore = create<CommercialUpdateState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  controls: null,
  setControls: (controls) => set({ controls }),
}));
