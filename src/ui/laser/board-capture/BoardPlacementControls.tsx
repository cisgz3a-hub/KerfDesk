import type { BoardAnchor, TileLayout } from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { Button } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { BoardArrayForm } from './BoardArrayForm';
import { BoardVerificationControls } from './BoardVerificationControls';
import { useBoardPlacement } from './use-board-placement';
import type { BoardVerificationController } from './use-board-verification';

const ANCHORS: ReadonlyArray<{ readonly anchor: BoardAnchor; readonly label: string }> = [
  { anchor: 'center', label: 'Center' },
  { anchor: 'bottom-left', label: 'Btm-left' },
  { anchor: 'bottom-right', label: 'Btm-right' },
  { anchor: 'top-left', label: 'Top-left' },
  { anchor: 'top-right', label: 'Top-right' },
];

export function BoardPlacementControls(props: {
  readonly geometry: Extract<CapturedBoardGeometry, { readonly kind: 'rect' }>;
  readonly disabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onReset: () => void;
}): JSX.Element {
  const { canAlign, canFit, alignToBox, fitToBoard, arrayToBoard, removeBoard } =
    useBoardPlacement();
  return (
    <div style={columnStyle}>
      <p style={measuredStyle}>
        Measured: {props.geometry.widthMm.toFixed(1)} × {props.geometry.heightMm.toFixed(1)} mm —
        check against the physical board.
      </p>
      <p style={hintStyle}>Add your artwork, select it, then place it:</p>
      <AnchorRow label="Place artwork">
        {ANCHORS.map(({ anchor, label }) => (
          <Button
            key={anchor}
            disabled={!canAlign}
            title={
              canAlign ? `Move artwork to the ${label} of the board` : 'Select your artwork first'
            }
            onClick={() => alignToBox(anchor)}
          >
            {label}
          </Button>
        ))}
      </AnchorRow>
      <FillBoardControls canFit={canFit} onFit={fitToBoard} onArray={arrayToBoard} />
      <BoardVerificationControls
        geometry={props.geometry}
        disabled={props.disabled}
        controller={props.verification}
      />
      <div style={rowStyle}>
        <Button
          variant="ghost"
          disabled={props.disabled || props.verification.activeTarget !== null}
          onClick={props.onReset}
        >
          Capture a new board
        </Button>
        <Button
          variant="danger"
          disabled={props.disabled || props.verification.activeTarget !== null}
          title="Delete this board outline"
          onClick={() => {
            if (boardSessionIsLocked(props.verification)) return;
            removeBoard();
            props.onReset();
          }}
        >
          Remove board
        </Button>
      </div>
    </div>
  );
}

function boardSessionIsLocked(verification: BoardVerificationController): boolean {
  return verification.activeTarget !== null || useLaserStore.getState().motionOperation !== null;
}

export function FillBoardControls(props: {
  readonly canFit: boolean;
  readonly onFit: () => void;
  readonly onArray: (layout: TileLayout) => void;
}): JSX.Element {
  return (
    <>
      <AnchorRow label="Fill board">
        <Button
          disabled={!props.canFit}
          title={
            props.canFit
              ? 'Scale the selected design to fill the board'
              : 'Select exactly one design to fit to the board'
          }
          onClick={props.onFit}
        >
          Fit to board
        </Button>
      </AnchorRow>
      <BoardArrayForm disabled={!props.canFit} onArray={props.onArray} />
    </>
  );
}

export function AnchorRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}:</span>
      {props.children}
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const measuredStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.3,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
};
const labelStyle: React.CSSProperties = { fontWeight: 600, marginRight: 2 };
