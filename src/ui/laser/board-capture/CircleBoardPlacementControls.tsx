import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { Button } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { AnchorRow, FillBoardControls } from './BoardPlacementControls';
import { BoardVerificationControls } from './BoardVerificationControls';
import { useBoardPlacement } from './use-board-placement';
import type { BoardVerificationController } from './use-board-verification';

export function CircleBoardPlacementControls(props: {
  readonly geometry: Extract<CapturedBoardGeometry, { readonly kind: 'circle' }>;
  readonly disabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onReset: () => void;
}): JSX.Element {
  const { canAlign, canFit, alignToBox, fitToBoard, arrayToBoard, removeBoard } =
    useBoardPlacement();
  return (
    <div style={columnStyle}>
      <p style={measuredStyle}>
        Measured: ⌀ {(props.geometry.radiusMm * 2).toFixed(1)} mm — check against the physical
        board.
      </p>
      <p style={hintStyle}>Add your artwork, select it, then place it:</p>
      <AnchorRow label="Place artwork">
        <Button
          disabled={!canAlign}
          title={canAlign ? 'Move artwork to the center of the board' : 'Select your artwork first'}
          onClick={() => alignToBox('center')}
        >
          Center
        </Button>
      </AnchorRow>
      <FillBoardControls canFit={canFit} onFit={fitToBoard} onArray={arrayToBoard} />
      <BoardVerificationControls
        geometry={props.geometry}
        disabled={props.disabled}
        controller={props.verification}
      />
      <div style={footerStyle}>
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
            if (
              props.verification.activeTarget !== null ||
              useLaserStore.getState().motionOperation !== null
            ) {
              return;
            }
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

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const measuredStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.3,
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
};
