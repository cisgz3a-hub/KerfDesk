import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  bestFitRectangleFromCorners,
  findRegistrationBoxes,
  outlineMachineCorner,
  type BestFitRectangle,
  type BoardShape,
  type Vec2,
} from '../../../core/scene';
import type { DeviceProfile } from '../../../core/devices';
import {
  capturedBoardShape,
  correctCapturedBoardGeometry,
  verificationTargetChangesOrigin,
  type BoardVerificationTarget,
  type CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { MIN_BOARD_DIMENSION_MM } from './constants';
import { capturedBoardOutlineMatches } from './captured-board-outline';
import {
  boardCaptureCanCommit,
  type BoardCapture,
  type BoardRegistrationEpoch,
} from './use-board-capture';
import {
  createOutlineFinishHandler,
  outlineGeometryLargeEnough,
  outlineRotationDeg,
} from './use-board-outline-handlers';

type SetMessage = Dispatch<SetStateAction<string | null>>;
const CROSS_AXIS_NOTICE_MM = 5;

type BoardCaptureHandlerArgs = {
  readonly capture: BoardCapture;
  readonly livePosition: Vec2 | null;
  readonly device: DeviceProfile;
  readonly setOriginHere: () => Promise<void>;
  readonly setOriginAtMachinePoint: (
    pointMm: Vec2,
    assertTargetCurrent?: () => void,
  ) => Promise<void>;
  readonly addCapturedBoard: (shape: BoardShape) => void;
  readonly registerCapturedBoardOutline: (
    shape: Extract<BoardShape, { readonly kind: 'outline' }>,
    rotationDeg: number,
  ) => void;
  readonly updateCapturedBoard: (shape: BoardShape) => void;
};

export type BoardCaptureHandlers = {
  readonly captureError: string | null;
  readonly captureNotice: string | null;
  readonly busy: boolean;
  readonly rect: BestFitRectangle | null;
  readonly onCapture: () => void;
  readonly captureNow: () => Promise<void>;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishCircle: (center: Vec2, diameterMm: number) => Promise<void>;
  readonly onFinishOutline: () => Promise<void>;
  readonly onCorrectBoardPoint: (target: BoardVerificationTarget, confirmed: Vec2) => Promise<void>;
};

export function useBoardCaptureHandlers(args: BoardCaptureHandlerArgs): BoardCaptureHandlers {
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const corners = args.capture.state.corners;
  const rect = corners.length === 4 ? bestFitRectangleFromCorners(corners) : null;
  const commitGeometry = createGeometryCommit(args);
  const captureNow = useCapturePointHandler(args, setCaptureError, setCaptureNotice, setBusy);
  const rectangle = createRectangleFinishHandlers(corners, rect, commitGeometry, setCaptureError);
  return {
    captureError,
    captureNotice,
    busy,
    rect,
    onCapture: () => void captureNow().catch(() => undefined),
    captureNow,
    ...rectangle,
    onFinishCircle: createCircleFinishHandler(
      args,
      commitGeometry,
      setCaptureError,
      setCaptureNotice,
      setBusy,
    ),
    onFinishOutline: createOutlineFinishHandler(
      args,
      commitGeometry,
      setCaptureError,
      setCaptureNotice,
      setBusy,
    ),
    onCorrectBoardPoint: createBoardCorrectionHandler(args, setCaptureError, setCaptureNotice),
  };
}

function useCapturePointHandler(
  args: BoardCaptureHandlerArgs,
  setError: SetMessage,
  setNotice: SetMessage,
  setBusy: Dispatch<SetStateAction<boolean>>,
): () => Promise<void> {
  const capturingRef = useRef(false);
  return async () => {
    if (capturingRef.current) throw new Error('A board point capture is already in progress.');
    if (args.livePosition === null)
      throw new Error('Waiting for a machine position report on the computer.');
    capturingRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await capturePoint(args);
    } catch (error) {
      setError(
        errorMessage(
          error,
          'Could not set the work origin. Check the machine is idle, then try again.',
        ),
      );
      throw error;
    } finally {
      capturingRef.current = false;
      setBusy(false);
    }
  };
}

async function capturePoint(args: BoardCaptureHandlerArgs): Promise<void> {
  if (args.livePosition === null) return;
  if (firstCaptureSetsOrigin(args.capture)) await args.setOriginHere();
  if (!args.capture.isSessionCurrent()) {
    throw new Error('The board capture method changed while the origin was being set. Try again.');
  }
  const epoch = currentRegistrationEpoch();
  assertCaptureEpoch(args.capture, epoch);
  args.capture.capture(args.livePosition, epoch);
}

