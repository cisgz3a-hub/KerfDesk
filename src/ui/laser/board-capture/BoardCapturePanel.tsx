import { useEffect, useRef } from 'react';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardAnchorOverlay } from './BoardAnchorOverlay';
import { BoardCapturePhase } from './BoardCapturePhase';
import { BoardShapeToggle } from './BoardShapeToggle';
import { capturedBoardOutlineMatches } from './captured-board-outline';
import { useBoardCapture, type BoardRegistrationEpoch } from './use-board-capture';
import { useBoardCaptureHandlers, type BoardCaptureHandlers } from './use-board-capture-handlers';
import { useBoardVerification, type BoardVerificationController } from './use-board-verification';
import { useCaptureGating } from './use-capture-gating';

const BOARD_JOG_FEED_MM_PER_MIN = 3000;

export function BoardCapturePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.boardCapturePanelOpen);
  const close = useUiStore((state) => state.closeBoardCapturePanel);
  const statusReport = useLaserStore((state) => state.statusReport);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const controllerSessionEpoch = useLaserStore((state) => state.controllerSessionEpoch);
  const trustedPositionEpoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const workOriginVersion = useLaserStore((state) => state.workOriginVersion ?? 0);
  const motionActive = useLaserStore((state) => state.motionOperation !== null);
  const setOriginHere = useLaserStore((state) => state.setOriginHere);
  const jogToMachinePosition = useLaserStore((state) => state.jogToMachinePosition);
  const device = useStore((state) => state.project.device);
  const addCapturedBoard = useStore((state) => state.addCapturedBoard);
  const updateCapturedBoard = useStore((state) => state.updateCapturedBoard);
  const capture = useBoardCapture();
  const { connected, disabled } = useCaptureGating();
  const currentEpoch = { controllerSessionEpoch, trustedPositionEpoch, workOriginVersion };
  const livePosition = inferCurrentMachinePosition(statusReport, wcoCache);
  const feed = Math.min(device.maxFeed, BOARD_JOG_FEED_MM_PER_MIN);
  const { geometry, registrationEpoch, outlineId, committed } = capture.state;
  const outlineValid = useStore((state) =>
    capturedBoardOutlineMatches(state.project.scene, outlineId, geometry),
  );
  const handlers = useBoardCaptureHandlers({
    capture,
    livePosition,
    setOriginHere,
    addCapturedBoard,
    updateCapturedBoard,
  });
  const interactionDisabled = disabled || handlers.busy;
  const sessionDisabled = handlers.busy || motionActive;
  const verification = useBoardVerification({
    geometry,
    registrationEpoch,
    currentEpoch,
    outlineValid,
    feed,
    disabled: interactionDisabled,
    onCorrect: handlers.onCorrectBoardPoint,
  });
  const panelLocked = sessionDisabled || verification.saving || verification.cancelling;
  useKeepBoardPanelOpenWhileBusy(open, verification, handlers.busy);
  const reset = (): void => {
    if (panelLocked || useLaserStore.getState().motionOperation !== null) return;
    verification.cancel();
    capture.reset();
  };

  if (!open) return null;
  return (
    <>
      <section aria-label="Place board" className="lf-chip" style={panelStyle}>
        <PanelHeader disabled={panelLocked} onClose={close} />
        <PanelMessages connected={connected} handlers={handlers} />
        <BoardCapturePanelContent
          capture={capture}
          geometry={geometry}
          handlers={handlers}
          livePosition={livePosition}
          disabled={interactionDisabled}
          sessionDisabled={sessionDisabled}
          verification={verification}
          feed={feed}
          jogToMachinePosition={jogToMachinePosition}
          onReset={reset}
        />
      </section>
      <CommittedBoardOverlay
        committed={committed}
        geometry={geometry}
        outlineValid={outlineValid}
        disabled={interactionDisabled}
        verification={verification}
      />
    </>
  );
}

