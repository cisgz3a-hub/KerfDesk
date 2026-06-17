import { assertNever, type Vec2 } from '../scene';
import type { CutGroup, CutSegment, FillGroup, Group, Job, RasterGroup } from './job';
import type { JobBounds } from './job-bounds';
import { computeJobBounds } from './job-bounds';

export type JobStartMode = 'absolute' | 'current-position' | 'user-origin';

export type JobOriginAnchor =
  | 'front-left'
  | 'front-center'
  | 'front-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'back-left'
  | 'back-center'
  | 'back-right';

export type JobOriginPlacement =
  | {
      readonly startFrom: 'absolute';
      readonly anchor: JobOriginAnchor;
    }
  | {
      readonly startFrom: 'current-position';
      readonly anchor: JobOriginAnchor;
      readonly currentPosition: Vec2;
    }
  | {
      readonly startFrom: 'user-origin';
      readonly anchor: JobOriginAnchor;
    };

export type JobPlacementSettings = {
  readonly startFrom: JobStartMode;
  readonly anchor: JobOriginAnchor;
};

export const JOB_ORIGIN_ANCHORS: ReadonlyArray<JobOriginAnchor> = [
  'back-left',
  'back-center',
  'back-right',
  'center-left',
  'center',
  'center-right',
  'front-left',
  'front-center',
  'front-right',
];

export const ABSOLUTE_JOB_PLACEMENT: JobOriginPlacement = {
  startFrom: 'absolute',
  anchor: 'front-left',
};

export const USER_ORIGIN_JOB_PLACEMENT: JobOriginPlacement = {
  startFrom: 'user-origin',
  anchor: 'front-left',
};

export function applyJobOrigin(job: Job, placement: JobOriginPlacement): Job {
  const offset = jobOriginOffset(job, placement);
  return applyJobOriginOffset(job, offset);
}

export function applyJobOriginOffset(job: Job, offset: Vec2): Job {
  if (offset.x === 0 && offset.y === 0) return job;
  return translateJob(job, offset.x, offset.y);
}

// The translation applyJobOrigin applies for this job + placement (zero for
// absolute placements). Exposed so the preview can undo the placement when
// mapping the prepared job back into the scene frame (H3).
export function jobOriginOffset(job: Job, placement: JobOriginPlacement): Vec2 {
  const target = targetPoint(placement);
  if (target === null) return { x: 0, y: 0 };
  const bounds = computeJobBounds(job);
  if (bounds === null) return { x: 0, y: 0 };
  const anchor = anchorPoint(bounds, placement.anchor);
  return { x: target.x - anchor.x, y: target.y - anchor.y };
}

export function jobOriginOffsetFromBounds(bounds: JobBounds, placement: JobOriginPlacement): Vec2 {
  const target = targetPoint(placement);
  if (target === null) return { x: 0, y: 0 };
  const anchor = anchorPoint(bounds, placement.anchor);
  return { x: target.x - anchor.x, y: target.y - anchor.y };
}

export function offsetJobBounds(
  bounds: JobBounds,
  offset: { readonly x: number; readonly y: number },
): JobBounds {
  return {
    minX: bounds.minX + offset.x,
    minY: bounds.minY + offset.y,
    maxX: bounds.maxX + offset.x,
    maxY: bounds.maxY + offset.y,
  };
}

function anchorPoint(bounds: JobBounds, anchor: JobOriginAnchor): Vec2 {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  switch (anchor) {
    case 'front-left':
      return { x: bounds.minX, y: bounds.minY };
    case 'front-center':
      return { x: midX, y: bounds.minY };
    case 'front-right':
      return { x: bounds.maxX, y: bounds.minY };
    case 'center-left':
      return { x: bounds.minX, y: midY };
    case 'center':
      return { x: midX, y: midY };
    case 'center-right':
      return { x: bounds.maxX, y: midY };
    case 'back-left':
      return { x: bounds.minX, y: bounds.maxY };
    case 'back-center':
      return { x: midX, y: bounds.maxY };
    case 'back-right':
      return { x: bounds.maxX, y: bounds.maxY };
    default:
      return assertNever(anchor, 'JobOriginAnchor');
  }
}

function targetPoint(placement: JobOriginPlacement): Vec2 | null {
  switch (placement.startFrom) {
    case 'absolute':
      return null;
    case 'user-origin':
      return { x: 0, y: 0 };
    case 'current-position':
      return placement.currentPosition;
    default:
      return assertNever(placement, 'JobOriginPlacement');
  }
}

function translateJob(job: Job, dx: number, dy: number): Job {
  return { groups: job.groups.map((group) => translateGroup(group, dx, dy)) };
}

function translateGroup(group: Group, dx: number, dy: number): Group {
  switch (group.kind) {
    case 'cut':
      return translateCutGroup(group, dx, dy);
    case 'fill':
      return translateFillGroup(group, dx, dy);
    case 'raster':
      return translateRasterGroup(group, dx, dy);
    default:
      return assertNever(group, 'Group');
  }
}

function translateCutGroup(group: CutGroup, dx: number, dy: number): CutGroup {
  return {
    ...group,
    segments: group.segments.map((segment) => translateSegment(segment, dx, dy)),
  };
}

function translateFillGroup(group: FillGroup, dx: number, dy: number): FillGroup {
  return {
    ...group,
    segments: group.segments.map((segment) => translateSegment(segment, dx, dy)),
  };
}

function translateRasterGroup(group: RasterGroup, dx: number, dy: number): RasterGroup {
  return { ...group, bounds: offsetJobBounds(group.bounds, { x: dx, y: dy }) };
}

function translateSegment<T extends CutSegment>(segment: T, dx: number, dy: number): T {
  return {
    ...segment,
    polyline: segment.polyline.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}
