// BoardPlacementControls — post-capture controls for a RECTANGLE board
// (ADR-124): move the selected artwork onto a corner/centre, fill the board
// (fit/array), and jog the head to a board point. The circle equivalent is
// CircleBoardPlacementControls; both share the placement gating
// (useBoardPlacement) and the FillBoardControls / AnchorRow parts exported here.

import {
  bestFitRectangleFromCorners,
  boardMachinePoints,
  type BoardAnchor,
  type TileLayout,
  type Vec2,
} from '../../../core/scene';
import { Button } from '../../kit';
import { BoardArrayForm } from './BoardArrayForm';
import { useBoardPlacement } from './use-board-placement';

const ANCHORS: ReadonlyArray<{ readonly anchor: BoardAnchor; readonly label: string }> = [
  { anchor: 'center', label: 'Center' },
  { anchor: 'bottom-left', label: 'Btm-left' },
  { anchor: 'bottom-right', label: 'Btm-right' },
  { anchor: 'top-left', label: 'Top-left' },
  { anchor: 'top-right', label: 'Top-right' },
];

export function BoardPlacementControls(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly feed: number;
  readonly disabled: boolean;
  readonly onReset: () => void;
}): JSX.Element {
  const { canAlign, canFit, alignToBox, fitToBoard, arrayToBoard, removeBoard, jogToPoint } =
    useBoardPlacement();
  const points = boardMachinePoints(props.corners);
  const measured = bestFitRectangleFromCorners(props.corners);

  return (
    <div style={columnStyle}>
      {measured !== null && (
        <p style={measuredStyle}>
          Measured: {measured.widthMm.toFixed(1)} × {measured.heightMm.toFixed(1)} mm — check
          against the physical board.
        </p>
      )}
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
      <AnchorRow label="Jog head to">
        {ANCHORS.map(({ anchor, label }) => {
          const point = points?.[anchor];
          return (
            <Button
              key={anchor}
              disabled={props.disabled || point === undefined}
              title={`Move the head to the ${label} of the board`}
              onClick={() =>
                point !== undefined &&
                void jogToPoint(point.x, point.y, props.feed).catch(() => undefined)
              }
            >
              {label}
            </Button>
          );
        })}
      </AnchorRow>
      <div style={rowStyle}>
        <Button variant="ghost" onClick={props.onReset}>
          Capture a new board
        </Button>
        <Button
          variant="danger"
          title="Delete this board outline"
          onClick={() => {
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

// The "fill the board" operations — scale one design to fill it (A1) or tile
// copies across it (A2). Both need exactly one selected design, so they share
// the `canFit` gate. Exported for the circle placement controls too.
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
