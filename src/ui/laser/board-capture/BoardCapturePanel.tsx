import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deviceForActiveHead } from '../../../core/cnc/cnc-head-feeds';
import type { Origin } from '../../../core/devices/device-profile';
import { jogAxisSignsForOrigin } from '../../../core/devices/jog-direction';
import { findRegistrationBoxBounds, type Vec2 } from '../../../core/scene';
import type { BoardPolygonResult } from '../../../core/scene/board-polygon';
import { sameBoardVerificationTarget } from '../../../core/scene/board-verification';
import { useStore } from '../../state';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { boardAnchorOverlayHandles } from './board-anchor-overlay-layout';
import { machinePointOnBed, sightedPoint } from './board-sight';
import type { BoardSightView } from './CaptureCard';
import { capturedBoardOutlineMatches } from './captured-board-outline';
import type { PlaceBoardCanvasMarks, PlaceBoardOutlineStyle } from './place-board-canvas-marks';
import { PlaceBoardCanvas } from './PlaceBoardCanvas';
import { PlaceBoardHeader } from './PlaceBoardHeader';
import { PlaceBoardSidebar, type PlaceBoardStepId } from './PlaceBoardSidebar';
import {
  useBoardCapture,
  type BoardCapture,
  type BoardCaptureState,
  type BoardRegistrationEpoch,
} from './use-board-capture';
import { useBoardCaptureHandlers } from './use-board-capture-handlers';
import { useBoardPointer, type BoardPointer } from './use-board-pointer';
import { useBoardVerification, type BoardVerificationController } from './use-board-verification';
import { useCaptureGating } from './use-capture-gating';
import '../../workspace/registration-jig/registration-jig.css';
import './place-board.css';

const BOARD_JOG_FEED_MM_PER_MIN = 3000;

// Place Board mode (ADR-636): like jig mode, the page takes the main canvas's
// place while the machine panel stays docked beside it. This host is always
// mounted, and reads only `open` and a few booleans, so it costs nothing while
// a job streams. It owns the capture session, so Done and reopening resumes
// it, and the positioning-light automation, so a light switched on for capture
// is switched off again after the page has gone. It keeps the page mounted after
// Done until the page has declined to stay open
// (useKeepBoardPanelOpenWhileBusy): leaving never tears down a busy session.
export function BoardCapturePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.boardCapturePanelOpen);
  const capture = useBoardCapture();
  const pointer = useBoardPointer(open && !capture.state.committed);
  const [bodyMounted, setBodyMounted] = useState(open);
  const release = useCallback(() => setBodyMounted(false), []);
  if (open && !bodyMounted) setBodyMounted(true);
  if (!open && !bodyMounted) return null;
  return <PlaceBoardPage open={open} capture={capture} pointer={pointer} onRelease={release} />;
}

