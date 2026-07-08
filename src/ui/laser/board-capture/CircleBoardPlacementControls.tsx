// CircleBoardPlacementControls — post-capture controls for a CIRCLE board
// (ADR-126). A circle's origin is its centre, so it offers a single Centre anchor
// (align + jog) rather than the rectangle's four corners, plus the shared fill
// controls. corners[0] is the captured centre machine coordinate.

import type { Vec2 } from '../../../core/scene';
import { Button } from '../../kit';
import { AnchorRow, FillBoardControls } from './BoardPlacementControls';
import { useBoardPlacement } from './use-board-placement';

export function CircleBoardPlacementControls(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly diameterMm: number;
  readonly feed: number;
  readonly disabled: boolean;
  readonly onReset: () => void;
}): JSX.Element {
  const { canAlign, canFit, alignToBox, fitToBoard, arrayToBoard, jogToPoint } = useBoardPlacement();
  const centre = props.corners[0];

  return (
    <div style={columnStyle}>
      <p style={measuredStyle}>
        Measured: ⌀ {props.diameterMm.toFixed(1)} mm — check against the physical board.
      </p>
      <p style={hintStyle}>Add your artwork, select it, then place it:</p>
      <AnchorRow label="Place artwork">
        <Button
          disabled={!canAlign}
          title={canAlign ? 'Move artwork to the centre of the board' : 'Select your artwork first'}
          onClick={() => alignToBox('center')}
        >
          Center
        </Button>
      </AnchorRow>
      <FillBoardControls canFit={canFit} onFit={fitToBoard} onArray={arrayToBoard} />
      <AnchorRow label="Jog head to">
        <Button
          disabled={props.disabled || centre === undefined}
          title="Move the head to the centre of the board"
          onClick={() =>
            centre !== undefined &&
            void jogToPoint(centre.x, centre.y, props.feed).catch(() => undefined)
          }
        >
          Center
        </Button>
      </AnchorRow>
      <Button variant="ghost" onClick={props.onReset}>
        Capture a new board
      </Button>
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
