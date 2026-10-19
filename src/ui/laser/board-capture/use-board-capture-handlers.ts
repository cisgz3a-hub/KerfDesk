// use-board-capture-handlers — what the Place board panel does when the
// operator captures a point or creates the outline (ADR-124, ADR-126, ADR-636).
// Points are recorded where the operator aims (the head, or the positioning
// light with its offset allowed for); the work origin is set either at the
// first corner or, for a custom shape or a rectangle captured from another
// corner, at the board's front-left as the outline is created.

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  bestFitRectangleFromCorners,
  findRegistrationBoxes,
  firstCornerOffsetMm,
  type BestFitRectangle,
  type Vec2,
} from '../../../core/scene';
import { boardFrontLeftCorner } from '../../../core/scene/board-capture';
import {
  boardPolygonFromPoints,
  type BoardAxisSigns,
  type BoardPolygonResult,
} from '../../../core/scene/board-polygon';
import {
  capturedBoardOrigin,
  capturedBoardShape,
  type BoardVerificationTarget,
  type CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { useStore } from '../../state';
import {
  boardPolygonIssueMessage,
  capturedOutlineTopLeft,
  currentRegistrationEpoch,
  errorMessage,
  registrationEpochMatches,
  setBoardOrigin,
  type BoardCaptureHandlerArgs,
  type SetMessage,
} from './board-capture-origin';
import { createBoardCorrectionHandler } from './board-correction-handler';
import { boardAxisSigns, isFrontLeftSigns, sightedPoint } from './board-sight';
import { MIN_BOARD_DIMENSION_MM } from './constants';
import {
  boardCaptureCanCommit,
  type BoardCapture,
  type BoardRegistrationEpoch,
} from './use-board-capture';

type SetBusy = Dispatch<SetStateAction<boolean>>;
// Above this the first captured corner is a different corner from the board's
// front-left (ADR-124's "wrong first corner"); the origin is moved there at
// commit instead of asking the operator to start over (ADR-636).
const FIRST_CORNER_REANCHOR_MM = 5;

export type BoardCaptureHandlers = {
  readonly captureError: string | null;
  readonly captureNotice: string | null;
  readonly busy: boolean;
  readonly rect: BestFitRectangle | null;
  readonly polygon: BoardPolygonResult | null;
  readonly onCapture: () => void;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishPolygon: () => void;
  readonly onFinishCircle: (center: Vec2, diameterMm: number) => Promise<void>;
  readonly onCorrectBoardPoint: (target: BoardVerificationTarget, confirmed: Vec2) => Promise<void>;
};

type GeometryCommit = (geometry: CapturedBoardGeometry, originAdvance?: number) => void;

export function useBoardCaptureHandlers(args: BoardCaptureHandlerArgs): BoardCaptureHandlers {
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { corners, shapeKind, committed } = args.capture.state;
  const rect =
    shapeKind === 'rect' && corners.length === 4 ? bestFitRectangleFromCorners(corners) : null;
  const polygon =
    shapeKind === 'polygon' && !committed
      ? boardPolygonFromPoints(corners, boardAxisSigns())
      : null;
  const commitGeometry = createGeometryCommit(args);
  const messages = { setError: setCaptureError, setNotice: setCaptureNotice, setBusy };
  return {
    captureError,
    captureNotice,
    busy,
    rect,
    polygon,
    onCapture: useCapturePointHandler(args, setCaptureError, setCaptureNotice, setBusy),
    ...createRectangleFinishHandlers(args, rect, commitGeometry, messages),
    onFinishPolygon: createPolygonFinishHandler(args, commitGeometry, messages),
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
  setBusy: SetBusy,
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
  // With the positioning light on, the corner is where the light points.
  const point = sightedPoint(args.livePosition);
  if (firstCaptureSetsOrigin(args.capture)) await setBoardOrigin(args, point);
  if (!args.capture.isSessionCurrent()) {
    throw new Error('The board capture method changed while the origin was being set. Try again.');
  }
  const epoch = currentRegistrationEpoch();
  assertCaptureEpoch(args.capture, epoch);
  args.capture.capture(point, epoch);
}

/**
 * Make `point` (machine mm) the work origin. When the head is there already
 * this is the ordinary Set origin here; otherwise one offset G92 at the live
 * position puts the origin there without moving the head.
 */
function createGeometryCommit(args: BoardCaptureHandlerArgs): GeometryCommit {
  return (geometry, originAdvance = 0) => {
    if (!args.capture.isSessionCurrent()) {
      throw new Error('The board capture method changed before the outline was created.');
    }
    const registrationEpoch = currentRegistrationEpoch();
    if (!boardCaptureCanCommit(args.capture.state, geometry, registrationEpoch, originAdvance)) {
      throw new Error('Board coordinates changed during capture. Start over and capture it again.');
    }
    args.addCapturedBoard(capturedBoardShape(geometry), capturedOutlineTopLeft(geometry));
    const outline = findRegistrationBoxes(useStore.getState().project.scene).find(
      (box) => box.provenance === 'captured-board',
    );
    if (outline === undefined) throw new Error('The captured board outline could not be created.');
    args.capture.commit(geometry, registrationEpoch, outline.id, originAdvance);
  };
}

type Messages = {
  readonly setError: SetMessage;
  readonly setNotice: SetMessage;
  readonly setBusy: SetBusy;
};

function createRectangleFinishHandlers(
  args: BoardCaptureHandlerArgs,
  rect: BestFitRectangle | null,
  commit: GeometryCommit,
  messages: Messages,
): Pick<BoardCaptureHandlers, 'onFinishRect' | 'onManualSize'> {
  const corners = args.capture.state.corners;
  return {
    onFinishRect: () => {
      const first = corners[0];
      if (rect === null || first === undefined) return;
      const signs = boardAxisSigns();
      const frontLeft = boardFrontLeftCorner(corners, signs);
      const offset = firstCornerOffsetMm(corners, signs);
      const reanchor = frontLeft !== null && offset !== null && offset > FIRST_CORNER_REANCHOR_MM;
      const geometry = rectangleGeometry(
        reanchor ? frontLeft : first,
        rect.widthMm,
        rect.heightMm,
        signs,
      );
      if (!reanchor) {
        tryCommit(() => commit(geometry), messages.setError);
        return;
      }
      void commitWithNewOrigin(args, geometry, commit, messages).then((done) => {
        if (done) {
          messages.setNotice(
            'The first corner was not the front-left one, so the work origin was moved to the ' +
              'front-left corner.',
          );
        }
      });
    },
    onManualSize: (widthMm, heightMm) => {
      const origin = corners[0];
      if (origin !== undefined) {
        const geometry = rectangleGeometry(origin, widthMm, heightMm, boardAxisSigns());
        tryCommit(() => commit(geometry), messages.setError);
      }
    },
  };
}

function rectangleGeometry(
  origin: Vec2,
  widthMm: number,
  heightMm: number,
  signs: BoardAxisSigns,
): CapturedBoardGeometry {
  return {
    kind: 'rect',
    origin,
    widthMm,
    heightMm,
    ...(isFrontLeftSigns(signs) ? {} : { axisSigns: signs }),
  };
}

function createPolygonFinishHandler(
  args: BoardCaptureHandlerArgs,
  commit: GeometryCommit,
  messages: Messages,
): () => void {
  return () => {
    const signs = boardAxisSigns();
    const result = boardPolygonFromPoints(args.capture.state.corners, signs);
    if (result.kind === 'error') {
      messages.setError(boardPolygonIssueMessage(result.issue));
      return;
    }
    const { polygon } = result;
    if (polygon.widthMm < MIN_BOARD_DIMENSION_MM || polygon.heightMm < MIN_BOARD_DIMENSION_MM) {
      messages.setError(
        'That shape is too small to be a board. Jog to each corner and capture it.',
      );
      return;
    }
    void commitWithNewOrigin(
      args,
      { kind: 'polygon', polygon, axisSigns: signs },
      commit,
      messages,
    ).then((done) => {
      if (done && polygon.reordered) {
        messages.setNotice(
          'The corners crossed over in the order they were captured, so they were joined ' +
            'around the board instead. Check the outline matches.',
        );
      }
    });
  };
}

// Set the origin at the board's reference point, then commit; the origin
// write is the one advance of the work-origin version the commit accepts.
async function commitWithNewOrigin(
  args: BoardCaptureHandlerArgs,
  geometry: CapturedBoardGeometry,
  commit: GeometryCommit,
  messages: Messages,
): Promise<boolean> {
  messages.setError(null);
  messages.setNotice(null);
  messages.setBusy(true);
  try {
    if (!args.capture.isSessionCurrent()) {
      throw new Error('The board capture method changed before the outline was created.');
    }
    await setBoardOrigin(args, capturedBoardOrigin(geometry));
    commit(geometry, 1);
    return true;
  } catch (error) {
    messages.setError(errorMessage(error, 'Could not set the board origin. Try again.'));
    return false;
  } finally {
    messages.setBusy(false);
  }
}

function tryCommit(commit: () => void, setError: SetMessage): void {
  try {
    commit();
  } catch (error) {
    setError(errorMessage(error, 'Could not create the captured board outline.'));
  }
}

function createCircleFinishHandler(
  args: BoardCaptureHandlerArgs,
  commit: GeometryCommit,
  setError: SetMessage,
  setNotice: SetMessage,
  setBusy: SetBusy,
): BoardCaptureHandlers['onFinishCircle'] {
  return async (center, diameterMm) => {
    if (!Number.isFinite(diameterMm) || diameterMm < MIN_BOARD_DIMENSION_MM) {
      throw new Error(`Circle diameter must be at least ${MIN_BOARD_DIMENSION_MM} mm.`);
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (args.capture.state.circleMethod === 'rim-fit') await setBoardOrigin(args, center);
      const signs = boardAxisSigns();
      commit({
        kind: 'circle',
        center,
        radiusMm: diameterMm / 2,
        ...(isFrontLeftSigns(signs) ? {} : { axisSigns: signs }),
      });
    } catch (error) {
      setError(errorMessage(error, 'Could not set the calculated circle center as origin.'));
      throw error;
    } finally {
      setBusy(false);
    }
  };
}

function assertCaptureEpoch(capture: BoardCapture, current: BoardRegistrationEpoch): void {
  const captured = capture.state.captureEpoch;
  if (captured !== null && !registrationEpochMatches(captured, current)) {
    throw new Error('Machine coordinates changed during capture. Start over and capture it again.');
  }
}

function firstCaptureSetsOrigin(capture: BoardCapture): boolean {
  if (capture.state.corners.length !== 0) return false;
  return (
    capture.state.shapeKind === 'rect' ||
    (capture.state.shapeKind === 'circle' && capture.state.circleMethod === 'marked-center')
  );
}
