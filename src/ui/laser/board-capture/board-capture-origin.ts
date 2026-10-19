// board-capture-origin — the work-origin and coordinate helpers shared by the
// Place board capture and correction handlers (ADR-124, ADR-636).

import type { Dispatch, SetStateAction } from 'react';
import type { BoardShape, Vec2 } from '../../../core/scene';
import type { BoardPolygonIssue } from '../../../core/scene/board-polygon';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import { useLaserStore } from '../../state/laser-store';
import { machinePointOnBed } from './board-sight';
import type { BoardCapture, BoardRegistrationEpoch } from './use-board-capture';

export type SetMessage = Dispatch<SetStateAction<string | null>>;

export type BoardCaptureHandlerArgs = {
  readonly capture: BoardCapture;
  readonly livePosition: Vec2 | null;
  readonly setOriginHere: () => Promise<void>;
  readonly setOriginAtMachinePoint: (point: Vec2) => Promise<void>;
  readonly addCapturedBoard: (shape: BoardShape, at?: Vec2) => void;
  readonly updateCapturedBoard: (shape: BoardShape) => void;
};

// The head is "at" a point when within a micron: then the ordinary Set origin
// here (G92 X0 Y0) is the same write as an offset G92 at that point.
const SAME_POINT_MM = 1e-3;

/**
 * Make `point` (machine mm) the work origin. When the head is there already
 * this is the ordinary Set origin here; otherwise one offset G92 at the live
 * position puts the origin there without moving the head.
 */
export async function setBoardOrigin(
  args: Pick<BoardCaptureHandlerArgs, 'setOriginHere' | 'setOriginAtMachinePoint'>,
  point: Vec2,
): Promise<void> {
  const head = currentMachinePosition();
  if (head !== null && Math.hypot(head.x - point.x, head.y - point.y) <= SAME_POINT_MM) {
    await args.setOriginHere();
    return;
  }
  await args.setOriginAtMachinePoint(point);
}

export function boardPolygonIssueMessage(issue: BoardPolygonIssue): string {
  switch (issue) {
    case 'too-few-points':
      return 'Capture at least three corners to make a shape.';
    case 'not-finite':
      return 'A captured corner has no valid machine position. Start over.';
    case 'too-thin':
      return 'Those corners are almost in a straight line. Capture corners all the way around the board.';
    case 'self-crossing':
      return 'The outline crosses itself. Undo the last corners and capture them in order around the board.';
  }
}

export function currentMachinePosition(): Vec2 | null {
  const laser = useLaserStore.getState();
  return inferCurrentMachinePosition(
    laser.statusReport,
    laser.wcoCache,
    laser.controllerSettings?.reportInches === true,
  );
}

export function currentRegistrationEpoch(): BoardRegistrationEpoch {
  const laser = useLaserStore.getState();
  return {
    controllerSessionEpoch: laser.controllerSessionEpoch,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    workOriginVersion: laser.workOriginVersion ?? 0,
  };
}

export function registrationEpochMatches(
  left: BoardRegistrationEpoch,
  right: BoardRegistrationEpoch,
): boolean {
  return (
    left.controllerSessionEpoch === right.controllerSessionEpoch &&
    left.trustedPositionEpoch === right.trustedPositionEpoch &&
    left.workOriginVersion === right.workOriginVersion
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}

/**
 * The outline's top-left on the canvas: where the board sits on the bed, from
 * its front-left (or centre) machine point. Display only — the burn is anchored
 * to the work origin — so the store falls back to centring it when off the bed.
 */
export function capturedOutlineTopLeft(geometry: CapturedBoardGeometry): Vec2 | undefined {
  switch (geometry.kind) {
    case 'rect': {
      const frontLeft = machinePointOnBed(geometry.origin);
      return frontLeft === null
        ? undefined
        : { x: frontLeft.x, y: frontLeft.y - geometry.heightMm };
    }
    case 'circle': {
      const center = machinePointOnBed(geometry.center);
      const r = geometry.radiusMm;
      return center === null ? undefined : { x: center.x - r, y: center.y - r };
    }
    case 'polygon': {
      const frontLeft = machinePointOnBed(geometry.polygon.origin);
      const height = geometry.polygon.heightMm;
      return frontLeft === null ? undefined : { x: frontLeft.x, y: frontLeft.y - height };
    }
  }
}
