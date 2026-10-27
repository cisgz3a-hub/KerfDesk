import type { Dispatch, SetStateAction } from 'react';
import { sceneAxisSigns, type DeviceProfile } from '../../../core/devices';
import {
  outlineGeometryFromCaptures,
  outlineBoardShape,
  outlineBounds,
  outlineMachineCorner,
  outlineRegistration,
  type CapturedBoardGeometry,
  type Vec2,
  type OutlineBoardGeometry,
} from '../../../core/scene';
import type { BoardCapture } from './use-board-capture';
import { boardCaptureOriginOwner } from './board-capture-origin-owner';
import { outlineScaleNotice } from './board-finish-checks';

type SetMessage = Dispatch<SetStateAction<string | null>>;

export function createOutlineFinishHandler(
  args: {
    readonly capture: BoardCapture;
    readonly device: DeviceProfile;
    readonly setOriginAtMachinePoint: (
      pointMm: Vec2,
      assertTargetCurrent?: () => void,
    ) => Promise<void>;
  },
  commit: (geometry: CapturedBoardGeometry) => void,
  setError: SetMessage,
  setNotice: SetMessage,
  setBusy: Dispatch<SetStateAction<boolean>>,
): () => Promise<void> {
  return async () => {
    const draft = args.capture.state.outlineDraft;
    const [first, second] = args.capture.state.corners;
    if (draft === null || first === undefined || second === undefined) return;
    setError(null);
    setNotice(null);
    const result = outlineGeometryFromCaptures(
      draft,
      [first, second],
      sceneAxisSigns(args.device.origin),
    );
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setScaleNotice(result.scale, setNotice);
    const corner = outlineMachineCorner(result.geometry, 'front-left');
    if (corner === null) {
      setError('The outline registration could not locate its front-left corner.');
      return;
    }
    setBusy(true);
    try {
      const owner = boardCaptureOriginOwner(args.capture);
      owner.assertBeforeWrite();
      await args.setOriginAtMachinePoint(corner, owner.assertBeforeWrite);
      owner.assertAfterWrite();
      commit(result.geometry);
    } catch (error) {
      setError(errorMessage(error, 'Could not set the outline board origin.'));
      throw error;
    } finally {
      setBusy(false);
    }
  };
}

/** How far the head-measured board is turned from the outline as drawn from the photo. */
export function outlineRotationDeg(geometry: OutlineBoardGeometry): number {
  const registration = outlineRegistration(geometry);
  return registration === null ? 0 : (registration.transform.rotationRad * 180) / Math.PI;
}

export function outlineGeometryLargeEnough(
  geometry: OutlineBoardGeometry,
  minimumMm: number,
): boolean {
  const points = outlineBoardShape(geometry)?.pointsMm;
  if (points === undefined) return false;
  const bounds = outlineBounds(points);
  return bounds.maxX - bounds.minX >= minimumMm && bounds.maxY - bounds.minY >= minimumMm;
}

function setScaleNotice(scale: number, setNotice: SetMessage): void {
  const notice = outlineScaleNotice(scale);
  if (notice !== null) setNotice(notice);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}
