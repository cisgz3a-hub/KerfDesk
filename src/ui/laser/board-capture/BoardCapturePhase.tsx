import type {
  BestFitRectangle,
  BoardPolygonResult,
  BoardShapeKind,
  Vec2,
} from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { BoardCaptureSteps } from './BoardCaptureSteps';
import { BoardPlacementControls } from './BoardPlacementControls';
import type { BoardSightView } from './CaptureCard';
import { CircleCaptureSteps } from './CircleCaptureSteps';
import { PolygonCaptureSteps } from './PolygonCaptureSteps';
import type { CircleCaptureMethod } from './use-board-capture';
import type { BoardVerificationController } from './use-board-verification';

export function BoardCapturePhase(props: {
  readonly committed: boolean;
  readonly shapeKind: BoardShapeKind;
  readonly circleMethod: CircleCaptureMethod;
  readonly corners: ReadonlyArray<Vec2>;
  readonly geometry: CapturedBoardGeometry | null;
  readonly rect: BestFitRectangle | null;
  readonly polygon: BoardPolygonResult | null;
  readonly sight: BoardSightView;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly verification: BoardVerificationController;
  readonly onCircleMethodChange: (method: CircleCaptureMethod) => void;
  readonly onMoveToPoint: (point: Vec2) => Promise<void>;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishPolygon: () => void;
  readonly onFinishCircle: (center: Vec2, diameterMm: number) => Promise<void>;
  readonly onReset: () => void;
  /** Clear the points captured so far but keep the chosen shape. */
  readonly onRestartCapture: () => void;
}): JSX.Element {
  if (props.committed && props.geometry !== null) {
    return (
      <BoardPlacementControls
        geometry={props.geometry}
        disabled={props.disabled}
        verification={props.verification}
        onReset={props.onReset}
      />
    );
  }
  switch (props.shapeKind) {
    case 'circle':
      return (
        <CircleCaptureSteps
          method={props.circleMethod}
          corners={props.corners}
          sight={props.sight}
          disabled={props.disabled}
          sessionDisabled={props.sessionDisabled}
          onMethodChange={props.onCircleMethodChange}
          onMoveToPoint={props.onMoveToPoint}
          onCapture={props.onCapture}
          onUndo={props.onUndo}
          onFinish={props.onFinishCircle}
        />
      );
    case 'polygon':
      return (
        <PolygonCaptureSteps
          corners={props.corners}
          sight={props.sight}
          polygon={props.polygon}
          disabled={props.disabled}
          sessionDisabled={props.sessionDisabled}
          onCapture={props.onCapture}
          onUndo={props.onUndo}
          onFinish={props.onFinishPolygon}
          onReset={props.onRestartCapture}
        />
      );
    case 'rect':
      return (
        <BoardCaptureSteps
          corners={props.corners}
          sight={props.sight}
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
}