function createGeometryCommit(
  args: BoardCaptureHandlerArgs,
): (geometry: CapturedBoardGeometry) => void {
  return (geometry) => {
    if (!args.capture.isSessionCurrent()) {
      throw new Error('The board capture method changed before the outline was created.');
    }
    const registrationEpoch = currentRegistrationEpoch();
    if (!boardCaptureCanCommit(args.capture.state, geometry, registrationEpoch)) {
      throw new Error('Board coordinates changed during capture. Start over and capture it again.');
    }
    const shape = capturedBoardShape(geometry);
    if (geometry.kind === 'outline' && shape.kind === 'outline') {
      args.registerCapturedBoardOutline(shape, outlineRotationDeg(geometry));
    } else {
      args.addCapturedBoard(shape);
    }
    const outline = findRegistrationBoxes(useStore.getState().project.scene).find(
      (box) => box.provenance === 'captured-board',
    );
    if (outline === undefined) throw new Error('The captured board outline could not be created.');
    args.capture.commit(geometry, registrationEpoch, outline.id);
  };
}

function createRectangleFinishHandlers(
  corners: ReadonlyArray<Vec2>,
  rect: BestFitRectangle | null,
  commit: (geometry: CapturedBoardGeometry) => void,
  setError: SetMessage,
): Pick<BoardCaptureHandlers, 'onFinishRect' | 'onManualSize'> {
  return {
    onFinishRect: () => {
      const origin = corners[0];
      if (rect === null || origin === undefined) return;
      tryCommitRectangle(
        { kind: 'rect', origin, widthMm: rect.widthMm, heightMm: rect.heightMm },
        commit,
        setError,
      );
    },
    onManualSize: (widthMm, heightMm) => {
      const origin = corners[0];
      if (origin !== undefined) {
        tryCommitRectangle({ kind: 'rect', origin, widthMm, heightMm }, commit, setError);
      }
    },
  };
}

function tryCommitRectangle(
  geometry: Extract<CapturedBoardGeometry, { readonly kind: 'rect' }>,
  commit: (geometry: CapturedBoardGeometry) => void,
  setError: SetMessage,
): void {
  try {
    commit(geometry);
  } catch (error) {
    setError(errorMessage(error, 'Could not create the captured board outline.'));
  }
}

function createCircleFinishHandler(
  args: BoardCaptureHandlerArgs,
  commit: (geometry: CapturedBoardGeometry) => void,
  setError: SetMessage,
  setNotice: SetMessage,
  setBusy: Dispatch<SetStateAction<boolean>>,
): BoardCaptureHandlers['onFinishCircle'] {
  return async (center, diameterMm) => {
    if (!Number.isFinite(diameterMm) || diameterMm < MIN_BOARD_DIMENSION_MM) {
      throw new Error(`Circle diameter must be at least ${MIN_BOARD_DIMENSION_MM} mm.`);
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (args.capture.state.circleMethod === 'rim-fit') await args.setOriginHere();
      commit({ kind: 'circle', center, radiusMm: diameterMm / 2 });
    } catch (error) {
      setError(errorMessage(error, 'Could not set the calculated circle center as origin.'));
      throw error;
    } finally {
      setBusy(false);
    }
  };
}

function createBoardCorrectionHandler(
  args: BoardCaptureHandlerArgs,
  setError: SetMessage,
  setNotice: SetMessage,
): BoardCaptureHandlers['onCorrectBoardPoint'] {
  return async (target, confirmed) => {
    setError(null);
    setNotice(null);
    try {
      const assertCurrent = boardCorrectionOwner(args.capture, target);
      const correction = correctedGeometry(args, target, confirmed);
      if (target.kind === 'outline' && correction.geometry.kind === 'outline') {
        const corner = outlineMachineCorner(correction.geometry, 'front-left');
        if (corner === null) throw new Error('The corrected outline has no front-left corner.');
        await args.setOriginAtMachinePoint(corner);
      } else if (verificationTargetChangesOrigin(target)) {
        await args.setOriginHere();
      }
      const registrationEpoch = assertCurrent();
      args.updateCapturedBoard(capturedBoardShape(correction.geometry));
      args.capture.updateGeometry(correction.geometry, registrationEpoch);
      setCorrectionNotice(target, correction, setNotice);
    } catch (error) {
      setError(errorMessage(error, 'Could not update the captured board.'));
      throw error;
    }
  };
}

