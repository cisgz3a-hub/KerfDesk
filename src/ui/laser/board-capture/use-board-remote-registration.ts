import { useEffect, useRef } from 'react';
import {
  outlineBoardShape,
  outlineBounds,
  outlineRegistration,
  type OutlineBoardGeometry,
} from '../../../core/scene';
import type { DeviceProfile } from '../../../core/devices';
import { registerBoardRemote, type BoardRemoteStatus } from './board-capture-remote';
import { remoteBoardFinishReview } from './board-remote-finish-review';
import type { BoardCapture, BoardRegistrationEpoch } from './use-board-capture';
import type { BoardCaptureHandlers } from './use-board-capture-handlers';
import { roundToTenth } from '../../../core/util/rounding';

type LatestBoardCapture = {
  readonly capture: BoardCapture;
  readonly handlers: BoardCaptureHandlers;
  readonly currentEpoch: BoardRegistrationEpoch;
  readonly busy: boolean;
  readonly device: DeviceProfile;
};

export function useBoardRemoteRegistration(open: boolean, current: LatestBoardCapture): void {
  const latest = useRef<LatestBoardCapture>(current);
  latest.current = current;
  useEffect(() => {
    if (!open) return;
    return registerBoardRemote({
      status: () => remoteBoardStatus(latest.current),
      finishReview: () => {
        const { capture, handlers, device } = latest.current;
        return remoteBoardFinishReview(capture.state, handlers.rect, device);
      },
      capture: async () => captureRemotePoint(latest),
      finish: async () => finishRemoteBoard(latest),
    });
  }, [open]);
}

async function captureRemotePoint(
  latest: React.MutableRefObject<LatestBoardCapture>,
): Promise<void> {
  if (latest.current.busy) throw new Error('Place Board is busy on the computer.');
  if (latest.current.capture.state.committed)
    throw new Error('Start a new board capture on the computer first.');
  const before = latest.current.capture.state.corners.length;
  await latest.current.handlers.captureNow();
  await waitForLatest(
    () => latest.current.capture.state.corners.length > before,
    () => 'The board point was not captured.',
  );
}

async function finishRemoteBoard(
  latest: React.MutableRefObject<LatestBoardCapture>,
): Promise<void> {
  const owner = latest.current;
  if (owner.capture.state.shapeKind === 'outline') await owner.handlers.onFinishOutline();
  else if (owner.capture.state.shapeKind === 'rect') owner.handlers.onFinishRect();
  else throw new Error('Finish the circle capture on the computer.');
  await waitForLatest(
    () => latest.current.capture.state.committed,
    () => latest.current.handlers.captureError ?? 'The board was not created.',
  );
}

async function waitForLatest(accepted: () => boolean, timeoutMessage: () => string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!accepted() && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  if (!accepted()) throw new Error(timeoutMessage());
}

function remoteBoardStatus(latest: LatestBoardCapture): BoardRemoteStatus {
  const state = latest.capture.state;
  return {
    panelOpen: true,
    shape: state.shapeKind,
    committed: state.committed,
    captures: state.corners.length,
    capturesNeeded: capturesNeeded(state),
    hasOutlineDraft: state.outlineDraft !== null,
    coordinatesCurrent: coordinatesCurrent(state, latest.currentEpoch),
    busy: latest.busy,
    board: boardSummary(state.geometry),
  };
}

function capturesNeeded(state: BoardCapture['state']): number | null {
  if (state.committed) return null;
  if (state.shapeKind === 'rect') return 4;
  if (state.shapeKind === 'outline') return 2;
  return state.circleMethod === 'rim-fit' ? 4 : 2;
}

function coordinatesCurrent(
  state: BoardCapture['state'],
  current: BoardRegistrationEpoch,
): boolean {
  const epoch = state.committed ? state.registrationEpoch : state.captureEpoch;
  if (epoch === null) return state.corners.length === 0;
  return (
    epoch.controllerSessionEpoch === current.controllerSessionEpoch &&
    epoch.trustedPositionEpoch === current.trustedPositionEpoch &&
    epoch.workOriginVersion === current.workOriginVersion
  );
}

function boardSummary(geometry: BoardCapture['state']['geometry']): BoardRemoteStatus['board'] {
  if (geometry === null) return null;
  if (geometry.kind === 'rect') {
    return {
      kind: 'rect',
      widthMm: roundToTenth(geometry.widthMm),
      heightMm: roundToTenth(geometry.heightMm),
    };
  }
  if (geometry.kind === 'circle') {
    const diameter = roundToTenth(geometry.radiusMm * 2);
    return { kind: 'circle', widthMm: diameter, heightMm: diameter };
  }
  return outlineSummary(geometry);
}

function outlineSummary(geometry: OutlineBoardGeometry): NonNullable<BoardRemoteStatus['board']> {
  const shape = outlineBoardShape(geometry);
  const points = shape?.pointsMm ?? geometry.localPointsMm;
  const bounds = outlineBounds(points);
  const registration = geometry.measured.length >= 3 ? outlineRegistration(geometry) : null;
  return {
    kind: 'outline',
    widthMm: roundToTenth(bounds.maxX - bounds.minX),
    heightMm: roundToTenth(bounds.maxY - bounds.minY),
    anchors: geometry.anchorIndices.length,
    checkedAnchors: geometry.measured.length,
    ...(registration === null ? {} : { maxMissMm: roundToTenth(registration.maxResidualMm) }),
  };
}
