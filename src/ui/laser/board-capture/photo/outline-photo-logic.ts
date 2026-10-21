import {
  MAX_BOARD_OUTLINE_ANCHORS,
  normalizeBoardOutline,
  sizeBoardOutline,
  type BoardOutlineDraft,
  type Vec2,
} from '../../../../core/scene';

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

export function toggleOutlineAnchor(
  index: number,
  anchors: ReadonlyArray<number>,
): { readonly anchors: number[]; readonly blocked: boolean } {
  if (anchors.includes(index)) {
    if (anchors.length <= 2) return { anchors: [...anchors], blocked: true };
    return { anchors: anchors.filter((anchor) => anchor !== index), blocked: false };
  }
  if (anchors.length >= MAX_BOARD_OUTLINE_ANCHORS) {
    return { anchors: [...anchors], blocked: true };
  }
  return { anchors: [...anchors, index].sort((a, b) => a - b), blocked: false };
}

export function buildPhotoOutlineDraft(args: {
  readonly outlineMm: ReadonlyArray<Vec2>;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly anchorIndices: ReadonlyArray<number>;
  readonly firstAnchor: number;
}): BoardOutlineDraft | null {
  const normalized = normalizeBoardOutline(args.outlineMm);
  if (normalized === null) return null;
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

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
