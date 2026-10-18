// Display-only operation colour hints (ADR-620). The workspace draws artwork
// in plain ink; these say when to show the colours anyway: the operation row
// the pointer is over (its artwork pulses on the canvas), and whether Alt is
// held (every operation colour at once). Session-only, never project data.

export type ArtworkColorHintState = {
  readonly hoveredOperationId: string | null;
  readonly setHoveredOperationId: (id: string | null) => void;
  /** Clear the row hover only if it is still this operation's (pointer moved on, row gone). */
  readonly releaseHoveredOperationId: (id: string) => void;
  readonly operationColorPeek: boolean;
  readonly setOperationColorPeek: (next: boolean) => void;
};

type ArtworkColorHintSetter = (
  partial:
    | Partial<ArtworkColorHintState>
    | ((state: ArtworkColorHintState) => Partial<ArtworkColorHintState>),
) => void;

export function artworkColorHintSlice(set: ArtworkColorHintSetter): ArtworkColorHintState {
  return {
    hoveredOperationId: null,
    setHoveredOperationId: (id) => set({ hoveredOperationId: id }),
    releaseHoveredOperationId: (id) =>
      set((state) => (state.hoveredOperationId === id ? { hoveredOperationId: null } : {})),
    operationColorPeek: false,
    setOperationColorPeek: (next) =>
      set((state) => (state.operationColorPeek === next ? {} : { operationColorPeek: next })),
  };
}