function BoardCapturePanelContent(props: {
  readonly capture: ReturnType<typeof useBoardCapture>;
  readonly geometry: ReturnType<typeof useBoardCapture>['state']['geometry'];
  readonly handlers: BoardCaptureHandlers;
  readonly livePosition: ReturnType<typeof inferCurrentMachinePosition>;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly verification: BoardVerificationController;
  readonly feed: number;
  readonly jogToMachinePosition: (x: number, y: number, feed: number) => Promise<void>;
  readonly onReset: () => void;
}): JSX.Element {
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
        geometry={props.geometry}
        rect={props.handlers.rect}
        livePosition={props.livePosition}
        disabled={props.disabled}
        sessionDisabled={props.sessionDisabled}
        verification={props.verification}
        onCircleMethodChange={changeCircleMethod}
        onMoveToPoint={(point) => moveToCapturedPoint(props, point)}
        onCapture={props.handlers.onCapture}
        onUndo={undoCapture}
        onFinishRect={props.handlers.onFinishRect}
        onManualSize={props.handlers.onManualSize}
        onFinishCircle={props.handlers.onFinishCircle}
        onReset={props.onReset}
      />
    </>
  );
}

function moveToCapturedPoint(
  props: Parameters<typeof BoardCapturePanelContent>[0],
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
  return props.jogToMachinePosition(point.x, point.y, props.feed);
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

function useKeepBoardPanelOpenWhileBusy(
  open: boolean,
  verification: BoardVerificationController,
  captureBusy: boolean,
): void {
  const wasOpen = useRef(open);
  useEffect(() => {
    const justClosed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!justClosed) return;
    const laser = useLaserStore.getState();
    if (
      captureBusy ||
      verification.saving ||
      verification.cancelling ||
      laser.motionOperation?.kind === 'jog'
    ) {
      useUiStore.setState({ boardCapturePanelOpen: true });
      return;
    }
    if (verification.activeTarget !== null) {
      verification.cancel();
    }
  }, [captureBusy, open, verification]);
}

function PanelHeader(props: {
  readonly disabled: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <header style={headerStyle}>
      <strong>Place Board</strong>
      <Button
        variant="ghost"
        aria-label="Close board capture panel"
        disabled={props.disabled}
        onClick={props.onClose}
      >
        ×
      </Button>
    </header>
  );
}

function PanelMessages(props: {
  readonly connected: boolean;
  readonly handlers: BoardCaptureHandlers;
}): JSX.Element {
  return (
    <>
      {!props.connected && <p style={hintStyle}>Connect the machine to capture a board.</p>}
      {props.handlers.captureError !== null && (
        <p style={errorHintStyle} role="alert">
          {props.handlers.captureError}
        </p>
      )}
      {props.handlers.captureNotice !== null && (
        <p style={noticeStyle} role="status">
          {props.handlers.captureNotice}
        </p>
      )}
    </>
  );
}

function CommittedBoardOverlay(props: {
  readonly committed: boolean;
  readonly geometry: ReturnType<typeof useBoardCapture>['state']['geometry'];
  readonly outlineValid: boolean;
  readonly disabled: boolean;
  readonly verification: BoardVerificationController;
}): JSX.Element | null {
  if (!props.committed || props.geometry === null || !props.outlineValid) return null;
  return (
    <BoardAnchorOverlay
      geometry={props.geometry}
      activeTarget={props.verification.activeTarget}
      disabled={
        props.disabled || !props.verification.epochValid || props.verification.activeTarget !== null
      }
      onSelect={props.verification.selectTarget}
    />
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 5,
  top: 12,
  left: 12,
  width: 280,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 12,
  boxShadow: 'var(--lf-shadow)',
  pointerEvents: 'auto',
  fontSize: 13,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  fontStyle: 'italic',
};
const errorHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-danger-fg)',
};
const noticeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-warning-fg)',
};
