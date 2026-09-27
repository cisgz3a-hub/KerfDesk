// The pieces last found on the bed (ADR-442). A scan only proposes: nothing
// in the project changes until the operator places the selection on the
// pieces, and every piece can be left in or out first. Pieces the camera saw
// only in part start out left out, with the reason shown, because their
// centre and angle are not trustworthy; ticking one puts it back.

import { create } from 'zustand';
import type { DetectedPiece } from '../../../core/camera/pieces/find-pieces';
import { pieceScanContext, watchPieceScanContext } from './piece-scan-context';

export type PieceScan = {
  readonly pieces: ReadonlyArray<DetectedPiece>;
  /** Indices of the pieces left out of the fill. */
  readonly excluded: ReadonlySet<number>;
};

type PieceScanStore = {
  readonly scan: PieceScan | null;
  readonly finding: boolean;
  readonly request: PieceFindRequest | null;
  readonly beginFind: () => PieceFindRequest;
  readonly ownsFind: (request: PieceFindRequest) => boolean;
  readonly cancelFind: (request: PieceFindRequest) => void;
  readonly finishFind: (request: PieceFindRequest, pieces: ReadonlyArray<DetectedPiece>) => void;
  readonly setPieces: (pieces: ReadonlyArray<DetectedPiece>) => void;
  readonly toggleExcluded: (index: number) => void;
  readonly clear: () => void;
};

export type PieceFindRequest = { readonly isCurrent: () => boolean };

export const usePieceScanStore = create<PieceScanStore>((set, get) => {
  let releaseContext = (): void => undefined;
  const release = (): void => {
    releaseContext();
    releaseContext = () => undefined;
  };
  const clear = (): void => {
    release();
    set({ scan: null, finding: false, request: null });
  };
  const beginFind = (): PieceFindRequest => {
    release();
    const request = { isCurrent: pieceScanContext() };
    releaseContext = watchPieceScanContext(request.isCurrent, clear);
    set({ finding: true, request });
    return request;
  };
  const ownsFind = (request: PieceFindRequest): boolean =>
    get().request === request && request.isCurrent();
  const finishFind = (request: PieceFindRequest, pieces: ReadonlyArray<DetectedPiece>): void => {
    if (!ownsFind(request)) return;
    set({
      request: null,
      finding: false,
      scan: {
        pieces,
        excluded: new Set(pieces.flatMap((piece, index) => (piece.partial ? [index] : []))),
      },
    });
  };
  return {
    scan: null,
    finding: false,
    request: null,
    beginFind,
    ownsFind,
    finishFind,
    cancelFind: (request) => {
      if (get().request !== request) return;
      set({ request: null, finding: false });
      if (get().scan === null) release();
    },
    setPieces: (pieces) => finishFind(beginFind(), pieces),
    toggleExcluded: (index) =>
      set((s) => {
        if (s.scan === null) return {};
        const excluded = new Set(s.scan.excluded);
        if (excluded.has(index)) excluded.delete(index);
        else excluded.add(index);
        return { scan: { ...s.scan, excluded } };
      }),
    clear,
  };
});
