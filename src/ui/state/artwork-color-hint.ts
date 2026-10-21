// Display-only operation colour hints (ADR-620). The workspace draws artwork
// in plain ink; these say when to show the colours anyway: the operation row
// the pointer is over (its artwork pulses on the canvas), the settings being
// edited (the artwork they change lights up, ADR-646), and whether Alt is held
// (every operation colour at once). Session-only, never project data.

/** The artwork a settings edit changes, and the operations whose colour it lights up in. */
export type EditedArtwork = {
  /** Which editor holds it, so one editor losing focus never clears another's. */
  readonly owner: string;
  readonly objectIds: ReadonlyArray<string>;
  readonly operationIds: ReadonlyArray<string>;
};

export type ArtworkColorHintState = {
  readonly hoveredOperationId: string | null;
  readonly setHoveredOperationId: (id: string | null) => void;
  /** Clear the row hover only if it is still this operation's (pointer moved on, row gone). */
  readonly releaseHoveredOperationId: (id: string) => void;
  readonly editedArtwork: EditedArtwork | null;
  readonly setEditedArtwork: (next: EditedArtwork) => void;
  /** Clear the edit only if this editor still holds it. */
  readonly releaseEditedArtwork: (owner: string) => void;
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
    editedArtwork: null,
    // The same edit set again keeps its object, so the canvas does not regroup.
    // Any other is a new object, even if equal to one released before: the
    // canvas tells an edit that began again from one that never ended by it.
    setEditedArtwork: (next) =>
      set((state) =>
        state.editedArtwork !== null &&
        editedArtworkKey(state.editedArtwork) === editedArtworkKey(next)
          ? {}
          : { editedArtwork: { ...next } },
      ),
    releaseEditedArtwork: (owner) =>
      set((state) => (state.editedArtwork?.owner === owner ? { editedArtwork: null } : {})),
    operationColorPeek: false,
    setOperationColorPeek: (next) =>
      set((state) => (state.operationColorPeek === next ? {} : { operationColorPeek: next })),
  };
}

function editedArtworkKey(edit: EditedArtwork): string {
  return JSON.stringify([edit.owner, edit.objectIds, edit.operationIds]);
}
