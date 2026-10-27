import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceForActiveHead } from '../../../core/cnc/cnc-head-feeds';
import type { BoardOutlineDraft } from '../../../core/scene';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardAnchorOverlay } from './BoardAnchorOverlay';
import { BoardCapturePhase } from './BoardCapturePhase';
import { BoardCaptureFloatingPanel } from './BoardCaptureFloatingPanel';
import type { FloatingBoardPanelPosition } from './use-floating-board-panel';
import { BoardShapeToggle } from './BoardShapeToggle';
import { capturedBoardOutlineMatches } from './captured-board-outline';
import {
  useBoardCapture,
  type BoardCapture,
  type BoardRegistrationEpoch,
} from './use-board-capture';
import type { BoardCaptureHandlers } from './use-board-capture-handlers';
import { useBoardVerification, type BoardVerificationController } from './use-board-verification';
import { useCaptureGating } from './use-capture-gating';
import { useBoardRemoteRegistration } from './use-board-remote-registration';
import { usePendingBoardPhoto } from './use-board-photo-inbox';
import { useBoardPanelHandlers } from './use-board-panel-handlers';

const BOARD_JOG_FEED_MM_PER_MIN = 3000;

// The panel is always mounted beside the canvas, and its body follows the live
// controller (status report, transport writes, status sequence): mounted while
// closed, it re-rendered twice per acknowledged line of a running job for a
// panel nobody could see. This gate reads only `open`. It owns the capture
// session, so closing and reopening resumes it, and keeps the body mounted
// after a close until the body has declined to stay open
// (useKeepBoardPanelOpenWhileBusy): a close never tears down a busy session.
export function BoardCapturePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.boardCapturePanelOpen);
  const capture = useBoardCapture();
  const panelPosition = useRef<FloatingBoardPanelPosition | null>(null);
  const [bodyMounted, setBodyMounted] = useState(open);
  const release = useCallback(() => setBodyMounted(false), []);
  if (open && !bodyMounted) setBodyMounted(true);
  if (!open && !bodyMounted) return null;
  return (
    <BoardCapturePanelBody
      open={open}
      capture={capture}
      onRelease={release}
      panelPosition={panelPosition}
    />
  );
}

type BoardCapturePanelBodyProps = {
  readonly open: boolean;
  readonly capture: BoardCapture;
  readonly onRelease: () => void;
  readonly panelPosition: React.MutableRefObject<FloatingBoardPanelPosition | null>;
};

function BoardCapturePanelBody({
  open,
  capture,
  onRelease,
  panelPosition,
}: BoardCapturePanelBodyProps): JSX.Element | null {
  const close = useUiStore((state) => state.closeBoardCapturePanel);
  const livePosition = useLiveMachinePosition();
  const currentEpoch = useCurrentRegistrationEpoch();
  const motionActive = useLaserStore((state) => state.motionOperation !== null);
  const jogToMachinePosition = useLaserStore((state) => state.jogToMachinePosition);
  const device = useStore((state) => state.project.device);
  const machine = useStore((state) => state.project.machine);
  const { connected, disabled } = useCaptureGating();
  const feed = Math.min(deviceForActiveHead(device, machine).maxFeed, BOARD_JOG_FEED_MM_PER_MIN);
  const { geometry, registrationEpoch, outlineId, committed } = capture.state;
  const outlineValid = useStore((state) =>
    capturedBoardOutlineMatches(state.project.scene, outlineId, geometry),
  );
  const handlers = useBoardPanelHandlers(capture, device);
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
  useBoardRemoteRegistration(open, {
    capture,
    handlers,
    currentEpoch,
    busy: handlers.busy,
    device,
  });
  const pendingPhoto = usePendingBoardPhoto(capture, committed, motionActive);
  useKeepBoardPanelOpenWhileBusy(open, verification, handlers.busy, onRelease);

  if (!open) return null;
  return (
    <>
      <BoardCaptureFloatingPanel
        busy={panelLocked}
        checkActive={verification.activeTarget !== null}
        onClose={close}
        rememberedPosition={panelPosition}
      >
        <PanelMessages
          connected={connected}
          handlers={handlers}
          remotePhotoWaiting={pendingPhoto.waitingWhileCommitted}
        />
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
          onReset={() => resetBoardCapture(panelLocked, verification, capture)}
          outlineInitialFile={pendingPhoto.initialFile}
          onOutlineInitialFileConsumed={pendingPhoto.consumeInitialFile}
        />
      </BoardCaptureFloatingPanel>
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

function resetBoardCapture(
  panelLocked: boolean,
  verification: BoardVerificationController,
  capture: BoardCapture,
): void {
  if (panelLocked || useLaserStore.getState().motionOperation !== null) return;
  verification.cancel();
  capture.reset();
}

function useLiveMachinePosition(): ReturnType<typeof inferCurrentMachinePosition> {
  const statusReport = useLaserStore((state) => state.statusReport);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const reportInches = useLaserStore((state) => state.controllerSettings?.reportInches === true);
  return inferCurrentMachinePosition(statusReport, wcoCache, reportInches);
}

function useCurrentRegistrationEpoch(): BoardRegistrationEpoch {
  const controllerSessionEpoch = useLaserStore((state) => state.controllerSessionEpoch);
  const trustedPositionEpoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const workOriginVersion = useLaserStore((state) => state.workOriginVersion ?? 0);
  return { controllerSessionEpoch, trustedPositionEpoch, workOriginVersion };
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
  readonly outlineInitialFile?: File | undefined;
  readonly onOutlineInitialFileConsumed: () => void;
}): JSX.Element {
  const { state, setShape, setCircleMethod, setOutlineDraft, undo } = props.capture;
  const changeShape = (shapeKind: typeof state.shapeKind): void => {
    if (!captureSessionMotionActive()) setShape(shapeKind);
  };
  const changeCircleMethod = (method: typeof state.circleMethod): void => {
    if (!captureSessionMotionActive()) setCircleMethod(method);
  };
  const undoCapture = (): void => {
    if (!captureSessionMotionActive()) undo();
  };
  // Canvas first (ADR-654): the drawn outline goes on the canvas at once, so
  // artwork can be laid out on it before the head registers where it sits.
  const drawOutline = (draft: BoardOutlineDraft): void => {
    if (captureSessionMotionActive()) return;
    setOutlineDraft(draft);
    useStore.getState().drawCapturedBoardOutline({
      kind: 'outline',
      pointsMm: draft.localPointsMm,
      anchorIndices: draft.anchorIndices,
    });
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
        outlineDraft={state.outlineDraft}
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
        onFinishOutline={props.handlers.onFinishOutline}
        onOutlineDraft={drawOutline}
        outlineInitialFile={props.outlineInitialFile}
        onOutlineInitialFileConsumed={props.onOutlineInitialFileConsumed}
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
  onRelease: () => void,
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
    onRelease();
  }, [captureBusy, open, verification, onRelease]);
}

function PanelMessages(props: {
  readonly connected: boolean;
  readonly handlers: BoardCaptureHandlers;
  readonly remotePhotoWaiting: boolean;
}): JSX.Element {
  return (
    <>
      {!props.connected && <p style={hintStyle}>Connect the machine to capture a board.</p>}
      {props.remotePhotoWaiting && (
        <p style={noticeStyle} role="status">
          A photo arrived from a remote client. Start a new board capture to use it.
        </p>
      )}
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
