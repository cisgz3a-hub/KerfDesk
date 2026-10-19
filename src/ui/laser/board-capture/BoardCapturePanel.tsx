import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceForActiveHead } from '../../../core/cnc/cnc-head-feeds';
import { jogAxisSignsForOrigin } from '../../../core/devices/jog-direction';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardAnchorOverlay } from './BoardAnchorOverlay';
import { BoardCapturePhase } from './BoardCapturePhase';
import { BoardPointerBar } from './BoardPointerBar';
import { BoardShapeToggle } from './BoardShapeToggle';
import { headTargetForSight, sightedPoint } from './board-sight';
import type { BoardSightView } from './CaptureCard';
import { capturedBoardOutlineMatches } from './captured-board-outline';
import { PlaceBoardHeader, type PlaceBoardStep } from './PlaceBoardHeader';
import {
  useBoardCapture,
  type BoardCapture,
  type BoardRegistrationEpoch,
} from './use-board-capture';
import { useBoardCaptureHandlers, type BoardCaptureHandlers } from './use-board-capture-handlers';
import { useBoardPointer, type BoardPointer } from './use-board-pointer';
import { useBoardVerification, type BoardVerificationController } from './use-board-verification';
import { useCaptureGating } from './use-capture-gating';
import './place-board.css';

const BOARD_JOG_FEED_MM_PER_MIN = 3000;

// The panel is always mounted beside the canvas, and its body follows the live
// controller (status report, transport writes, status sequence): mounted while
// closed, it re-rendered twice per acknowledged line of a running job for a
// panel nobody could see. This gate reads only `open` and a few booleans. It
// owns the capture session, so closing and reopening resumes it, and the
// positioning-light automation, so a light switched on for capture is switched
// off again even after the body has gone (ADR-636). It keeps the body mounted
// after a close until the body has declined to stay open
// (useKeepBoardPanelOpenWhileBusy): a close never tears down a busy session.
export function BoardCapturePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.boardCapturePanelOpen);
  const capture = useBoardCapture();
  const pointer = useBoardPointer(open && !capture.state.committed);
  const [bodyMounted, setBodyMounted] = useState(open);
  const release = useCallback(() => setBodyMounted(false), []);
  if (open && !bodyMounted) setBodyMounted(true);
  if (!open && !bodyMounted) return null;
  return (
    <BoardCapturePanelBody open={open} capture={capture} pointer={pointer} onRelease={release} />
  );
}

function BoardCapturePanelBody({
  open,
  capture,
  pointer,
  onRelease,
}: {
  readonly open: boolean;
  readonly capture: BoardCapture;
  readonly pointer: BoardPointer;
  readonly onRelease: () => void;
}): JSX.Element | null {
  const close = useUiStore((state) => state.closeBoardCapturePanel);
  const livePosition = useLiveMachinePosition();
  const currentEpoch = useCurrentRegistrationEpoch();
  const motionActive = useLaserStore((state) => state.motionOperation !== null);
  const setOriginHere = useLaserStore((state) => state.setOriginHere);
  const setOriginAtMachinePoint = useLaserStore((state) => state.setOriginAtMachinePoint);
  const jogToMachinePosition = useLaserStore((state) => state.jogToMachinePosition);
  const device = useStore((state) => state.project.device);
  const machine = useStore((state) => state.project.machine);
  const addCapturedBoard = useStore((state) => state.addCapturedBoard);
  const updateCapturedBoard = useStore((state) => state.updateCapturedBoard);
  const { connected, disabled } = useCaptureGating();
  const feed = Math.min(deviceForActiveHead(device, machine).maxFeed, BOARD_JOG_FEED_MM_PER_MIN);
  const { geometry, registrationEpoch, outlineId, committed } = capture.state;
  const outlineValid = useStore((state) =>
    capturedBoardOutlineMatches(state.project.scene, outlineId, geometry),
  );
  const handlers = useBoardCaptureHandlers({
    capture,
    livePosition,
    setOriginHere,
    setOriginAtMachinePoint,
    addCapturedBoard,
    updateCapturedBoard,
  });
  const interactionDisabled = disabled || handlers.busy || pointer.switching;
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
  useKeepBoardPanelOpenWhileBusy(open, verification, handlers.busy, onRelease);
  const reset = (): void => {
    if (panelLocked || useLaserStore.getState().motionOperation !== null) return;
    verification.cancel();
    capture.reset();
  };
  const sight: BoardSightView = {
    point: livePosition === null ? null : sightedPoint(livePosition, pointerOffset(pointer)),
    aim: pointer.configured && pointer.enabled ? 'pointer' : 'head',
    signs: jogAxisSignsForOrigin(device.origin),
  };

  if (!open) return null;
  return (
    <>
      <section aria-label="Place board" className="lf-chip lf-place-board">
        <PlaceBoardHeader
          step={panelStep(capture)}
          disabled={panelLocked}
          onClose={close}
        />
        <PanelMessages connected={connected} handlers={handlers} />
        <BoardPointerBar pointer={pointer} connected={connected} />
        <BoardCapturePanelContent
          capture={capture}
          geometry={geometry}
          handlers={handlers}
          sight={sight}
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

function panelStep(capture: BoardCapture): PlaceBoardStep {
  if (capture.state.committed) return 'place';
  return capture.state.corners.length > 0 ? 'capture' : 'shape';
}

function pointerOffset(pointer: BoardPointer): { readonly x: number; readonly y: number } {
  return pointer.configured && pointer.enabled ? pointer.offset : { x: 0, y: 0 };
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
  readonly sight: BoardSightView;
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
