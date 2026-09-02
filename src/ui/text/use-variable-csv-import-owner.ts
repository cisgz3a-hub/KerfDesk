import { create } from 'zustand';
import { assertNever } from '../../core/scene';

/** Immutable ownership evidence for one CSV picker invocation. */
export type VariableCsvImportClaim = {
  readonly ownerId: symbol;
  readonly requestEpoch: number;
  readonly projectDocumentEpoch: number;
};

type VariableCsvImportOwner =
  | { readonly kind: 'idle'; readonly requestEpoch: number }
  | { readonly kind: 'active'; readonly requestEpoch: number; readonly ownerId: symbol };

type VariableCsvImportOwnerStore = {
  readonly owner: VariableCsvImportOwner;
  readonly claim: (ownerId: symbol, projectDocumentEpoch: number) => VariableCsvImportClaim;
  readonly retire: (ownerId: symbol) => void;
};

/** Coordinates the newest active CSV picker across mounted variable-text controls. */
export const useVariableCsvImportOwner = create<VariableCsvImportOwnerStore>((set, get) => ({
  owner: { kind: 'idle', requestEpoch: 0 },
  claim: (ownerId, projectDocumentEpoch) => {
    const requestEpoch = get().owner.requestEpoch + 1;
    set({ owner: { kind: 'active', ownerId, requestEpoch } });
    return { ownerId, requestEpoch, projectDocumentEpoch };
  },
  retire: (ownerId) => set((state) => retireOwner(state.owner, ownerId)),
}));

/** Returns whether a claim still owns the current document's CSV import completion. */
export function isVariableCsvImportClaimCurrent(
  claim: VariableCsvImportClaim,
  projectDocumentEpoch: number,
): boolean {
  const owner = useVariableCsvImportOwner.getState().owner;
  switch (owner.kind) {
    case 'idle':
      return false;
    case 'active':
      return (
        owner.ownerId === claim.ownerId &&
        owner.requestEpoch === claim.requestEpoch &&
        projectDocumentEpoch === claim.projectDocumentEpoch
      );
    default:
      return assertNever(owner, 'VariableCsvImportOwner');
  }
}

function retireOwner(
  owner: VariableCsvImportOwner,
  ownerId: symbol,
): Partial<VariableCsvImportOwnerStore> {
  switch (owner.kind) {
    case 'idle':
      return {};
    case 'active':
      return owner.ownerId === ownerId
        ? { owner: { kind: 'idle', requestEpoch: owner.requestEpoch + 1 } }
        : {};
    default:
      return assertNever(owner, 'VariableCsvImportOwner');
  }
}
