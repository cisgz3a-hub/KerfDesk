// PolygonCaptureSteps — capturing a custom-shape board (ADR-636): the operator
// walks around the board, jogging the head or pointer to each corner in turn
// and capturing it. From three corners the outline closes and shows its size;
// "Create board outline" sets the work origin at the front-left of the shape's
// bounding box (no head motion) and draws the locked outline.

import {
  MAX_BOARD_POLYGON_POINTS,
  MIN_BOARD_POLYGON_POINTS,
  type BoardPolygonResult,
  type Vec2,
} from '../../../core/scene';
import { Button } from '../../kit';
import { CaptureCard, type BoardSightView } from './CaptureCard';
import { MIN_BOARD_DIMENSION_MM } from './constants';
import { boardPolygonIssueMessage } from './board-capture-origin';

export function PolygonCaptureSteps(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly sight: BoardSightView;
  readonly polygon: BoardPolygonResult | null;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinish: () => void;
  readonly onReset: () => void;
}): JSX.Element {
  const count = props.corners.length;
  const full = count >= MAX_BOARD_POLYGON_POINTS;
  return (
    <CaptureCard
      title="Capture each corner"
      progress={count < MIN_BOARD_POLYGON_POINTS ? `${count} of ${MIN_BOARD_POLYGON_POINTS}+` : `${count} corners`}
      guidance={guidance(count, props.sight.aim)}
      points={props.corners}
      outline={count >= MIN_BOARD_POLYGON_POINTS ? 'closed' : 'path'}
      sight={props.sight}
      captureLabel="Capture corner"
      captureTitle={
        props.sight.aim === 'pointer'
          ? 'Record the corner under the pointer as the next corner of the outline.'
          : 'Record the head position as the next corner of the outline.'
      }
      complete={full}
      disabled={props.disabled}
      sessionDisabled={props.sessionDisabled}
      onCapture={props.onCapture}
      onUndo={props.onUndo}
      onReset={props.onReset}
    >
      {count > 0 && (
        <ol className="lf-place-board__corners" aria-label="Captured corners">
          {props.corners.map((corner, index) => (
            <li key={index} title={`X ${corner.x.toFixed(2)}  Y ${corner.y.toFixed(2)}`}>
              {index + 1}
            </li>
          ))}
        </ol>
      )}
      {count >= MIN_BOARD_POLYGON_POINTS && props.polygon !== null && (
        <PolygonSummary polygon={props.polygon} disabled={props.disabled} onFinish={props.onFinish} />
      )}
    </CaptureCard>
  );
}

function PolygonSummary(props: {
  readonly polygon: BoardPolygonResult;
  readonly disabled: boolean;
  readonly onFinish: () => void;
}): JSX.Element {
  if (props.polygon.kind === 'error') {
    return (
      <p role="alert" className="lf-place-board__message lf-place-board__message--notice">
        {boardPolygonIssueMessage(props.polygon.issue)}
      </p>
    );
  }
  const { widthMm, heightMm, areaMm2, reordered } = props.polygon.polygon;
  const tooSmall = widthMm < MIN_BOARD_DIMENSION_MM || heightMm < MIN_BOARD_DIMENSION_MM;
  return (
    <>
      <div className="lf-place-board__message lf-place-board__message--ok">
        Shape: {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm · {(areaMm2 / 100).toFixed(1)} cm²
      </div>
      {reordered && (
        <p className="lf-place-board__muted">
          The corners cross over in capture order, so they will be joined around the board instead.
          Check the map matches the board.
        </p>
      )}
      {tooSmall && (
        <p className="lf-place-board__message lf-place-board__message--notice">
          That&apos;s too small to be a board — the corners barely moved.
        </p>
      )}
      <p className="lf-place-board__muted">
        Creating the outline sets the work origin at the front-left of the shape without moving the
        head.
      </p>
      <Button variant="primary" disabled={tooSmall || props.disabled} onClick={props.onFinish}>
        Create board outline
      </Button>
    </>
  );
}

function guidance(count: number, aim: BoardSightView['aim']): string {
  const tool = aim === 'pointer' ? 'the pointer' : 'the head';
  if (count === 0) {
    return `Jog ${tool} to any corner of the board and capture it, then work your way around the edge, capturing each corner in order.`;
  }
  if (count < MIN_BOARD_POLYGON_POINTS) {
    return `Corner ${count + 1}: jog ${tool} to the next corner around the edge, then Capture.`;
  }
  return `Capture more corners in order around the edge, or create the outline when the map matches the board.`;
}
