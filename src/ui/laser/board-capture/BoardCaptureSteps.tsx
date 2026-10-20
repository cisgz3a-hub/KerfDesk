// BoardCaptureSteps — capturing a rectangular board (ADR-124, ADR-636): the
// operator jogs to each corner and captures it. The front-left corner first
// is quickest (it sets the work origin straight away); any other corner first
// still works — the origin is moved to the front-left as the outline is made.
// Once all four corners are in, the measured rectangle is shown with an
// off-square warning before committing. One corner plus a typed size is the
// shortcut for stock of known dimensions.

import {
  BOARD_CORNER_COUNT,
  firstCornerOffsetMm,
  type BestFitRectangle,
  type Vec2,
} from '../../../core/scene';
import { Button } from '../../kit';
import { CaptureCard, type BoardSightView } from './CaptureCard';
import { MIN_BOARD_DIMENSION_MM } from './constants';
import { ManualSizeForm } from './ManualSizeForm';

// Above this the captured corners aren't a clean rectangle square to the bed
// (board rotated, or a corner mis-captured), so the drawn axis-aligned outline
// won't match the real board.
const OFF_SQUARE_WARN_MM = 5;
// Above this the first corner is a different corner from the front-left, so
// creating the outline also moves the work origin there (ADR-636).
const FIRST_CORNER_MOVE_MM = 5;

export function BoardCaptureSteps(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly sight: BoardSightView;
  readonly rect: BestFitRectangle | null;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinish: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onReset: () => void;
}): JSX.Element {
  const count = props.corners.length;
  const allCaptured = count >= BOARD_CORNER_COUNT;
  return (
    <CaptureCard
      title="Capture the corners"
      progress={`${Math.min(count, BOARD_CORNER_COUNT)} of ${BOARD_CORNER_COUNT}`}
      guidance={stepGuidance(count, allCaptured, props.sight.aim)}
      points={props.corners}
      sight={props.sight}
      captureLabel="Capture corner"
      captureTitle={
        props.sight.aim === 'pointer'
          ? 'Record the corner under the pointer.'
          : 'Record the head position at this corner.'
      }
      complete={allCaptured}
      disabled={props.disabled}
      sessionDisabled={props.sessionDisabled}
      onCapture={props.onCapture}
      onUndo={props.onUndo}
      onReset={props.onReset}
    >
      {allCaptured && props.rect !== null && (
        <MeasuredBoard
          rect={props.rect}
          corners={props.corners}
          signs={props.sight.signs}
          disabled={props.disabled}
          onFinish={props.onFinish}
        />
      )}
      {count >= 1 && !allCaptured && (
        <details className="lf-section">
          <summary title="Type the board width and height instead of capturing the other corners">
            Know the size? Type it instead
          </summary>
          <div className="lf-section-body">
            <ManualSizeForm disabled={props.disabled} onDraw={props.onManualSize} />
          </div>
        </details>
      )}
    </CaptureCard>
  );
}

function MeasuredBoard(props: {
  readonly rect: BestFitRectangle;
  readonly corners: ReadonlyArray<Vec2>;
  readonly signs: BoardSightView['signs'];
  readonly disabled: boolean;
  readonly onFinish: () => void;
}): JSX.Element {
  const { widthMm, heightMm, offSquareMm } = props.rect;
  const tooSmall = widthMm < MIN_BOARD_DIMENSION_MM || heightMm < MIN_BOARD_DIMENSION_MM;
  const firstCornerOffset = firstCornerOffsetMm(props.corners, props.signs);
  const movesOrigin =
    !tooSmall && firstCornerOffset !== null && firstCornerOffset > FIRST_CORNER_MOVE_MM;
  return (
    <>
      <div className="lf-place-board__message lf-place-board__message--ok">
        Board: {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm
      </div>
      {tooSmall ? (
        <p className="lf-place-board__message lf-place-board__message--notice">
          That&apos;s too small to be a board — the corners barely moved. Start over and jog to each
          corner.
        </p>
      ) : (
        offSquareMm > OFF_SQUARE_WARN_MM && (
          <p className="lf-place-board__message lf-place-board__message--notice">
            The corners aren&apos;t a clean rectangle square to the bed (off by{' '}
            {offSquareMm.toFixed(0)} mm) — the board may be rotated or a corner mis-captured, so the
            drawn size/orientation may not match. Straighten it square to the bed and recapture, use
            Custom shape for a board that is not rectangular, or continue if it looks right.
          </p>
        )
      )}
      {movesOrigin && (
        <p className="lf-place-board__muted">
          The first corner you captured wasn&apos;t the front-left one, so the work origin moves to
          the front-left corner when the outline is created.
        </p>
      )}
      <Button variant="primary" disabled={tooSmall || props.disabled} onClick={props.onFinish}>
        Create board outline
      </Button>
    </>
  );
}

function stepGuidance(count: number, allCaptured: boolean, aim: BoardSightView['aim']): string {
  const tool = aim === 'pointer' ? 'the pointer' : 'the head';
  if (allCaptured)
    return `All ${BOARD_CORNER_COUNT} corners captured. Check the size, then create the outline.`;
  if (count === 0) {
    return `Corner 1 of ${BOARD_CORNER_COUNT}: jog ${tool} to the front-left (bottom-left) corner, then Capture. This corner sets the work origin.`;
  }
  return `Corner ${count + 1} of ${BOARD_CORNER_COUNT}: jog ${tool} to another corner (any order), then Capture.`;
}
