// The pieces last found on the bed (ADR-442). A scan only proposes: nothing
// in the project changes until the operator places the selection on the
// pieces, and every piece can be left in or out first. Pieces the camera saw
// only in part start out left out, with the reason shown, because their
// centre and angle are not trustworthy; ticking one puts it back.

import { create } from 'zustand';
import type { DetectedPiece } from '../../../core/camera/pieces/find-pieces';

export type PieceScan = {
  readonly pieces: ReadonlyArray<DetectedPiece>;
  /** Indices of the pieces left out of the fill. */
  readonly excluded: ReadonlySet<number>;
};

type PieceScanStore = {
  readonly scan: PieceScan | null;
  readonly finding: boolean;
  readonly setFinding: (finding: boolean) => void;
  readonly setPieces: (pieces: ReadonlyArray<DetectedPiece>) => void;
  readonly toggleExcluded: (index: number) => void;
  readonly clear: () => void;
};

export const usePieceScanStore = create<PieceScanStore>((set) => ({
  scan: null,
  finding: false,
  setFinding: (finding) => set({ finding }),
  setPieces: (pieces) =>
    set({
      finding: false,
      scan: {
        pieces,
        excluded: new Set(pieces.flatMap((piece, index) => (piece.partial ? [index] : []))),
      },
    }),
  toggleExcluded: (index) =>
    set((s) => {
      if (s.scan === null) return {};
      const excluded = new Set(s.scan.excluded);
      if (excluded.has(index)) excluded.delete(index);
      else excluded.add(index);
      return { scan: { ...s.scan, excluded } };
    }),
  clear: () => set({ scan: null, finding: false }),
}));
