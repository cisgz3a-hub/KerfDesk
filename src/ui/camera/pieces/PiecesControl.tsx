// PiecesControl — the Camera panel's "Pieces on the bed" section (ADR-442).
// Find pieces photographs the bed and outlines every separate piece on the
// canvas; each piece can be left in or out; Place selection on each piece
// repeats the selected design on every piece left in, as one undo step. When
// the design already sits on one piece, every copy lands on its piece the
// same way; otherwise the design is centred on each piece. Nothing changes
// in the project until Place.

import { useMemo, useState } from 'react';
import type { DetectedPiece } from '../../../core/camera/pieces/find-pieces';
import {
  pieceUnder,
  placementOn,
  piecePlacements,
  type DesignFrame,
} from '../../../core/camera/pieces/piece-placements';
import { useStore } from '../../state';
import { pieceMoveLabel, pieceNotes, pieceSizeLabel } from './piece-label';
import { usePieceScanStore, type PieceScan } from './piece-scan-store';
import { selectionFrame } from './selection-frame';
import { useFindPieces } from './use-find-pieces';

export function PiecesControl(): JSX.Element {
  const scan = usePieceScanStore((s) => s.scan);
  const finding = usePieceScanStore((s) => s.finding);
  const clear = usePieceScanStore((s) => s.clear);
  const search = useFindPieces();
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const design = useMemo(
    () => selectionFrame(project, selectedObjectId, additionalSelectedIds),
    [project, selectedObjectId, additionalSelectedIds],
  );
  const [message, setMessage] = useState<string | null>(null);

  const find = (): void => {
    setMessage(null);
    void search.find();
  };

  return (
    <div style={sectionStyle} data-testid="camera-pieces">
      <div style={headerStyle}>
        <span>Pieces on the bed</span>
        <span style={buttonsStyle}>
          {scan === null ? null : (
            <button type="button" className="lf-btn" onClick={clear}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="lf-btn"
            disabled={!search.available || finding}
            onClick={find}
            title="Photograph the bed and outline every separate piece on it: blanks, offcuts, coasters."
          >
            {finding ? 'Finding pieces…' : 'Find pieces'}
          </button>
        </span>
      </div>
      {scan === null ? (
        <div style={hintStyle}>
          Lay out your blanks, put the design on one of them, select it and find the pieces. The
          design can then be placed on every piece the same way.
        </div>
      ) : (
        <FoundPieces scan={scan} design={design} onPlaced={setMessage} />
      )}
      {message === null ? null : (
        <div role="status" style={hintStyle}>
          {message}
        </div>
      )}
    </div>
  );
}

function FoundPieces(props: {
  readonly scan: PieceScan;
  readonly design: DesignFrame | null;
  readonly onPlaced: (message: string) => void;
}): JSX.Element {
  const { scan, design } = props;
  const toggle = usePieceScanStore((s) => s.toggleExcluded);
  const sample = design === null ? null : pieceUnder(scan.pieces, design.centre);
  const included = scan.pieces.filter((_, index) => !scan.excluded.has(index));

  const place = (): void => {
    const state = useStore.getState();
    const current = selectionFrame(
      state.project,
      state.selectedObjectId,
      state.additionalSelectedIds,
    );
    if (current === null) {
      props.onPlaced('Select the design to place first.');
      return;
    }
    if (included.length === 0) {
      props.onPlaced('Tick the pieces to place the design on.');
      return;
    }
    const placements = piecePlacements({
      pieces: included,
      design: current,
      sample: pieceUnder(scan.pieces, current.centre),
    });
    state.placeSelectionCopies(placements, state.project);
    props.onPlaced(
      `Placed on ${included.length} ${included.length === 1 ? 'piece' : 'pieces'}. One Undo takes them all back. Frame traces the rectangle around all of them, not each piece.`,
    );
  };

  if (scan.pieces.length === 0) {
    return (
      <div style={hintStyle}>
        No pieces found. Pieces need to stand out from the bed by colour or brightness; a design
        selected on a piece helps tell them apart by colour.
      </div>
    );
  }
  return (
    <>
      <div style={hintStyle}>
        Found {scan.pieces.length} {scan.pieces.length === 1 ? 'piece' : 'pieces'}.{' '}
        {sample === null
          ? 'The design is centred on each piece, long side along the long side.'
          : 'Each copy lands on its piece the way the design sits on its own.'}
      </div>
      {scan.pieces.map((piece, index) => (
        <PieceRow
          key={index}
          index={index}
          piece={piece}
          included={!scan.excluded.has(index)}
          sample={sample}
          design={design}
          onToggle={() => toggle(index)}
        />
      ))}
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={place}
          title="Repeat the selected design on every ticked piece, as one undo step."
        >
          Place selection on each piece
        </button>
      </div>
    </>
  );
}

function PieceRow(props: {
  readonly index: number;
  readonly piece: DetectedPiece;
  readonly included: boolean;
  readonly sample: DetectedPiece | null;
  readonly design: DesignFrame | null;
  readonly onToggle: () => void;
}): JSX.Element {
  const { piece } = props;
  const notes = pieceNotes(piece, props.sample);
  return (
    <div style={pieceStyle} data-testid="camera-piece">
      <label style={lineStyle}>
        <input type="checkbox" checked={props.included} onChange={props.onToggle} />
        <strong>Piece {props.index + 1}</strong>
        <span>{pieceSizeLabel(piece)}</span>
      </label>
      {props.design === null ? null : (
        <div style={detailStyle}>
          {pieceMoveLabel(placementOn(piece, props.design, props.sample))}
        </div>
      )}
      {notes.map((note) => (
        <div key={note} style={noteStyle}>
          {note}
        </div>
      ))}
    </div>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const buttonsStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const hintStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const pieceStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '4px 8px',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  fontSize: 12,
};
const lineStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
const detailStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-faint)',
  paddingLeft: 22,
};
const noteStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-warning-fg)',
  paddingLeft: 22,
};
