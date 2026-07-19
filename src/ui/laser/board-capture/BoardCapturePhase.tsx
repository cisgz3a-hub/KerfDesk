import type { BestFitRectangle, BoardShapeKind, Vec2 } from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { BoardCaptureSteps } from './BoardCaptureSteps';
import { BoardPlacementControls } from './BoardPlacementControls';
import { CircleBoardPlacementControls } from './CircleBoardPlacementControls';
import { CircleCaptureSteps } from './CircleCaptureSteps';
import type { CircleCaptureMethod } from './use-board-capture';
import type { BoardVerificationController } from './use-board-verification';

export function BoardCapturePhase(props: {
  readonly committed: boolean;
  readonly shapeKind: BoardShapeKind;
  readonly circleMethod: CircleCaptureMethod;
  readonly corners: ReadonlyArray<Vec2>;
  readonly geometry: CapturedBoardGeometry | null;
  readonly rect: BestFitRectangle | null;
  readonly livePosition: Vec2 | null;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onCircleMethodChange: (method: CircleCaptureMethod) => void;
  readonly onMoveToPoint: (point: Vec2) => Promise<void>;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishCircle: (center: Vec2, diameterMm: number) => Promise<void>;
  readonly onReset: () => void;
}): JSX.Element {
  if (props.committed && props.geometry !== null) {
    return props.geometry.kind === 'circle' ? (
      <CircleBoardPlacementControls
        geometry={props.geometry}
        disabled={props.disabled}
        verification={props.verification}
        onReset={props.onReset}
      />
    ) : (
      <BoardPlacementControls
        geometry={props.geometry}
        disabled={props.disabled}
        verification={props.verification}
        onReset={props.onReset}
      />
    );
  }
  if (props.shapeKind === 'circle') {
    return (
      <CircleCaptureSteps
        method={props.circleMethod}
        corners={props.corners}
        livePosition={props.livePosition}
        disabled={props.disabled}
        sessionDisabled={props.sessionDisabled}
        onMethodChange={props.onCircleMethodChange}
        onMoveToPoint={props.onMoveToPoint}
        onCapture={props.onCapture}
        onUndo={props.onUndo}
        onFinish={props.onFinishCircle}
      />
    );
  }
  return (
    <BoardCaptureSteps
      corners={props.corners}
      livePosition={props.livePosition}
      rect={props.rect}
      disabled={props.disabled}
      sessionDisabled={props.sessionDisabled}
      onCapture={props.onCapture}
      onUndo={props.onUndo}
      onFinish={props.onFinishRect}
      onManualSize={props.onManualSize}
      onReset={props.onReset}
    />
  );
}
