// BoardCapturePhase — chooses the right capture / placement sub-panel for the
// current shape + committed state (ADR-126), keeping BoardCapturePanel small.
// Committed → placement controls (rect corners or circle centre); in progress →
// the shape-specific capture steps.

import type { BestFitRectangle, BoardShapeKind, Vec2 } from '../../../core/scene';
import { BoardCaptureSteps } from './BoardCaptureSteps';
import { BoardPlacementControls } from './BoardPlacementControls';
import { CircleBoardPlacementControls } from './CircleBoardPlacementControls';
import { CircleCaptureSteps } from './CircleCaptureSteps';

export function BoardCapturePhase(props: {
  readonly committed: boolean;
  readonly shapeKind: BoardShapeKind;
  readonly corners: ReadonlyArray<Vec2>;
  readonly circleDiameter: number | null;
  readonly rect: BestFitRectangle | null;
  readonly livePosition: Vec2 | null;
  readonly disabled: boolean;
  readonly feed: number;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishCircle: (diameterMm: number) => void;
  readonly onReset: () => void;
}): JSX.Element {
  if (props.committed) {
    return props.circleDiameter !== null ? (
      <CircleBoardPlacementControls
        corners={props.corners}
        diameterMm={props.circleDiameter}
        feed={props.feed}
        disabled={props.disabled}
        onReset={props.onReset}
      />
    ) : (
      <BoardPlacementControls
        corners={props.corners}
        feed={props.feed}
        disabled={props.disabled}
        onReset={props.onReset}
      />
    );
  }
  if (props.shapeKind === 'circle') {
    return (
      <CircleCaptureSteps
        corners={props.corners}
        livePosition={props.livePosition}
        disabled={props.disabled}
        onCapture={props.onCapture}
        onUndo={props.onUndo}
        onFinish={props.onFinishCircle}
        onReset={props.onReset}
      />
    );
  }
  return (
    <BoardCaptureSteps
      corners={props.corners}
      livePosition={props.livePosition}
      rect={props.rect}
      disabled={props.disabled}
      onCapture={props.onCapture}
      onUndo={props.onUndo}
      onFinish={props.onFinishRect}
      onManualSize={props.onManualSize}
      onReset={props.onReset}
    />
  );
}