function PlaceBoardPage({
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
  const running = useLaserStore((state) => state.streamer !== null);
  const actions = useBoardCaptureStoreActions();
  const { feed, origin } = useBoardJogSetup();
  const { connected, disabled } = useCaptureGating();
  const { geometry, registrationEpoch, outlineId, committed } = capture.state;
  const outlineValid = useStore((state) =>
    capturedBoardOutlineMatches(state.project.scene, outlineId, geometry),
  );
  const handlers = useBoardCaptureHandlers({ capture, livePosition, ...actions });
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
  const [step, setStep] = usePlaceBoardStep(committed);
  const fitRequest = useFitRequest(outlineId);
  const sight = boardSightView(livePosition, pointer, origin);
  const marks = usePlaceBoardMarks(
    capture.state,
    handlers.polygon,
    sight,
    verification,
    outlineValid,
  );
  const reset = (): void => {
    if (panelLocked || useLaserStore.getState().motionOperation !== null) return;
    verification.cancel();
    capture.reset();
  };

  if (!open) return null;
  return (
    <section aria-label="Place board" className="lf-jig-editor">
      <PlaceBoardHeader disabled={panelLocked} onDone={close} />
      <div className="lf-jig-body">
        <PlaceBoardSidebar
          step={step}
          onStep={setStep}
          capture={capture}
          handlers={handlers}
          pointer={pointer}
          connected={connected}
          sight={sight}
          disabled={interactionDisabled}
          sessionDisabled={sessionDisabled}
          verification={verification}
          feed={feed}
          jogToMachinePosition={actions.jogToMachinePosition}
          onReset={reset}
        />
        <PlaceBoardCanvas marks={marks} fitRequest={fitRequest} readOnly={running} />
      </div>
      <footer className="lf-jig-footer" role="status">
        {pageStatus(step, capture.state, connected, running)}
      </footer>
    </section>
  );
}

// Step 1 until the board exists; creating it moves on to placing the artwork,
// and starting a new board goes back to step 1.
function usePlaceBoardStep(
  committed: boolean,
): readonly [PlaceBoardStepId, (step: PlaceBoardStepId) => void] {
  const [step, setStep] = useState<PlaceBoardStepId>(committed ? 'artwork' : 'board');
  const wasCommitted = useRef(committed);
  useEffect(() => {
    if (committed !== wasCommitted.current) setStep(committed ? 'artwork' : 'board');
    wasCommitted.current = committed;
  }, [committed]);
  return [step, setStep];
}

// The canvas refits to the board whenever a new outline is created.
function useFitRequest(outlineId: string | null): number {
  const [request, setRequest] = useState(0);
  const last = useRef(outlineId);
  useEffect(() => {
    if (last.current !== outlineId) setRequest((value) => value + 1);
    last.current = outlineId;
  }, [outlineId]);
  return request;
}

function usePlaceBoardMarks(
  state: BoardCaptureState,
  polygon: BoardPolygonResult | null,
  sight: BoardSightView,
  verification: BoardVerificationController,
  outlineValid: boolean,
): PlaceBoardCanvasMarks {
  const scene = useStore((app) => app.project.scene);
  // A crossed capture order is joined round the board instead: draw that
  // outline, not the capture order's bow-tie, so the map matches the notice.
  const reordered =
    polygon?.kind === 'ok' && polygon.polygon.reordered ? onBed(polygon.polygon.points) : null;
  const sightOnBed = sight.point === null ? null : machinePointOnBed(sight.point);
  const sightMark =
    sightOnBed === null ? null : { point: sightOnBed, pointer: sight.aim === 'pointer' };
  const points = useMemo(
    () => (state.committed ? [] : onBed(state.corners)),
    [state.committed, state.corners],
  );
  const checks = useMemo(() => {
    const bounds = findRegistrationBoxBounds(scene);
    if (!state.committed || !outlineValid || state.geometry === null || bounds === null) return [];
    const outline = state.geometry.kind === 'polygon' ? state.geometry.polygon.outline : [];
    return boardAnchorOverlayHandles(state.geometry.kind, bounds, outline).map((handle) => ({
      point: handle.scenePoint,
      active: sameBoardVerificationTarget(handle.target, verification.activeTarget),
    }));
  }, [scene, state.committed, state.geometry, outlineValid, verification.activeTarget]);
  return {
    points,
    ...(reordered === null ? {} : { outlinePoints: reordered }),
    outline: outlineStyle(state),
    sight: sightMark,
    checks,
  };
}

function onBed(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return points.flatMap((point) => {
    const bed = machinePointOnBed(point);
    return bed === null ? [] : [bed];
  });
}

function outlineStyle(state: BoardCaptureState): PlaceBoardOutlineStyle {
  switch (state.shapeKind) {
    case 'rect':
      return state.corners.length === 4 ? 'box' : 'points';
    case 'polygon':
      return state.corners.length >= 3 ? 'closed' : 'path';
    case 'circle':
      return 'points';
  }
}

function pageStatus(
  step: PlaceBoardStepId,
  state: BoardCaptureState,
  connected: boolean,
  running: boolean,
): string {
  if (running) return 'The machine is running. Editing resumes when it stops.';
  if (!connected) return 'Connect the machine in the panel on the right to capture a board.';
  if (!state.committed) {
    return 'Jog with the machine panel, aim at each point and capture it. The canvas shows the points as you go.';
  }
  switch (step) {
    case 'board':
      return 'Board ready. Check a point on it if you like, then place the artwork in step 2.';
    case 'artwork':
      return 'Place the artwork on the board, then Frame and Start in step 3.';
    case 'burn':
      return 'Frame first to trace the artwork on the board, then Start.';
  }
}

function boardSightView(
  livePosition: ReturnType<typeof inferCurrentMachinePosition>,
  pointer: BoardPointer,
  origin: Origin,
): BoardSightView {
  const aimsWithPointer = pointer.configured && pointer.enabled;
  const offset = aimsWithPointer ? pointer.offset : { x: 0, y: 0 };
  return {
    point: livePosition === null ? null : sightedPoint(livePosition, offset),
    aim: aimsWithPointer ? 'pointer' : 'head',
    signs: jogAxisSignsForOrigin(origin),
  };
}

function useBoardCaptureStoreActions() {
  return {
    setOriginHere: useLaserStore((state) => state.setOriginHere),
    setOriginAtMachinePoint: useLaserStore((state) => state.setOriginAtMachinePoint),
    jogToMachinePosition: useLaserStore((state) => state.jogToMachinePosition),
    addCapturedBoard: useStore((state) => state.addCapturedBoard),
    updateCapturedBoard: useStore((state) => state.updateCapturedBoard),
  };
}

function useBoardJogSetup(): { readonly feed: number; readonly origin: Origin } {
  const device = useStore((state) => state.project.device);
  const machine = useStore((state) => state.project.machine);
  const feed = Math.min(deviceForActiveHead(device, machine).maxFeed, BOARD_JOG_FEED_MM_PER_MIN);
  return { feed, origin: device.origin };
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
