import type {
  BestFitRectangle,
  BoardOutlineDraft,
  BoardShapeKind,
  Vec2,
} from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { BoardCaptureSteps } from './BoardCaptureSteps';
import { BoardPlacementControls } from './BoardPlacementControls';
import { CircleBoardPlacementControls } from './CircleBoardPlacementControls';
import { CircleCaptureSteps } from './CircleCaptureSteps';
import type { CircleCaptureMethod } from './use-board-capture';
import type { BoardVerificationController } from './use-board-verification';
import { OutlineCaptureSteps } from './OutlineCaptureSteps';
import { OutlineBoardPlacementControls } from './OutlineBoardPlacementControls';

export function BoardCapturePhase(props: {
  readonly committed: boolean;
  readonly shapeKind: BoardShapeKind;
  readonly circleMethod: CircleCaptureMethod;
  readonly outlineDraft: BoardOutlineDraft | null;
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
  readonly onFinishOutline: () => Promise<void>;
  readonly onOutlineDraft: (draft: BoardOutlineDraft) => void;
  readonly outlineInitialFile?: File | undefined;
  readonly onOutlineInitialFileConsumed: () => void;
  readonly onReset: () => void;
}): JSX.Element {
  if (props.committed && props.geometry !== null) {
    return <CommittedBoardControls {...props} geometry={props.geometry} />;
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
  if (props.shapeKind === 'outline') {
    return (
      <OutlineCaptureSteps
        draft={props.outlineDraft}
        corners={props.corners}
        livePosition={props.livePosition}
        disabled={props.disabled}
        sessionDisabled={props.sessionDisabled}
        onCapture={props.onCapture}
        onUndo={props.onUndo}
        onFinish={props.onFinishOutline}
        onDraft={props.onOutlineDraft}
        initialFile={props.outlineInitialFile}
        onInitialFileConsumed={props.onOutlineInitialFileConsumed}
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

function CommittedBoardControls(
  props: Parameters<typeof BoardCapturePhase>[0] & {
    readonly geometry: CapturedBoardGeometry;
  },
): JSX.Element {
  if (props.geometry.kind === 'circle') {
    return (
      <CircleBoardPlacementControls
        geometry={props.geometry}
        disabled={props.disabled}
        verification={props.verification}
        onReset={props.onReset}
      />
    );
  }
  if (props.geometry.kind === 'rect') {
    return (
      <BoardPlacementControls
        geometry={props.geometry}
        disabled={props.disabled}
        verification={props.verification}
        onReset={props.onReset}
      />
    );
  }
  return (
    <OutlineBoardPlacementControls
      geometry={props.geometry}
      disabled={props.disabled}
      verification={props.verification}
      onReset={props.onReset}
    />
  );
}
