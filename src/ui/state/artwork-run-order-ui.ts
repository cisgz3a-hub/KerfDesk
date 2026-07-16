export type ArtworkRunFocus = {
  readonly objectIds: ReadonlyArray<string>;
  readonly position: number;
  readonly color: string;
};

export type ArtworkNumberingState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'active';
      readonly nextPosition: number;
      readonly assignedUnitKeys: ReadonlyArray<string>;
      readonly orderHistory: ReadonlyArray<ReadonlyArray<string>>;
      readonly focusHistory: ReadonlyArray<ArtworkRunFocus>;
    };

export type ArtworkRunOrderUiState = {
  readonly artworkRunFocus: ArtworkRunFocus | null;
  readonly setArtworkRunFocus: (focus: ArtworkRunFocus | null) => void;
  readonly artworkNumbering: ArtworkNumberingState;
  readonly startArtworkNumbering: (initialOrder: ReadonlyArray<string>) => void;
  readonly recordArtworkNumbering: (
    unitKey: string,
    order: ReadonlyArray<string>,
    focus: ArtworkRunFocus,
  ) => void;
  readonly undoArtworkNumbering: () => void;
  readonly finishArtworkNumbering: () => void;
};

type ArtworkRunOrderSetter = (
  partial:
    | Partial<ArtworkRunOrderUiState>
    | ((state: ArtworkRunOrderUiState) => Partial<ArtworkRunOrderUiState>),
) => void;

export function artworkRunOrderUiSlice(set: ArtworkRunOrderSetter): ArtworkRunOrderUiState {
  return {
    artworkRunFocus: null,
    setArtworkRunFocus: (focus) => set({ artworkRunFocus: focus }),
    artworkNumbering: { kind: 'idle' },
    startArtworkNumbering: (initialOrder) =>
      set({
        artworkNumbering: {
          kind: 'active',
          nextPosition: 1,
          assignedUnitKeys: [],
          orderHistory: [[...initialOrder]],
          focusHistory: [],
        },
      }),
    recordArtworkNumbering: (unitKey, order, focus) =>
      set((state) => {
        if (state.artworkNumbering.kind !== 'active') return {};
        return {
          artworkRunFocus: focus,
          artworkNumbering: {
            ...state.artworkNumbering,
            nextPosition: state.artworkNumbering.nextPosition + 1,
            assignedUnitKeys: [...state.artworkNumbering.assignedUnitKeys, unitKey],
            orderHistory: [...state.artworkNumbering.orderHistory, [...order]],
            focusHistory: [...state.artworkNumbering.focusHistory, focus],
          },
        };
      }),
    undoArtworkNumbering: () =>
      set((state) => {
        if (
          state.artworkNumbering.kind !== 'active' ||
          state.artworkNumbering.assignedUnitKeys.length === 0
        ) {
          return {};
        }
        const assignedUnitKeys = state.artworkNumbering.assignedUnitKeys.slice(0, -1);
        const orderHistory = state.artworkNumbering.orderHistory.slice(0, -1);
        const focusHistory = state.artworkNumbering.focusHistory.slice(0, -1);
        return {
          artworkRunFocus: focusHistory.at(-1) ?? null,
          artworkNumbering: {
            ...state.artworkNumbering,
            nextPosition: Math.max(1, state.artworkNumbering.nextPosition - 1),
            assignedUnitKeys,
            orderHistory,
            focusHistory,
          },
        };
      }),
    finishArtworkNumbering: () => set({ artworkNumbering: { kind: 'idle' } }),
  };
}
