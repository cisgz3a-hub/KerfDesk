// Lock Guidelines (LightBurn): while locked, guides can be neither pulled out
// of the rulers nor moved. Session chrome, like the wireframe view.

import { create } from 'zustand';

type GuideLockState = {
  readonly locked: boolean;
  readonly toggle: () => void;
};

export const useGuideLockStore = create<GuideLockState>((set) => ({
  locked: false,
  toggle: () => set((state) => ({ locked: !state.locked })),
}));
