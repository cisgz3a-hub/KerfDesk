// PlaceBoardSidebar — the Place Board page's three steps (ADR-636), laid out
// like jig mode's: 1 capture the board, 2 place the artwork, 3 burn, chosen in
// the page header. Each step stays mounted while hidden, so a half-typed size
// or margin survives a look at another step.

import { Button } from '../../kit';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import type { ToolPageStep } from '../../workspace/ToolPageHeader';
import { BoardCapturePhase } from './BoardCapturePhase';
import { BoardPointerBar } from './BoardPointerBar';
import { BoardShapeToggle } from './BoardShapeToggle';
import { headTargetForSight } from './board-sight';
import type { BoardSightView } from './CaptureCard';
import { sceneHasCapturedBoard } from './captured-board-outline';
import { PlaceBoardArtworkStep, PlaceBoardBurnStep } from './PlaceBoardSteps';
import type { BoardCapture, BoardRegistrationEpoch } from './use-board-capture';
import type { BoardCaptureHandlers } from './use-board-capture-handlers';
import type { BoardPointer } from './use-board-pointer';
import type { BoardVerificationController } from './use-board-verification';

export type PlaceBoardStepId = 'board' | 'artwork' | 'burn';

/** The page header's step indicator, in the order of the job. */
export const PLACE_BOARD_STEPS: ReadonlyArray<ToolPageStep<PlaceBoardStepId>> = [
  {
    id: 'board',
    label: '1 Capture board',
    title: 'Choose the board shape and capture its corners with the head or pointer',
  },
  {
    id: 'artwork',
    label: '2 Place artwork',
    title: 'Add the artwork and place it on the board',
  },
  { id: 'burn', label: '3 Burn', title: 'Check the laser settings, then Frame and Start' },
];

export type PlaceBoardSidebarProps = {
  readonly step: PlaceBoardStepId;
  readonly onStep: (step: PlaceBoardStepId) => void;
  readonly capture: BoardCapture;
  readonly handlers: BoardCaptureHandlers;
  readonly pointer: BoardPointer;
  readonly connected: boolean;
  readonly sight: BoardSightView;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly verification: BoardVerificationController;
  readonly feed: number;
  readonly jogToMachinePosition: (x: number, y: number, feed: number) => Promise<void>;
  readonly onReset: () => void;
};

export function PlaceBoardSidebar(props: PlaceBoardSidebarProps): JSX.Element {
  const { step, onStep } = props;
  const geometry = props.capture.state.committed ? props.capture.state.geometry : null;
  return (
    <aside className="lf-jig-sidebar lf-place-board">
      <PanelMessages connected={props.connected} handlers={props.handlers} />
      <section className="lf-jig-fields" aria-label="Capture the board" hidden={step !== 'board'}>
        <BoardPointerBar pointer={props.pointer} connected={props.connected} />
        <EarlierBoardNote committed={props.capture.state.committed} onStep={onStep} />
        <BoardStep {...props} />
      </section>
      <section className="lf-jig-fields" aria-label="Place the artwork" hidden={step !== 'artwork'}>
        <PlaceBoardArtworkStep onGoToBoard={() => onStep('board')} />
      </section>
      <section className="lf-jig-fields" aria-label="Burn on the board" hidden={step !== 'burn'}>
        <PlaceBoardBurnStep geometry={geometry} onGoToBoard={() => onStep('board')} />
      </section>
    </aside>
  );
}

function BoardStep(props: PlaceBoardSidebarProps): JSX.Element {
  const { state, setShape, setCircleMethod, undo } = props.capture;
  const changeShape = (shapeKind: typeof state.shapeKind): void => {
    if (!captureSessionMotionActive()) setShape(shapeKind);
  };
  const changeCircleMethod = (method: typeof state.circleMethod): void => {
    if (!captureSessionMotionActive()) setCircleMethod(method);
  };
  const undoCapture = (): void => {
    if (!captureSessionMotionActive()) undo();
  };
  return (
    <>
      {!state.committed && (
        <BoardShapeToggle
          shapeKind={state.shapeKind}
          disabled={props.sessionDisabled}
          onChange={changeShape}
        />
      )}
      <BoardCapturePhase
        committed={state.committed}
        shapeKind={state.shapeKind}
        circleMethod={state.circleMethod}
        corners={state.corners}
        geometry={state.geometry}
        rect={props.handlers.rect}
        polygon={props.handlers.polygon}
        sight={props.sight}
        disabled={props.disabled}
        sessionDisabled={props.sessionDisabled}
        verification={props.verification}
        onCircleMethodChange={changeCircleMethod}
        onMoveToPoint={(point) => moveToCapturedPoint(props, point)}
        onCapture={props.handlers.onCapture}
        onUndo={undoCapture}
        onFinishRect={props.handlers.onFinishRect}
        onManualSize={props.handlers.onManualSize}
        onFinishPolygon={props.handlers.onFinishPolygon}
        onFinishCircle={props.handlers.onFinishCircle}
        onReset={props.onReset}
        onRestartCapture={() => changeShape(state.shapeKind)}
      />
    </>
  );
}

// A project reopened with a board from an earlier capture: the session that
// captured it is gone, so say what step 1 would do and where placing happens.
function EarlierBoardNote(props: {
  readonly committed: boolean;
  readonly onStep: (step: PlaceBoardStepId) => void;
}): JSX.Element | null {
  const hasBoard = useStore((state) => sceneHasCapturedBoard(state.project.scene));
  if (props.committed || !hasBoard) return null;
  return (
    <div className="lf-place-board__message lf-place-board__message--hint" role="status">
      <p>This project already has a board from an earlier capture. Capturing again replaces it.</p>
      <Button title="Place artwork on the existing board" onClick={() => props.onStep('artwork')}>
        Use the existing board
      </Button>
    </div>
  );
}

function PanelMessages(props: {
  readonly connected: boolean;
  readonly handlers: BoardCaptureHandlers;
}): JSX.Element {
  return (
    <>
      {!props.connected && (
        <p className="lf-place-board__message lf-place-board__message--hint">
          Connect the machine to capture a board.
        </p>
      )}
      {props.handlers.captureError !== null && (
        <p className="lf-place-board__message lf-place-board__message--error" role="alert">
          {props.handlers.captureError}
        </p>
      )}
      {props.handlers.captureNotice !== null && (
        <p className="lf-place-board__message lf-place-board__message--notice" role="status">
          {props.handlers.captureNotice}
        </p>
      )}
    </>
  );
}

function moveToCapturedPoint(
  props: PlaceBoardSidebarProps,
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  const capturedEpoch = props.capture.state.captureEpoch;
  if (
    capturedEpoch === null ||
    !props.capture.isSessionCurrent() ||
    !registrationEpochIsLive(capturedEpoch)
  ) {
    return Promise.reject(
      new Error(
        'Machine coordinates changed during circle capture. Start over and capture it again.',
      ),
    );
  }
  // With the positioning light on, put the light (not the beam) on the point.
  const head = headTargetForSight(point);
  return props.jogToMachinePosition(head.x, head.y, props.feed);
}

function registrationEpochIsLive(captured: BoardRegistrationEpoch): boolean {
  const laser = useLaserStore.getState();
  return (
    captured.controllerSessionEpoch === laser.controllerSessionEpoch &&
    captured.trustedPositionEpoch === (laser.trustedPositionEpoch ?? 0) &&
    captured.workOriginVersion === (laser.workOriginVersion ?? 0)
  );
}

function captureSessionMotionActive(): boolean {
  return useLaserStore.getState().motionOperation !== null;
}