function boardCorrectionOwner(
  capture: BoardCapture,
  target: BoardVerificationTarget,
): () => BoardRegistrationEpoch {
  const owner = useStore.getState();
  const outline = findRegistrationBoxes(owner.project.scene).find(
    (box) => box.provenance === 'captured-board',
  );
  const registered = capture.state.registrationEpoch;
  if (
    !capture.isSessionCurrent() ||
    outline?.id !== capture.state.outlineId ||
    registered === null ||
    !capturedBoardOutlineMatches(
      owner.project.scene,
      capture.state.outlineId,
      capture.state.geometry,
    )
  ) {
    throw new Error('The captured board changed. Capture the board again before correcting it.');
  }
  return () => {
    const current = useStore.getState();
    const currentOutline = findRegistrationBoxes(current.project.scene).find(
      (box) => box.provenance === 'captured-board',
    );
    if (
      !capture.isSessionCurrent() ||
      current.projectDocumentEpoch !== owner.projectDocumentEpoch ||
      currentOutline !== outline
    ) {
      throw new Error('The captured board changed. Capture the board again before correcting it.');
    }
    const epoch = currentRegistrationEpoch();
    // Setting this correction's origin may advance its version once. Other
    // coordinate/session changes cannot transfer ownership to this completion.
    const originAdvance = epoch.workOriginVersion - registered.workOriginVersion;
    if (
      epoch.controllerSessionEpoch !== registered.controllerSessionEpoch ||
      epoch.trustedPositionEpoch !== registered.trustedPositionEpoch ||
      originAdvance < 0 ||
      originAdvance > (verificationTargetChangesOrigin(target) ? 1 : 0)
    ) {
      throw new Error('Machine coordinates changed. Capture the board again before correcting it.');
    }
    return epoch;
  };
}

function correctedGeometry(
  args: BoardCaptureHandlerArgs,
  target: BoardVerificationTarget,
  confirmed: Vec2,
) {
  assertRegistrationEpoch(args.capture, currentRegistrationEpoch());
  const geometry = args.capture.state.geometry;
  if (geometry === null) throw new Error('Capture a board before checking its points.');
  const correction = correctCapturedBoardGeometry(geometry, target, confirmed);
  if (correction === null || !largeEnough(correction.geometry)) {
    throw new Error('That correction would make the board invalid or too small.');
  }
  return correction;
}

function assertCaptureEpoch(capture: BoardCapture, current: BoardRegistrationEpoch): void {
  const captured = capture.state.captureEpoch;
  if (captured !== null && !registrationEpochMatches(captured, current)) {
    throw new Error('Machine coordinates changed during capture. Start over and capture it again.');
  }
}

function setCorrectionNotice(
  target: BoardVerificationTarget,
  correction: NonNullable<ReturnType<typeof correctCapturedBoardGeometry>>,
  setNotice: SetMessage,
): void {
  if (correction.crossAxisErrorMm > CROSS_AXIS_NOTICE_MM) {
    setNotice(
      target.kind === 'outline'
        ? `Point saved, but the head was ${correction.crossAxisErrorMm.toFixed(
            1,
          )} mm from where the outline predicted. Check that the head is on the selected anchor.`
        : `Point saved, but it was ${correction.crossAxisErrorMm.toFixed(
            1,
          )} mm off the expected axis. Check that the intended board point matches the selected verification point.`,
    );
    return;
  }
  if (target.kind === 'outline' && (correction.residualMm ?? 0) > 1.5) {
    const residual = correction.residualMm as number;
    setNotice(
      `The outline misses the checked anchors by up to ${residual.toFixed(
        1,
      )} mm. The photo may be distorted: keep artwork at least ${
        Math.ceil(residual) + 1
      } mm inside the edge, or retake the photo with the reference flat on the board.`,
    );
  }
}

function firstCaptureSetsOrigin(capture: BoardCapture): boolean {
  if (capture.state.corners.length !== 0) return false;
  return (
    capture.state.shapeKind === 'rect' ||
    (capture.state.shapeKind === 'circle' && capture.state.circleMethod === 'marked-center')
  );
}

function largeEnough(geometry: CapturedBoardGeometry): boolean {
  if (geometry.kind === 'rect') {
    return (
      geometry.widthMm >= MIN_BOARD_DIMENSION_MM && geometry.heightMm >= MIN_BOARD_DIMENSION_MM
    );
  }
  if (geometry.kind === 'circle') return geometry.radiusMm * 2 >= MIN_BOARD_DIMENSION_MM;
  return outlineGeometryLargeEnough(geometry, MIN_BOARD_DIMENSION_MM);
}

function assertRegistrationEpoch(capture: BoardCapture, current: BoardRegistrationEpoch): void {
  const registered = capture.state.registrationEpoch;
  if (
    registered === null ||
    registered.controllerSessionEpoch !== current.controllerSessionEpoch ||
    registered.trustedPositionEpoch !== current.trustedPositionEpoch ||
    registered.workOriginVersion !== current.workOriginVersion
  ) {
    throw new Error('Machine coordinates changed. Capture the board again before checking it.');
  }
}

function currentRegistrationEpoch(): BoardRegistrationEpoch {
  const laser = useLaserStore.getState();
  return {
    controllerSessionEpoch: laser.controllerSessionEpoch,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    workOriginVersion: laser.workOriginVersion ?? 0,
  };
}

function registrationEpochMatches(
  left: BoardRegistrationEpoch,
  right: BoardRegistrationEpoch,
): boolean {
  return (
    left.controllerSessionEpoch === right.controllerSessionEpoch &&
    left.trustedPositionEpoch === right.trustedPositionEpoch &&
    left.workOriginVersion === right.workOriginVersion
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}
