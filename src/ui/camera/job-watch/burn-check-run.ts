// The burn check around one job (ADR-490): a flat picture of the job's part
// of the bed as the job starts, another once it has finished and the smoke
// has cleared, and the comparison of the two against the job's path. Only a
// laser job whose bed position is known, on a camera fixed over the bed with
// its own calibration, can be checked; anything else says why not instead of
// guessing (ADR-490 §4).

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
import {
  burnRouteMasks,
  firstBurnRouteMm,
  planBedPositionKnown,
  planPlacesOnBed,
} from './job-burn-route';
import {
  flattenedPicture,
  flattenSpecFor,
  UNSEEN_REGION_MESSAGE,
  type FlatPicture,
  type WatchCamera,
  type WatchIo,
} from './job-watch-camera';
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

// ADR-642 §3 keeps such a job drawn over its artwork, labelled "bed position
// unverified"; grading the artwork's patch of bed would report the real burn
// as stray marks and the path as missed (rolling audit 12-P2-4).
export const UNKNOWN_BED_POSITION_BURN_CHECK =
  'The bed position is unverified for this job, so KerfDesk does not know where on the bed it burns and the camera cannot check it.';

/** Why this job cannot be checked, or null when it can. `bedUnknownWhy` is
 * the reason this firmware and session have no bed mapping, when known. */
export function burnCheckBlocker(
  plan: CanvasMotionPlan,
  camera: WatchCamera | null,
  bedUnknownWhy: string | null = null,
): string | null {
  if (plan.machineKind !== 'laser') return 'The burn check is for laser jobs.';
  if (camera === null) return 'The camera was not running when the job started.';
  if (camera.fixedModel === null) {
    return (
      camera.modelIssue ??
      'The burn check needs a camera fixed over the bed, calibrated in the Camera panel.'
    );
  }
  if (planPlacesOnBed(plan)) return null;
  return planBedPositionKnown(plan)
    ? 'KerfDesk could not place this job on the bed.'
    : bedUnknownWhy === null
      ? UNKNOWN_BED_POSITION_BURN_CHECK
      : `${UNKNOWN_BED_POSITION_BURN_CHECK} ${bedUnknownWhy}`;
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
  const picture = await beforeImage(camera, io, region, pixelsPerMm);
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

const NO_START_PICTURE = 'The camera did not send a picture as the job started.';

// The before picture, flattened in the picture worker where there is one
// (ADR-490 Amendment 2): taken as the job starts, when an Abort is likeliest.
async function beforeImage(
  camera: WatchCamera,
  io: WatchIo,
  region: BedArea,
  pixelsPerMm: number,
): Promise<FlatPicture> {
  const client = io.picture ?? null;
  if (client === null) {
    const frame = await io.captureFrame(camera.source);
    if (frame === null) return { kind: 'issue', message: NO_START_PICTURE };
    return flattenedPicture(camera, frame, region, pixelsPerMm);
  }
  const bitmap = await client.capture(camera.source);
  if (bitmap === null) return { kind: 'issue', message: NO_START_PICTURE };
  const spec = flattenSpecFor(camera, bitmap.width, bitmap.height, region, pixelsPerMm);
  if (spec.kind === 'issue') {
    bitmap.close();
    return spec;
  }
  const reply = await client.run({ op: 'flat-image', frame: bitmap, flatten: spec.spec });
  if (reply.kind === 'flat-image') return { kind: 'ok', image: reply.image };
  return {
    kind: 'issue',
    message: reply.kind === 'unseen' ? UNSEEN_REGION_MESSAGE : NO_START_PICTURE,
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
      heightAreas: watch.camera.heightAreas,
      taken: watch.camera.taken,
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
