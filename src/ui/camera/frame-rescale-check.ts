// A camera picture of the calibrated shape but another size (ADR-440
// Amendment 9, rolling audit v13 Y1-P1-1). A camera can deliver it by
// shrinking its whole view, which the lens scaled to the new size describes,
// or by cutting out the middle of its sensor, which it does not: a 1080p
// calibration used on a 720p crop of the same shape put the picture 62 mm off
// on the target and 117 mm on the bed, with no notice. The two look alike in
// the frame's size, so such a size is not used until it is checked, once per
// calibration and size in this session:
//
// - against the view kept when the calibration was known good (ADR-663
//   Amendment 3): a resized picture shows the same view, a cut-out shows a
//   magnified one; or
// - by Check camera, which re-detects the target's rings at the new size.

import { create } from 'zustand';
import type { CameraPose, LensModel } from '../../core/camera/model/camera-model';
import {
  measureViewShift,
  surroundMask,
  type ViewThumbnail,
} from '../../core/camera/model/view-shift';

/** `resize`: the same view, smaller or larger. `differs`: not the view the
 * calibration saw (a cut-out of it, or the camera moved as well). */
export type FrameRescaleVerdict = 'resize' | 'differs';

// A pure resize matches its reference almost exactly; anything weaker or
// shifted is not proof of one.
const RESIZE_MIN_SCORE = 0.8;
const RESIZE_MAX_SHIFT_PX = 1;

type CalibratedSize = {
  readonly calibratedAt: string;
  readonly lens: Pick<LensModel, 'imageWidth' | 'imageHeight'>;
};

const useFrameRescaleStore = create<{
  readonly verdicts: Readonly<Record<string, FrameRescaleVerdict>>;
}>(() => ({ verdicts: {} }));

function rescaleKey(model: CalibratedSize, width: number, height: number): string {
  return `${model.calibratedAt}|${model.lens.imageWidth}x${model.lens.imageHeight}|${width}x${height}`;
}

/** What this session found for `model` at `width` × `height`, if it has looked. */
export function frameRescaleVerdict(
  model: CalibratedSize,
  width: number,
  height: number,
): FrameRescaleVerdict | undefined {
  return useFrameRescaleStore.getState().verdicts[rescaleKey(model, width, height)];
}

export function recordFrameRescale(
  model: CalibratedSize,
  width: number,
  height: number,
  verdict: FrameRescaleVerdict,
): void {
  const key = rescaleKey(model, width, height);
  if (useFrameRescaleStore.getState().verdicts[key] === verdict) return;
  useFrameRescaleStore.setState((state) => ({ verdicts: { ...state.verdicts, [key]: verdict } }));
}

/** Re-renders when a size is proved or found to differ, so a held picture is redrawn. */
export function useFrameRescaleVerdicts(): Readonly<Record<string, FrameRescaleVerdict>> {
  return useFrameRescaleStore((state) => state.verdicts);
}

/** Forget every verdict (tests, and a new session). */
export function resetFrameRescaleChecks(): void {
  useFrameRescaleStore.setState({ verdicts: {} });
}

/**
 * Compare `frame` with the calibration's kept view, over what the camera sees
 * around the bed, through the lens scaled to the frame. Null when there is too
 * little around the bed to tell.
 */
export function frameRescaleFromView(args: {
  readonly reference: ViewThumbnail;
  /** The picture's thumbnail at the reference's width. */
  readonly current: ViewThumbnail;
  readonly scaledLens: LensModel;
  readonly pose: CameraPose;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): FrameRescaleVerdict | null {
  const { current } = args;
  if (current.height !== args.reference.height) return 'differs';
  const mask = surroundMask({
    lens: args.scaledLens,
    pose: args.pose,
    thumbWidth: current.width,
    thumbHeight: current.height,
    bedWidthMm: args.bedWidthMm,
    bedHeightMm: args.bedHeightMm,
  });
  const shift = measureViewShift(args.reference, current, mask);
  if (shift === null) return null;
  return shift.score >= RESIZE_MIN_SCORE &&
    Math.hypot(shift.dxPx, shift.dyPx) <= RESIZE_MAX_SHIFT_PX
    ? 'resize'
    : 'differs';
}

/** The notice for a frame size not proved to be a resize. */
export function frameRescaleIssue(
  model: CalibratedSize,
  width: number,
  height: number,
  verdict: FrameRescaleVerdict | undefined,
): string {
  const calibrated = `${model.lens.imageWidth} × ${model.lens.imageHeight}`;
  const now = `The camera picture is ${width} × ${height}, not the ${calibrated} it was calibrated at`;
  if (verdict === 'differs') {
    return `${now}, and it does not show the same view as the calibration did: the camera may be cutting out part of its picture instead of shrinking it, or it has moved. Set the camera back to ${calibrated}, or calibrate again at this size.`;
  }
  return `${now}. A camera can make a smaller picture by cutting out part of its view instead of shrinking all of it, and the two look alike, so the picture is not placed until it is checked. Set the camera back to ${calibrated}, use Check camera with the target on the bed, or calibrate again. A camera fixed above the bed is also checked against the view kept at calibration when it starts and when the picture is refreshed.`;
}
