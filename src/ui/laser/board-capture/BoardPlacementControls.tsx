// BoardPlacementControls — step 3 of Place board (ADR-124/126/636): with the
// board captured, place the artwork on it. One layout for every board shape:
// what was measured, the nine-point placement grid, Fit to board, Array on
// board, the physical corner checks, and starting over.

import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { Button, Icon, type IconName } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { BoardAnchorPicker } from './BoardAnchorPicker';
import { BoardArrayForm } from './BoardArrayForm';
import { BoardFitControls } from './BoardFitControls';
import { BoardVerificationControls } from './BoardVerificationControls';
import { useBoardPlacement } from './use-board-placement';
import type { BoardVerificationController } from './use-board-verification';

export function BoardPlacementControls(props: {
  readonly geometry: CapturedBoardGeometry;
  readonly disabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onReset: () => void;
}): JSX.Element {
  const { canAlign, canFit, placeOnBoard, fitToBoard, arrayToBoard, removeBoard } =
    useBoardPlacement();
  const locked = props.disabled || props.verification.activeTarget !== null;
  return (
    <>
      <BoardSummary geometry={props.geometry} />
      <div className="lf-place-board__card">
        <div className="lf-place-board__card-title">
          <span>Position artwork</span>
        </div>
        <BoardAnchorPicker shape={props.geometry.kind} canPlace={canAlign} onPlace={placeOnBoard} />
      </div>
      <details className="lf-section" open>
        <summary title="Scale or centre one design inside the board">Fit to board</summary>
        <div className="lf-section-body">
          <BoardFitControls disabled={!canFit} onFit={fitToBoard} />
        </div>
      </details>
      <details className="lf-section">
        <summary title="Tile copies of one design across the board">Fill with copies</summary>
        <div className="lf-section-body">
          <BoardArrayForm disabled={!canFit} onArray={arrayToBoard} />
        </div>
      </details>
      <details className="lf-section" open>
        <summary title="Move beam-off to board points and check them on the real board">
          Check the board
        </summary>
        <div className="lf-section-body">
          <BoardVerificationControls
            geometry={props.geometry}
            disabled={props.disabled}
            controller={props.verification}
          />
        </div>
      </details>
      <div className="lf-place-board__row lf-place-board__row--end">
        <Button variant="ghost" disabled={locked} onClick={props.onReset}>
          Capture a new board
        </Button>
        <Button
          variant="danger"
          disabled={locked}
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
    </>
  );
}

function BoardSummary({ geometry }: { readonly geometry: CapturedBoardGeometry }): JSX.Element {
  const { icon, name, size } = boardDescription(geometry);
  return (
    <div className="lf-place-board__card lf-place-board__card--accent">
      <div className="lf-place-board__card-title">
        <Icon name={icon} size={18} />
        <span>{name}</span>
        <span>locked · not burned</span>
      </div>
      <p>
        <strong>Measured: {size}</strong>
      </p>
      <p className="lf-place-board__muted">
        Check it against the physical board. Add your artwork, select it, then place it below.
      </p>
    </div>
  );
}

function boardDescription(geometry: CapturedBoardGeometry): {
  readonly icon: IconName;
  readonly name: string;
  readonly size: string;
} {
  switch (geometry.kind) {
    case 'rect':
      return {
        icon: 'square',
        name: 'Rectangular board',
        size: `${geometry.widthMm.toFixed(1)} × ${geometry.heightMm.toFixed(1)} mm`,
      };
    case 'circle':
      return {
        icon: 'circle',
        name: 'Round board',
        size: `⌀ ${(geometry.radiusMm * 2).toFixed(1)} mm`,
      };
    case 'polygon':
      return {
        icon: 'pentagon',
        name: `Custom shape · ${geometry.polygon.points.length} corners`,
        size: `${geometry.polygon.widthMm.toFixed(1)} × ${geometry.polygon.heightMm.toFixed(1)} mm`,
      };
  }
}

function boardSessionIsLocked(verification: BoardVerificationController): boolean {
  return verification.activeTarget !== null || useLaserStore.getState().motionOperation !== null;
}
