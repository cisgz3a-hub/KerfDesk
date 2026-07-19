import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  bestFitRectangleFromCorners,
  findRegistrationBoxes,
  type BestFitRectangle,
  type BoardShape,
  type Vec2,
} from '../../../core/scene';
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
import {
  boardCaptureCanCommit,
  type BoardCapture,
  type BoardRegistrationEpoch,
} from './use-board-capture';

type SetMessage = Dispatch<SetStateAction<string | null>>;
type BoardCaptureHandlerArgs = {
  readonly capture: BoardCapture;
  readonly livePosition: Vec2 | null;
  readonly setOriginHere: () => Promise<void>;
  readonly addCapturedBoard: (shape: BoardShape) => void;
  readonly updateCapturedBoard: (shape: BoardShape) => void;
};

export type BoardCaptureHandlers = {
  readonly captureError: string | null;
  readonly captureNotice: string | null;
  readonly busy: boolean;
  readonly rect: BestFitRectangle | null;
  readonly onCapture: () => void;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishCircle: (center: Vec2, diameterMm: number) => Promise<void>;
  readonly onCorrectBoardPoint: (target: BoardVerificationTarget, confirmed: Vec2) => Promise<void>;
};

export function useBoardCaptureHandlers(args: BoardCaptureHandlerArgs): BoardCaptureHandlers {
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const corners = args.capture.state.corners;
  const rect = corners.length === 4 ? bestFitRectangleFromCorners(corners) : null;
  const commitGeometry = createGeometryCommit(args);
  const rectangle = createRectangleFinishHandlers(corners, rect, commitGeometry, setCaptureError);
  return {
    captureError,
    captureNotice,
    busy,
    rect,
    onCapture: useCapturePointHandler(args, setCaptureError, setCaptureNotice, setBusy),
    ...rectangle,
    onFinishCircle: createCircleFinishHandler(
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
): () => void {
  const capturingRef = useRef(false);
  return () => {
    if (capturingRef.current || args.livePosition === null) return;
    capturingRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    void capturePoint(args)
      .catch((error: unknown) =>
        setError(
          errorMessage(
            error,
            'Could not set the work origin. Check the machine is idle, then try again.',
          ),
        ),
      )
      .finally(() => {
        capturingRef.current = false;
        setBusy(false);
      });
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
    args.addCapturedBoard(capturedBoardShape(geometry));
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
      const correction = correctedGeometry(args, target, confirmed);
      if (verificationTargetChangesOrigin(target)) await args.setOriginHere();
      args.updateCapturedBoard(capturedBoardShape(correction.geometry));
      args.capture.updateGeometry(correction.geometry, currentRegistrationEpoch());
      setCrossAxisNotice(correction.crossAxisErrorMm, setNotice);
    } catch (error) {
      setError(errorMessage(error, 'Could not update the captured board.'));
      throw error;
    }
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

function setCrossAxisNotice(errorMm: number, setNotice: SetMessage): void {
  if (errorMm <= 5) return;
  setNotice(
    `Point saved, but it was ${errorMm.toFixed(1)} mm off the expected axis. ` +
      'Place Board assumes the rectangle is square to the bed.',
  );
}

function firstCaptureSetsOrigin(capture: BoardCapture): boolean {
  if (capture.state.corners.length !== 0) return false;
  return (
    capture.state.shapeKind === 'rect' ||
    (capture.state.shapeKind === 'circle' && capture.state.circleMethod === 'marked-center')
  );
}

function largeEnough(geometry: CapturedBoardGeometry): boolean {
  return geometry.kind === 'rect'
    ? geometry.widthMm >= MIN_BOARD_DIMENSION_MM && geometry.heightMm >= MIN_BOARD_DIMENSION_MM
    : geometry.radiusMm * 2 >= MIN_BOARD_DIMENSION_MM;
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
