import { outlineRegistration, type OutlineBoardGeometry } from '../../../core/scene';
import { Button } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { BoardArrayForm } from './BoardArrayForm';
import { BoardFitControls } from './BoardFitControls';
import { BoardVerificationControls } from './BoardVerificationControls';
import { useBoardPlacement } from './use-board-placement';
import type { BoardVerificationController } from './use-board-verification';

export function OutlineBoardPlacementControls(props: {
  readonly geometry: OutlineBoardGeometry;
  readonly disabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onReset: () => void;
}): JSX.Element {
  const { canFit, canArray, fitToBoard, arrayToBoard, removeBoard } = useBoardPlacement();
  const registration = outlineRegistration(props.geometry);
  const checked = props.geometry.measured.length;
  return (
    <div style={columnStyle}>
      <p style={statusStyle}>
        Checked {checked} of {props.geometry.anchorIndices.length} anchors
        {checked >= 3 && registration !== null
          ? ` — largest miss ${registration.maxResidualMm.toFixed(1)} mm`
          : ''}
      </p>
      {checked < props.geometry.anchorIndices.length && (
        <p style={hintStyle}>Check every anchor before you frame and burn.</p>
      )}
      <p style={hintStyle}>Add your artwork, select it, then fit or repeat it inside the board.</p>
      <BoardFitControls disabled={!canFit} onFit={fitToBoard} />
      <BoardArrayForm disabled={!canArray} onArray={arrayToBoard} />
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
          onClick={() => {
            if (useLaserStore.getState().motionOperation !== null) return;
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
const rowStyle: React.CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const statusStyle: React.CSSProperties = { ...hintStyle, fontWeight: 600 };
