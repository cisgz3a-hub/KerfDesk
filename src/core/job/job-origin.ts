import { jogAxisSignsForOrigin, type DeviceProfile, type Origin } from '../devices';
import { assertNever, type Vec2 } from '../scene';
import type {
  CncGroup,
  CncPass,
  CutGroup,
  CutSegment,
  FillGroup,
  Group,
  Job,
  RasterGroup,
} from './job';
import type { JobBounds } from './job-bounds';
import { computeJobBounds } from './job-bounds';

export type JobStartMode = 'absolute' | 'current-position' | 'user-origin' | 'verified-origin';

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
    }
  // Hand-set origin on a no-homing / hand-positioned machine. Same geometry as
  // user-origin (anchor -> work-zero), but treated as position-untrusted so
  // preflight checks job size, not absolute bed position (ADR-053).
  | {
      readonly startFrom: 'verified-origin';
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

export function applyJobOrigin(
  job: Job,
  placement: JobOriginPlacement,
  device?: DeviceProfile,
): Job {
  const offset = jobOriginOffset(job, placement, device);
  return applyJobOriginOffset(job, offset);
}

export function applyJobOriginOffset(job: Job, offset: Vec2): Job {
  if (offset.x === 0 && offset.y === 0) return job;
  return translateJob(job, offset.x, offset.y);
}

// The translation applyJobOrigin applies for this job + placement (zero for
// absolute placements). Exposed so the preview can undo the placement when
// mapping the prepared job back into the scene frame (H3).
export function jobOriginOffset(
  job: Job,
  placement: JobOriginPlacement,
  device?: DeviceProfile,
): Vec2 {
  const target = targetPoint(placement);
  if (target === null) return { x: 0, y: 0 };
  const bounds = computeJobBounds(job, device);
  if (bounds === null) return { x: 0, y: 0 };
  const anchor = anchorPointForOrigin(bounds, placement.anchor, device?.origin);
  return { x: target.x - anchor.x, y: target.y - anchor.y };
}

export function jobOriginOffsetFromBounds(
  bounds: JobBounds,
  placement: JobOriginPlacement,
  device?: Pick<DeviceProfile, 'origin'>,
): Vec2 {
  const target = targetPoint(placement);
  if (target === null) return { x: 0, y: 0 };
  const anchor = anchorPointForOrigin(bounds, placement.anchor, device?.origin);
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

// The nine anchors name PHYSICAL corners of the artwork as the operator sees it
// on the canvas (front = toward the operator, left = the operator's left), the
// same way the 3x3 picker they come from reads. `bounds` is in MACHINE
// coordinates, whose axes are mirrored on front-right / rear-* device origins
// (origin-transform.ts), so the corner is chosen through jogAxisSignsForOrigin —
// the one table that already keeps the jog pad physically honest. For
// front-left and center origins the signs are +1/+1 and this reduces to the
// machine-frame corners the earlier implementation used, so their output is
// byte-identical (ADR-327). Callers without a device keep the front-left mapping.
export function anchorPointForOrigin(
  bounds: JobBounds,
  anchor: JobOriginAnchor,
  origin: Origin = 'front-left',
): Vec2 {
  const signs = jogAxisSignsForOrigin(origin);
  const [row, column] = anchorRowColumn(anchor);
  return { x: anchorX(bounds, column, signs.x), y: anchorY(bounds, row, signs.y) };
}

type AnchorRow = 'front' | 'center' | 'back';
type AnchorColumn = 'left' | 'center' | 'right';

function anchorRowColumn(anchor: JobOriginAnchor): readonly [AnchorRow, AnchorColumn] {
  switch (anchor) {
    case 'front-left':
      return ['front', 'left'];
    case 'front-center':
      return ['front', 'center'];
    case 'front-right':
      return ['front', 'right'];
    case 'center-left':
      return ['center', 'left'];
    case 'center':
      return ['center', 'center'];
    case 'center-right':
      return ['center', 'right'];
    case 'back-left':
      return ['back', 'left'];
    case 'back-center':
      return ['back', 'center'];
    case 'back-right':
      return ['back', 'right'];
    default:
      return assertNever(anchor, 'JobOriginAnchor');
  }
}

// sign = +1 when machine +X is the operator's right (front-*/center origins):
// the physical left edge is then minX; *-right origins mirror X, so it is maxX.
function anchorX(bounds: JobBounds, column: AnchorColumn, sign: 1 | -1): number {
  if (column === 'center') return (bounds.minX + bounds.maxX) / 2;
  const left = sign === 1 ? bounds.minX : bounds.maxX;
  const right = sign === 1 ? bounds.maxX : bounds.minX;
  return column === 'left' ? left : right;
}

// sign = +1 when machine +Y points away from the operator (front-*/center
// origins): the physical front edge is then minY; rear-* origins mirror Y.
function anchorY(bounds: JobBounds, row: AnchorRow, sign: 1 | -1): number {
  if (row === 'center') return (bounds.minY + bounds.maxY) / 2;
  const front = sign === 1 ? bounds.minY : bounds.maxY;
  const back = sign === 1 ? bounds.maxY : bounds.minY;
  return row === 'front' ? front : back;
}

function targetPoint(placement: JobOriginPlacement): Vec2 | null {
  switch (placement.startFrom) {
    case 'absolute':
      return null;
    case 'user-origin':
    case 'verified-origin':
      return { x: 0, y: 0 };
    case 'current-position':
      return placement.currentPosition;
    default:
      return assertNever(placement, 'JobOriginPlacement');
  }
}

function translateJob(job: Job, dx: number, dy: number): Job {
  return { ...job, groups: job.groups.map((group) => translateGroup(group, dx, dy)) };
}

function translateGroup(group: Group, dx: number, dy: number): Group {
  switch (group.kind) {
    case 'cut':
      return translateCutGroup(group, dx, dy);
    case 'fill':
      return translateFillGroup(group, dx, dy);
    case 'raster':
      return translateRasterGroup(group, dx, dy);
    case 'cnc':
      return translateCncGroup(group, dx, dy);
    default:
      return assertNever(group, 'Group');
  }
}

function translateCncGroup(group: CncGroup, dx: number, dy: number): CncGroup {
  return {
    ...group,
    passes: group.passes.map((pass) => translateCncPass(pass, dx, dy)),
  };
}

function translateCncPass(pass: CncPass, dx: number, dy: number): CncPass {
  switch (pass.kind) {
    case 'contour':
      return {
        ...pass,
        polyline: pass.polyline.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      };
    case 'path3d':
      return {
        ...pass,
        points: pass.points.map((point) => ({ x: point.x + dx, y: point.y + dy, z: point.z })),
      };
    case 'arc':
      return {
        ...pass,
        start: { x: pass.start.x + dx, y: pass.start.y + dy },
        end: { x: pass.end.x + dx, y: pass.end.y + dy },
        center: { x: pass.center.x + dx, y: pass.center.y + dy },
      };
    case 'helical-contour':
      return {
        ...pass,
        start: { x: pass.start.x + dx, y: pass.start.y + dy },
        center: { x: pass.center.x + dx, y: pass.center.y + dy },
        polyline: pass.polyline.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      };
    default:
      return assertNever(pass, 'CncPass');
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
