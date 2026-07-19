import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';

export type CncLiveCapsState = {
  // Transient controller observation used only when deriving future automatic
  // settings. It is never serialized and never rewrites an existing layer.
  readonly cncLiveCaps: CncMachineStarterLiveCaps | null;
};

export type CncLiveCapsActions = {
  readonly setCncLiveCaps: (caps: CncMachineStarterLiveCaps | null) => void;
};

type Setter = (patch: Partial<CncLiveCapsState>) => void;

export function cncLiveCapsActions(set: Setter): CncLiveCapsActions {
  return {
    setCncLiveCaps: (cncLiveCaps) => set({ cncLiveCaps }),
  };
}
