// What remote finish_board must respect before it creates the board. The PC
// operator reads the off-square and first-corner warnings under the measured
// rectangle before clicking Create board outline; a remote client cannot see
// them, so like Zero Z (ADR-657) the remote finish is refused where the PC would
// warn, and the board can still be created on the computer. The outline scale
// note comes with the created board on the PC, so the receipt carries it
// (ADR-654 Amendment 1).

import { sceneAxisSigns, type DeviceProfile } from '../../../core/devices';
import { outlineGeometryFromCaptures, type BestFitRectangle } from '../../../core/scene';
import type { BoardFinishReview } from './board-capture-remote';
import { measuredRectChecks, outlineScaleNotice } from './board-finish-checks';
import type { BoardCapture } from './use-board-capture';

type CaptureState = BoardCapture['state'];

export function remoteBoardFinishReview(
  state: CaptureState,
  rect: BestFitRectangle | null,
  device: DeviceProfile,
): BoardFinishReview {
  if (state.shapeKind === 'circle') return refuse('Finish the circle capture on the computer.');
  if (state.shapeKind === 'rect') return rectangleReview(state, rect);
  return outlineReview(state, device);
}

function rectangleReview(state: CaptureState, rect: BestFitRectangle | null): BoardFinishReview {
  if (rect === null) return refuse('Capture all four corners before finishing the board.');
  const checks = measuredRectChecks(rect, state.corners);
  if (checks.tooSmall) {
    return refuse(
      'The captured corners are too close together to be a board. Start over on the computer and jog to each corner.',
    );
  }
  if (checks.firstCornerOffsetMm !== null) {
    return refuse(
      'The first corner captured was not the bottom-left, so the work origin is at the wrong corner. Start over on the computer and capture the bottom-left corner first.',
    );
  }
  if (checks.offSquareMm !== null) {
    return refuse(
      `The corners are ${checks.offSquareMm.toFixed(
        0,
      )} mm off a rectangle square to the bed, so the board may be turned or a corner captured in the wrong place. Check it on the computer: recapture, or create the board there if it looks right.`,
    );
  }
  return { refusal: null, notice: null };
}

function outlineReview(state: CaptureState, device: DeviceProfile): BoardFinishReview {
  const [first, second] = state.corners;
  if (state.outlineDraft === null || first === undefined || second === undefined)
    return refuse('Capture both outline points before finishing the board.');
  const result = outlineGeometryFromCaptures(
    state.outlineDraft,
    [first, second],
    sceneAxisSigns(device.origin),
  );
  if (!result.ok) return refuse(result.reason);
  return { refusal: null, notice: outlineScaleNotice(result.scale) };
}

function refuse(refusal: string): BoardFinishReview {
  return { refusal, notice: null };
}
