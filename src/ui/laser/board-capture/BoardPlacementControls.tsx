// BoardPlacementControls — the Place Board page's post-capture pieces
// (ADR-124/126/636). Step 1 keeps the measured board, its physical checks and
// starting over; step 2 places the artwork: the nine-point grid, Fit to board
// and Fill with copies.

import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { Button, Icon, type IconName } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import { BoardAnchorPicker } from './BoardAnchorPicker';
import { BoardArrayForm } from './BoardArrayForm';
import { BoardFitControls } from './BoardFitControls';
import { BoardVerificationControls } from './BoardVerificationControls';
import { useBoardPlacement } from './use-board-placement';
import type { BoardVerificationController } from './use-board-verification';

/** Step 1 once the board exists: what was measured, its checks, start over. */
export function BoardPlacementControls(props: {
  readonly geometry: CapturedBoardGeometry;
  readonly disabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onReset: () => void;
}): JSX.Element {
  const { removeBoard } = useBoardPlacement();
  const locked = props.disabled || props.verification.activeTarget !== null;
  return (
    <>
      <BoardSummary geometry={props.geometry} />
      <BoardVerificationControls
        geometry={props.geometry}
        disabled={props.disabled}
        controller={props.verification}
      />
      <div className="lf-place-board__row">
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

/** Step 2: put the selected artwork on the board. */
export function BoardArtworkPlacement(props: {
  readonly shape: CapturedBoardGeometry['kind'];
}): JSX.Element {
  const { canAlign, canFit, placeOnBoard, fitToBoard, arrayToBoard } = useBoardPlacement();
  return (
    <>
      <div className="lf-place-board__card">
        <div className="lf-place-board__card-title">
          <span>Position artwork</span>
        </div>
        <BoardAnchorPicker shape={props.shape} canPlace={canAlign} onPlace={placeOnBoard} />
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
    </>
  );
}

export function BoardSummary({
  geometry,
}: {
  readonly geometry: CapturedBoardGeometry;
}): JSX.Element {
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
      <p className="lf-place-board__muted">Check it against the physical board.</p>
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
