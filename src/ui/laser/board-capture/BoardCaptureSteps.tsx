// BoardCaptureSteps — the capture phase of the board-capture panel (ADR-124):
// guides the operator (bottom-left first — it sets the work origin — then the
// other three corners in any order), shows the live head position, and — once
// all four corners are in — the measured rectangle with an off-square warning
// before committing.

import {
  BOARD_CORNER_COUNT,
  firstCornerOffsetMm,
  type BestFitRectangle,
  type Vec2,
} from '../../../core/scene';
import { Button } from '../../kit';
import { MIN_BOARD_DIMENSION_MM } from './constants';
import { ManualSizeForm } from './ManualSizeForm';

// Above this the captured corners aren't a clean rectangle square to the bed
// (board rotated, or a corner mis-captured), so the drawn axis-aligned outline
// won't match the real board.
const OFF_SQUARE_WARN_MM = 5;
// Above this the FIRST captured corner is too far from the board's bottom-left,
// so the G92 work origin (set at the first corner) sits at the wrong corner —
// the outline looks right but the burn is offset. See ADR-124.
const FIRST_CORNER_WARN_MM = 5;

export function BoardCaptureSteps(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly livePosition: Vec2 | null;
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
    <div style={columnStyle}>
      <p style={stepStyle}>{stepGuidance(count, allCaptured)}</p>
      <LivePositionRow position={props.livePosition} />
      <div style={buttonRowStyle}>
        <Button
          variant="primary"
          disabled={props.disabled || props.livePosition === null || allCaptured}
          title={
            props.livePosition === null
              ? 'Waiting for a live machine position (connect and wait for Idle).'
              : 'Record the head position at this corner.'
          }
          onClick={props.onCapture}
        >
          Capture corner
        </Button>
        <Button
          variant="ghost"
          disabled={props.sessionDisabled || count === 0}
          onClick={props.onUndo}
        >
          Undo last
        </Button>
        {count > 0 && (
          <Button variant="ghost" disabled={props.sessionDisabled} onClick={props.onReset}>
            Start over
          </Button>
        )}
      </div>
      {allCaptured && props.rect !== null && (
        <MeasuredBoard
          rect={props.rect}
          corners={props.corners}
          disabled={props.disabled}
          onFinish={props.onFinish}
        />
      )}
      {count >= 1 && !allCaptured && (
        <ManualSizeForm disabled={props.disabled} onDraw={props.onManualSize} />
      )}
    </div>
  );
}

function LivePositionRow({ position }: { readonly position: Vec2 | null }): JSX.Element {
  return (
    <div style={liveStyle}>
      <strong>Head:</strong>{' '}
      {position === null
        ? 'waiting for position…'
        : `X ${position.x.toFixed(1)} Y ${position.y.toFixed(1)}`}
    </div>
  );
}

function MeasuredBoard(props: {
  readonly rect: BestFitRectangle;
  readonly corners: ReadonlyArray<Vec2>;
  readonly disabled: boolean;
  readonly onFinish: () => void;
}): JSX.Element {
  const { widthMm, heightMm, offSquareMm } = props.rect;
  const tooSmall = widthMm < MIN_BOARD_DIMENSION_MM || heightMm < MIN_BOARD_DIMENSION_MM;
  const firstCornerOffset = firstCornerOffsetMm(props.corners);
  const wrongFirstCorner =
    !tooSmall && firstCornerOffset !== null && firstCornerOffset > FIRST_CORNER_WARN_MM;
  return (
    <div style={columnStyle}>
      <div style={measureStyle}>
        Board: {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm
      </div>
      {tooSmall ? (
        <p style={warnStyle}>
          That&apos;s too small to be a board — the corners barely moved. Start over and jog to each
          corner.
        </p>
      ) : (
        offSquareMm > OFF_SQUARE_WARN_MM && (
          <p style={warnStyle}>
            The corners aren&apos;t a clean rectangle square to the bed (off by{' '}
            {offSquareMm.toFixed(0)} mm) — the board may be rotated or a corner mis-captured, so the
            drawn size/orientation may not match. Straighten it square to the bed and recapture, or
            continue if it looks right.
          </p>
        )
      )}
      {wrongFirstCorner && (
        <p style={warnStyle}>
          The first corner you captured wasn&apos;t the bottom-left, so the work origin — and the
          burn — is set at the wrong corner. Start over and capture the bottom-left corner first.
        </p>
      )}
      <Button variant="primary" disabled={tooSmall || props.disabled} onClick={props.onFinish}>
        Create board outline
      </Button>
    </div>
  );
}

function stepGuidance(count: number, allCaptured: boolean): string {
  if (allCaptured) return `All ${BOARD_CORNER_COUNT} corners captured.`;
  if (count === 0) {
    return `Corner 1 of ${BOARD_CORNER_COUNT}: jog to the bottom-left corner, then Capture. This corner sets the work origin.`;
  }
  return `Corner ${count + 1} of ${BOARD_CORNER_COUNT}: jog to another corner (any order), then Capture.`;
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const stepStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const liveStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};
const measureStyle: React.CSSProperties = { fontWeight: 600 };
const warnStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-warning-fg)',
};
