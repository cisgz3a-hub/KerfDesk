// Camera Print and Cut (ADR-443): the two printed registration marks found in
// one camera frame flattened onto the bed at the material height, instead of
// jogging the head onto each. The camera measures in bed millimetres, which
// are the workspace's own coordinates, so the found centres go straight into
// the same two-point registration the head captures feed.

import { warpFrameToBedImage } from '../../core/camera/model/bed-image';
import type { CameraPose, LensModel } from '../../core/camera/model/camera-model';
import type { SurfaceHeightArea } from '../../core/camera/model/height-areas';
import { findMarks } from '../../core/camera/marks/find-marks';
import {
  MAX_SCALE_ERROR,
  matchMarkPair,
  type MarkPairResult,
} from '../../core/camera/marks/match-mark-pair';
import type { RgbaImage } from '../../core/camera/rgba-image';
import {
  combinedBBox,
  type PrintAndCutDesignTargets,
  type Project,
  type Vec2,
} from '../../core/scene';

const MARK_PIXELS_PER_MM = 4;
const MARK_PIXEL_BUDGET = 4_000_000;
// Without a design mark to size them by, marks from 2 to 30 mm are looked for.
const MIN_MARK_MM = 2;
const MAX_MARK_MM = 30;
// A design object whose box centre is this close to a target is that target's mark.
const MARK_CENTRE_TOLERANCE_MM = 0.5;

export function markPixelsPerMm(bedWidthMm: number, bedHeightMm: number): number {
  const areaMm2 = bedWidthMm * bedHeightMm;
  if (!(areaMm2 > 0)) return MARK_PIXELS_PER_MM;
  return Math.min(MARK_PIXELS_PER_MM, Math.sqrt(MARK_PIXEL_BUDGET / areaMm2));
}

/** The printed marks for `targets` found in a camera frame, or null when it could not be flattened. */
export function locatePrintCutMarks(args: {
  readonly raw: RgbaImage;
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly surfaceHeightMm: number;
  readonly heightAreas: ReadonlyArray<SurfaceHeightArea>;
  readonly targets: PrintAndCutDesignTargets;
  /** The design marks' sizes where known, mm. */
  readonly markSizeMm: number | null;
}): MarkPairResult | null {
  const region = { x: 0, y: 0, width: args.bedWidthMm, height: args.bedHeightMm };
  const pixelsPerMm = markPixelsPerMm(args.bedWidthMm, args.bedHeightMm);
  const image = warpFrameToBedImage(args.raw, args.lens, args.pose, {
    region,
    pixelsPerMm,
    surfaceHeightMm: args.surfaceHeightMm,
    heightAreas: args.heightAreas,
  });
  if (image === null) return null;
  const size = args.markSizeMm;
  const marks = findMarks({
    image,
    region,
    pixelsPerMm,
    minSizeMm: size === null ? MIN_MARK_MM : 0.6 * size,
    maxSizeMm: size === null ? MAX_MARK_MM : 1.6 * size,
  });
  return matchMarkPair([args.targets.first, args.targets.second], marks);
}

/**
 * The size of the design's marks when both targets sit on the centre of a
 * small design object, as they do when set from the selected marks.
 */
export function designMarkSizeMm(
  project: Project,
  targets: PrintAndCutDesignTargets,
): number | null {
  const sizes = [targets.first, targets.second].map((target) => markSizeAt(project, target));
  const [a, b] = sizes;
  return a === null || a === undefined || b === null || b === undefined ? null : Math.max(a, b);
}

function markSizeAt(project: Project, target: Vec2): number | null {
  for (const object of project.scene.objects) {
    const box = combinedBBox([object]);
    if (box === null) continue;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const size = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    if (
      size <= MAX_MARK_MM &&
      Math.hypot(cx - target.x, cy - target.y) <= MARK_CENTRE_TOLERANCE_MM
    ) {
      return size;
    }
  }
  return null;
}

/** Targets at the centres of exactly two selected objects, the left one first; otherwise null. */
export function targetsFromSelection(
  project: Project,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): PrintAndCutDesignTargets | null {
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  const centres = project.scene.objects
    .filter((object) => ids.has(object.id))
    .flatMap((object) => {
      const box = combinedBBox([object]);
      return box === null ? [] : [{ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }];
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const [first, second] = centres;
  return centres.length === 2 && first !== undefined && second !== undefined
    ? { first, second }
    : null;
}

/** What the camera found, in words for the dialog. */
export function markPairMessage(result: MarkPairResult, targets: PrintAndCutDesignTargets): string {
  const designed = Math.hypot(
    targets.second.x - targets.first.x,
    targets.second.y - targets.first.y,
  );
  if (result.kind === 'none') {
    const shapes =
      result.marksFound === 1 ? '1 mark-like shape' : `${result.marksFound} mark-like shapes`;
    return `The camera found ${shapes}, but no two are ${designed.toFixed(1)} mm apart (within ${MAX_SCALE_ERROR * 100} %). Check that both marks are in view, have clear paper around them, and match the targets.`;
  }
  const { pair } = result;
  const percent = (pair.scale - 1) * 100;
  const found = `The camera found both marks ${(pair.scale * designed).toFixed(1)} mm apart (designed ${designed.toFixed(1)} mm, print scale ${percent >= 0 ? '+' : ''}${percent.toFixed(2)} %), turned ${pair.rotationDeg.toFixed(1)}°.`;
  if (pair.otherPairs === 0) return found;
  const others =
    pair.otherPairs === 1
      ? '1 other pair of marks is the same distance apart'
      : `${pair.otherPairs} other pairs of marks are the same distance apart`;
  return `${found} ${others}; the pair nearest the design's targets was used.`;
}
