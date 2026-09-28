// The burn check around one job (ADR-490): a flat picture of the job's part
// of the bed as the job starts, another once it has finished and the smoke
// has cleared, and the comparison of the two against the job's path. Only a
// laser job on a camera fixed over the bed with its own calibration can be
// checked; anything else says why not instead of guessing.

import {
  burnCheckPicture,
  checkBurn,
  type Disc,
} from '../../../core/camera/job-watch/burn-comparison';
import { watchPixelsPerMm } from '../../../core/camera/job-watch/job-area';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type { Vec2 } from '../../../core/scene';
import type { CanvasMotionPlan } from '../../state/canvas-motion-plan';
import { burnRouteMasks, firstBurnRouteMm, planPlacesOnBed } from './job-burn-route';
import { flattenedPicture, type WatchCamera, type WatchIo } from './job-watch-camera';
import type { BurnCheckView } from './job-watch-store';

const BURN_LIMITS = { maxPixelsPerMm: 4, maxSidePx: 2400, maxPixels: 4_000_000 };
// Round the head's bed position, the camera cannot judge the bed: the head
// and its shadow cover it, seen from the side by the camera's slant.
const HEAD_HIDDEN_RADIUS_MM = 35;
// Lit moves this far past where the head was confirmed when the first picture
// arrived may already have burned, so they are allowed but not checked.
const START_GUARD_MM = 10;

export type BurnWatch = {
  readonly plan: CanvasMotionPlan;
  readonly camera: WatchCamera;
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  readonly before: RgbaImage;
  readonly headBefore: Vec2 | null;
  readonly checkFromRouteMm: number;
};

export type BeforePicture =
  | { readonly kind: 'ok'; readonly watch: BurnWatch }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Why this job cannot be checked, or null when it can. */
export function burnCheckBlocker(
  plan: CanvasMotionPlan,
  camera: WatchCamera | null,
): string | null {
  if (plan.machineKind !== 'laser') return 'The burn check is for laser jobs.';
  if (camera === null) return 'The camera was not running when the job started.';
  if (camera.fixedModel === null) {
    return 'The burn check needs a camera fixed over the bed, calibrated in the Camera panel.';
  }
  if (!planPlacesOnBed(plan)) return 'KerfDesk could not place this job on the bed.';
  return null;
}

/** The first picture, taken as the job starts. */
export async function takeBeforePicture(args: {
  readonly plan: CanvasMotionPlan;
  /** The job's lit area with the watch margin (burnRegion). */
  readonly region: BedArea | null;
  readonly camera: WatchCamera;
  readonly io: WatchIo;
  readonly headNow: () => Vec2 | null;
  readonly confirmedRouteMm: () => number;
}): Promise<BeforePicture> {
  const { plan, camera, io, region } = args;
  if (region === null) return { kind: 'unavailable', reason: 'This job has nothing to burn.' };
  const pixelsPerMm = watchPixelsPerMm(region, BURN_LIMITS);
  const headBefore = args.headNow();
  const frame = await io.captureFrame(camera.source);
  if (frame === null) {
    return { kind: 'unavailable', reason: 'The camera did not send a picture as the job started.' };
  }
  const picture = flattenedPicture(camera, frame, region, pixelsPerMm);
  if (picture.kind === 'issue') return { kind: 'unavailable', reason: picture.message };
  const reached = args.confirmedRouteMm();
  const firstBurn = firstBurnRouteMm(plan) ?? Number.POSITIVE_INFINITY;
  return {
    kind: 'ok',
    watch: {
      plan,
      camera,
      region,
      pixelsPerMm,
      before: picture.image,
      headBefore,
      checkFromRouteMm: reached > firstBurn ? reached + START_GUARD_MM : 0,
    },
  };
}

/** The verdict from the after picture `frame`. */
export function compareAfterPicture(
  watch: BurnWatch,
  frame: RgbaImage,
  headAfter: Vec2 | null,
): BurnCheckView {
  const picture = flattenedPicture(watch.camera, frame, watch.region, watch.pixelsPerMm);
  if (picture.kind === 'issue') return { kind: 'unavailable', reason: picture.message };
  const masks = burnRouteMasks(watch.plan, watch.region, watch.pixelsPerMm, watch.checkFromRouteMm);
  if (masks === null) return { kind: 'unavailable', reason: 'This job has nothing to burn.' };
  const { report, pixels } = checkBurn({
    before: watch.before,
    after: picture.image,
    masks,
    pixelsPerMm: watch.pixelsPerMm,
    hiddenDiscs: [watch.headBefore, headAfter].flatMap((head) =>
      head === null ? [] : [headDisc(watch, head)],
    ),
  });
  return {
    kind: 'done',
    report,
    picture: {
      image: burnCheckPicture(picture.image, pixels),
      region: watch.region,
      surfaceHeightMm: watch.camera.surfaceHeightMm,
    },
  };
}

function headDisc(watch: BurnWatch, head: Vec2): Disc {
  const ppm = watch.pixelsPerMm;
  return {
    x: (head.x - watch.region.x) * ppm - 0.5,
    y: (head.y - watch.region.y) * ppm - 0.5,
    radius: HEAD_HIDDEN_RADIUS_MM * ppm,
  };
}
