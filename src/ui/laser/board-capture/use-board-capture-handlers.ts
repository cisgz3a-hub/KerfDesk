// use-board-capture-handlers — the capture / commit handlers for the Place Board
// panel (ADR-124 / ADR-126), extracted so BoardCapturePanel stays under the
// function-size cap. Owns the in-flight guard + the origin-write error message,
// and resolves the rectangle from the captured corners.

import { useRef, useState } from 'react';
import {
  bestFitRectangleFromCorners,
  boardCornersFromOrigin,
  BOARD_CORNER_COUNT,
  type BestFitRectangle,
  type BoardShape,
  type Vec2,
} from '../../../core/scene';
import type { BoardCapture } from './use-board-capture';

export type BoardCaptureHandlers = {
  readonly captureError: string | null;
  readonly rect: BestFitRectangle | null;
  readonly onCapture: () => void;
  readonly onFinishRect: () => void;
  readonly onManualSize: (widthMm: number, heightMm: number) => void;
  readonly onFinishCircle: (diameterMm: number) => void;
};

export function useBoardCaptureHandlers(args: {
  readonly capture: BoardCapture;
  readonly livePosition: Vec2 | null;
  readonly setOriginHere: () => Promise<void>;
  readonly addCapturedBoardBox: (widthMm: number, heightMm: number) => void;
  readonly addCapturedBoard: (shape: BoardShape) => void;
}): BoardCaptureHandlers {
  const { capture, livePosition } = args;
  const capturingRef = useRef(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const corners = capture.state.corners;
  const rect = corners.length === BOARD_CORNER_COUNT ? bestFitRectangleFromCorners(corners) : null;

  const handleCapture = async (): Promise<void> => {
    if (capturingRef.current || livePosition === null) return;
    capturingRef.current = true;
    setCaptureError(null);
    try {
      // The first point is the origin (rect bottom-left / circle centre): set the
      // origin before recording so a failed G92 write can't leave a point with no
      // origin behind it.
      if (corners.length === 0) await args.setOriginHere();
      capture.capture(livePosition);
    } catch {
      setCaptureError('Could not set the work origin. Check the machine is idle, then try again.');
    } finally {
      capturingRef.current = false;
    }
  };

  const onFinishRect = (): void => {
    if (rect === null) return;
    args.addCapturedBoardBox(rect.widthMm, rect.heightMm);
    capture.commit();
  };

  const onManualSize = (widthMm: number, heightMm: number): void => {
    const origin = corners[0];
    if (origin === undefined) return;
    args.addCapturedBoardBox(widthMm, heightMm);
    capture.commitManual(boardCornersFromOrigin(origin, widthMm, heightMm));
  };

  const onFinishCircle = (diameterMm: number): void => {
    if (corners[0] === undefined) return;
    args.addCapturedBoard({ kind: 'circle', diameterMm });
    capture.commitCircle(diameterMm);
  };

  return {
    captureError,
    rect,
    onCapture: () => void handleCapture().catch(() => undefined),
    onFinishRect,
    onManualSize,
    onFinishCircle,
  };
}
