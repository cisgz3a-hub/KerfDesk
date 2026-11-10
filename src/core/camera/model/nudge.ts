// The quick nudge fix (ADR-663 Amendment 2): one ring burned at a known spot
// on the bed and found in a new photo says how far the camera picture is off
// there; moving the saved camera that far along the bed lines it up again. A
// camera that only shifted, as a lid that closes a little differently does, is
// lined up everywhere. One that tilted or turned is lined up at the ring, and
// the size of the offset says when a new calibration is the better fix.
// Pure core: rings in pixels and a model in, millimetres out.

import type { RingMark } from '../target/ring-detect';
import type { CameraBedFrame } from './camera-bed-frame';
import { bedMapper, type CameraPose, type LensModel, type Vec2 } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import { shiftedPose } from './head-camera';

// Below this the picture already lines up as well as one photo can tell.
export const NUDGE_NOTHING_MM = 0.2;
// Above this the camera has moved more than a nudge should hide: calibrate again.
export const NUDGE_LIMIT_MM = 10;
// Rings found further than this from the burned spot are not the nudge ring.
export const NUDGE_SEARCH_MM = 25;

export type NudgeMeasure =
  /** `offsetMm` moves the picture onto the burn: burned minus where it shows. */
  | { readonly kind: 'found'; readonly offsetMm: Vec2; readonly seenMm: Vec2 }
  | { readonly kind: 'not-found' }
  /** More than one ring near the spot: an old target on the bed, say. */
  | { readonly kind: 'ambiguous'; readonly rings: number };

export function measureNudge(args: {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly rings: ReadonlyArray<RingMark>;
  /** Where the laser burned the ring's centre, bed millimetres. */
  readonly burnedAtMm: Vec2;
  /** Top of the sheet the ring is burned on, mm above the bed. */
  readonly heightMm: number;
}): NudgeMeasure {
  const toBed = bedMapper(args.lens, args.pose);
  const near: Vec2[] = [];
  for (const ring of args.rings) {
    if (ring.anchor) continue;
    const seen = toBed({ x: ring.x, y: ring.y }, args.heightMm);
    if (seen === null) continue;
    const distance = Math.hypot(seen.x - args.burnedAtMm.x, seen.y - args.burnedAtMm.y);
    if (distance <= NUDGE_SEARCH_MM) near.push(seen);
  }
  const [seenMm, ...others] = near;
  if (seenMm === undefined) return { kind: 'not-found' };
  if (others.length > 0) return { kind: 'ambiguous', rings: near.length };
  return {
    kind: 'found',
    seenMm,
    offsetMm: { x: args.burnedAtMm.x - seenMm.x, y: args.burnedAtMm.y - seenMm.y },
  };
}

/**
 * The saved camera moved `offsetMm` along the bed, so every point of its
 * picture lands that much further on. The rings it was calibrated on stay
 * where the laser engraved them.
 */
export function nudgedCameraModel(record: CameraModelRecord, offsetMm: Vec2): CameraModelRecord {
  return { ...record, pose: shiftedPose(record.pose, offsetMm) };
}

export { vectorLength as nudgeSizeMm } from '../../geometry/point-math';

/**
 * Whether the nudge ring was burned while the native offset was unknown (not
 * homed, or settings unread) against a calibration placed with it known. The
 * ring then sits wherever Absolute coordinates were that session, so a fix
 * folds that offset into the calibration (ADR-440 Amendment 5).
 */
export function nudgeRingBeforeBedWasKnown(
  calibration: CameraBedFrame | undefined,
  ring: CameraBedFrame,
): boolean {
  return calibration?.nativeToBedOffsetMm !== undefined && ring.nativeToBedOffsetMm === undefined;
}

/**
 * `record` lined up with a ring burned before the native offset was known: its
 * frame no longer claims an offset, so the Camera panel says it was
 * calibrated before KerfDesk knew where the machine sits (ADR-441 Amendment
 * 5), and a later offset change does not move it.
 */
export function withUnknownNativeOffset(record: CameraModelRecord): CameraModelRecord {
  const frame = record.bedFrame;
  if (frame?.nativeToBedOffsetMm === undefined) return record;
  const { nativeToBedOffsetMm: _known, ...unknown } = frame;
  return { ...record, bedFrame: unknown };
}
