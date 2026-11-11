import {
  boardOutlineAnchors,
  defaultCaptureOrder,
  MAX_BOARD_OUTLINE_ANCHORS,
  normalizeBoardOutline,
  outlineBounds,
  sizeBoardOutline,
  type BoardOutlineDraft,
  type Vec2,
} from '../../../../core/scene';
import { MIN_BOARD_DIMENSION_MM } from '../constants';
import { distance } from '../../../../core/geometry/point-math';

// A photo outline whose proportions differ from the typed size by more than this
// was probably shot at an angle, or has width and height swapped.
const ASPECT_NOTICE_FRACTION = 0.1;

export type PhotoOutlineCheck = {
  readonly draft: BoardOutlineDraft | null;
  /** Why the outline cannot be drawn yet; null once it can. */
  readonly problem: string | null;
  /** A warning that does not block drawing. */
  readonly notice: string | null;
  /** Indices into the clicked points the head can visit. */
  readonly anchors: ReadonlyArray<number>;
  readonly firstAnchor: number | null;
};

export function displayPointToImage(
  point: Vec2,
  display: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  image: { readonly width: number; readonly height: number },
): Vec2 {
  return {
    x: ((point.x - display.left) * image.width) / display.width,
    y: ((point.y - display.top) * image.height) / display.height,
  };
}

/** Every clicked corner is an anchor, unless there are too many to check by hand. */
export function photoOutlineAnchors(points: ReadonlyArray<Vec2>): number[] {
  if (points.length < 3) return [];
  return points.length <= MAX_BOARD_OUTLINE_ANCHORS
    ? points.map((_, index) => index)
    : boardOutlineAnchors(points);
}

export function checkPhotoOutline(args: {
  readonly points: ReadonlyArray<Vec2>;
  readonly width: string;
  readonly height: string;
  readonly firstAnchor: number | null;
}): PhotoOutlineCheck {
  const anchors = photoOutlineAnchors(args.points);
  const firstAnchor = chosenFirstAnchor(args.points, anchors, args.firstAnchor);
  const base = { draft: null, notice: null, anchors, firstAnchor };
  if (args.points.length < 3) {
    return { ...base, problem: 'Click at least three points around the edge of the board.' };
  }
  if (normalizeBoardOutline(args.points) === null) {
    return {
      ...base,
      problem:
        'The outline crosses itself. Click the corners in order around the board, or undo the last point.',
    };
  }
  const widthMm = Number(args.width);
  const heightMm = Number(args.height);
  if (!validSize(widthMm) || !validSize(heightMm)) {
    return {
      ...base,
      problem: `Enter the board's width and height, at least ${MIN_BOARD_DIMENSION_MM} mm each.`,
    };
  }
  const draft =
    firstAnchor === null
      ? null
      : buildPhotoOutlineDraft({
          outlineMm: args.points,
          widthMm,
          heightMm,
          anchorIndices: anchors,
          firstAnchor,
        });
  return {
    ...base,
    draft,
    problem: draft === null ? 'The outline could not be sized. Check the points.' : null,
    notice: aspectNotice(args.points, widthMm, heightMm),
  };
}

export function buildPhotoOutlineDraft(args: {
  readonly outlineMm: ReadonlyArray<Vec2>;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly anchorIndices: ReadonlyArray<number>;
  readonly firstAnchor: number;
}): BoardOutlineDraft | null {
  const normalized = normalizeBoardOutline(args.outlineMm);
  // Clicked points are never merged, so anchor indices must still name them.
  if (normalized === null || normalized.length !== args.outlineMm.length) return null;
  const localPointsMm = sizeBoardOutline(normalized, args.widthMm, args.heightMm);
  const anchors = [...new Set(args.anchorIndices)].sort((a, b) => a - b);
  if (
    localPointsMm === null ||
    anchors.length < 2 ||
    anchors.length > MAX_BOARD_OUTLINE_ANCHORS ||
    anchors.some((index) => localPointsMm[index] === undefined) ||
    !anchors.includes(args.firstAnchor)
  ) {
    return null;
  }
  const firstPoint = localPointsMm[args.firstAnchor] as Vec2;
  const second = anchors
    .filter((index) => index !== args.firstAnchor)
    .reduce((best, index) =>
      distance(localPointsMm[index] as Vec2, firstPoint) >
      distance(localPointsMm[best] as Vec2, firstPoint)
        ? index
        : best,
    );
  return {
    localPointsMm,
    anchorIndices: anchors,
    captureOrder: [args.firstAnchor, second],
  };
}

export function nearestOutlineVertex(
  screenPoint: Vec2,
  vertices: ReadonlyArray<Vec2>,
  limitPx = 12,
): number | null {
  let nearest: number | null = null;
  let distancePx = limitPx;
  vertices.forEach((point, index) => {
    const candidate = distance(point, screenPoint);
    if (candidate <= distancePx) {
      nearest = index;
      distancePx = candidate;
    }
  });
  return nearest;
}

function chosenFirstAnchor(
  points: ReadonlyArray<Vec2>,
  anchors: ReadonlyArray<number>,
  chosen: number | null,
): number | null {
  if (chosen !== null && anchors.includes(chosen)) return chosen;
  return defaultCaptureOrder(points, anchors)?.[0] ?? null;
}

function aspectNotice(
  points: ReadonlyArray<Vec2>,
  widthMm: number,
  heightMm: number,
): string | null {
  const bounds = outlineBounds(points);
  const photoAspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
  const typedAspect = widthMm / heightMm;
  if (
    !Number.isFinite(photoAspect) ||
    Math.abs(photoAspect / typedAspect - 1) <= ASPECT_NOTICE_FRACTION
  ) {
    return null;
  }
  return (
    'The outline in the photo is a different shape from the size you typed. Check width and height ' +
    'are not swapped; if the photo was taken at an angle, retake it from straight above.'
  );
}

function validSize(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_BOARD_DIMENSION_MM && value <= 100_000;
}
