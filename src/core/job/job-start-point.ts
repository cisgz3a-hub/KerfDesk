import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import { containmentDepths } from './containment-depth';
import { nearestClosedStart } from './closed-shape-start';
import { reverseCutSegment, rotateClosedCutSegment, validCutArcMoves } from './cut-arc-moves';
import { firstToolpathProcessPoint } from './first-process-point';
import { isEmittableCutSegment } from './cut-emission-resolution';
import { type CncGroup, type CutSegment, type Group, type Job, type RasterGroup } from './job';

export type JobStartPointOptions = {
  readonly allowReverse?: boolean;
  readonly insideFirst?: boolean;
};

/** Source order preserves drawn direction even if a former planner setting
 * still allows reversal. Output and canvas snapping must use the same policy. */
export function jobStartPointOptions(
  optimization: Pick<ProjectOptimizationSettings, 'travelPolicy' | 'pathDirection' | 'insideFirst'>,
): JobStartPointOptions {
  return {
    allowReverse:
      optimization.travelPolicy !== 'source-order' &&
      optimization.pathDirection === 'allow-reverse',
    insideFirst: optimization.insideFirst,
  };
}

export type ResolvedJobStartPoint = {
  readonly point: Vec2;
  readonly supported: boolean;
  readonly reason?: string;
};

type Selection = ResolvedJobStartPoint & {
  readonly groupIndex: number;
  readonly segmentIndex: number;
  readonly segment: CutSegment;
};

type ContainmentEligibility = {
  readonly depths: ReadonlyArray<number>;
  readonly maxDepth: number;
};
// Prepared jobs and their segment arrays are immutable. Pointer movement only
// changes the target, so keep containment work once per prepared geometry.
const containmentCache = new WeakMap<ReadonlyArray<CutSegment>, ContainmentEligibility>();
const processStartCache = new WeakMap<RasterGroup | CncGroup, Vec2 | null>();

function containmentEligibility(segments: ReadonlyArray<CutSegment>): ContainmentEligibility {
  const cached = containmentCache.get(segments);
  if (cached !== undefined) return cached;
  const depths = containmentDepths(segments);
  const maxDepth = segments.reduce(
    (max, segment, index) =>
      isEmittableCutSegment(segment) ? Math.max(max, depths[index] ?? 0) : max,
    0,
  );
  const eligibility = { depths, maxDepth };
  containmentCache.set(segments, eligibility);
  return eligibility;
}

/** Target and result are machine coordinates, including any job placement. */
export function resolveJobStartPoint(
  job: Job,
  target: Vec2,
  options: JobStartPointOptions = {},
): ResolvedJobStartPoint | null {
  const selection = selectStart(job, target, options);
  if (selection === null) return null;
  const { point, supported, reason } = selection;
  return reason === undefined ? { point, supported } : { point, supported, reason };
}

/** Compact, cloneable editing geometry; never carries raster pixels/providers or later operations. */
export function jobStartEditingJob(job: Job): Job {
  const selection = selectStart(job, { x: 0, y: 0 }, {});
  const group = selection?.supported === true ? job.groups[selection.groupIndex] : undefined;
  return { groups: group === undefined ? [] : [group] };
}

/** Applies after optimization, preserving operation order and cut direction. */
export function applyJobStartPoint(
  job: Job,
  target: Vec2,
  options: JobStartPointOptions = {},
): Job {
  const selection = selectStart(job, target, options);
  if (selection === null || !selection.supported) return job;
  const group = job.groups[selection.groupIndex];
  let replacement: Group;
  if (group?.kind === 'cut') {
    const segment = group.segments[selection.segmentIndex];
    if (segment === undefined) return job;
    replacement = {
      ...group,
      segments: [
        selection.segment,
        ...group.segments.filter((_, index) => index !== selection.segmentIndex),
      ],
    };
  } else if (group?.kind === 'cnc') {
    // Selection only accepts identical constant-depth contours. Rotate every
    // depth pass together so stepdowns retain the same XY entry and direction.
    replacement = {
      ...group,
      passes: group.passes.map((pass) =>
        pass.kind === 'contour' ? { ...pass, polyline: selection.segment.polyline } : pass,
      ),
    };
  } else return job;
  return {
    ...job,
    groups: job.groups.map((item, index) => (index === selection.groupIndex ? replacement : item)),
  };
}

function selectStart(job: Job, target: Vec2, options: JobStartPointOptions): Selection | null {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  for (let groupIndex = 0; groupIndex < job.groups.length; groupIndex += 1) {
    const group = job.groups[groupIndex];
    if (group === undefined) continue;
    const point = firstPoint(group);
    if (point === undefined) continue;
    if (group.kind === 'cut') return selectCut(group.segments, groupIndex, target, options);
    if (group.kind === 'cnc') {
      const first = group.passes[0];
      if (first?.kind === 'contour' && canRotateCnc(group)) {
        return selectCut([first], groupIndex, target, { allowReverse: false }, () => true);
      }
    }
    return {
      point,
      supported: false,
      reason:
        group.kind === 'cnc'
          ? 'This CNC operation keeps its generated entry and depth sequence.'
          : 'Raster and fill operations keep their generated scan order.',
      groupIndex,
      segmentIndex: 0,
      segment: { closed: false, polyline: [] },
    };
  }
  return null;
}

function canRotateCnc(group: CncGroup): boolean {
  const first = group.passes[0];
  if (first?.kind !== 'contour' || !first.closed || group.rampEntryDeg !== undefined) return false;
  return group.passes.every(
    (pass) =>
      pass.kind === 'contour' &&
      pass.closed &&
      !pass.entryPlunge &&
      !pass.stayDownEntry &&
      samePolyline(first.polyline, pass.polyline),
  );
}

function firstPoint(group: Group): Vec2 | undefined {
  if (group.kind !== 'cnc' && (group.power <= 0 || group.passes <= 0)) return undefined;
  if (group.kind === 'raster' || group.kind === 'cnc') {
    // Dimensions/vertex counts do not guarantee executable motion. Reuse the
    // raster sweep and CNC controller-precision rules from the canonical marker.
    // Cache by immutable group so dragging does not rescan rows or precision.
    const cached = processStartCache.get(group);
    if (cached !== undefined) return cached ?? undefined;
    const point = firstToolpathProcessPoint({ groups: [group] });
    processStartCache.set(group, point);
    return point ?? undefined;
  }
  return group.segments.find((segment) =>
    group.kind === 'cut' ? isEmittableCutSegment(segment) : segment.polyline.length >= 2,
  )?.polyline[0];
}

function selectCut(
  segments: ReadonlyArray<CutSegment>,
  groupIndex: number,
  target: Vec2,
  options: JobStartPointOptions,
  acceptSegment: (segment: CutSegment) => boolean = isEmittableCutSegment,
): Selection | null {
  const eligibility = options.insideFirst === true ? containmentEligibility(segments) : null;
  let best: Selection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (
      segment === undefined ||
      !acceptSegment(segment) ||
      (eligibility !== null && eligibility.depths[segmentIndex] !== eligibility.maxDepth)
    )
      continue;
    const selected = selectedSegment(segment, target, options.allowReverse !== false);
    const point = selected?.polyline[0];
    if (point === undefined || selected === null) continue;
    const distance = squaredDistance(point, target);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = { point, supported: true, groupIndex, segmentIndex, segment: selected };
  }
  return best;
}

function selectedSegment(
  segment: CutSegment,
  target: Vec2,
  allowReverse: boolean,
): CutSegment | null {
  const points = segment.polyline;
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || first === undefined || last === undefined) return null;
  if (!segment.closed) {
    return allowReverse && squaredDistance(last, target) < squaredDistance(first, target)
      ? reverseCutSegment(segment)
      : segment;
  }
  // Closed compiled contours explicitly repeat their first vertex. Do not
  // fabricate a closing cut for malformed input.
  if (!samePoint(first, last)) return null;
  // Native arcs must retain their exact geometry. Their supported starts are
  // the existing move boundaries; splitting a sampled chord would change the arc.
  if (validCutArcMoves(segment) !== null) {
    return rotateClosedCutSegment(segment, nearestClosedStart(segment, target, 'nearest'));
  }
  return { ...segment, polyline: rotatePolylineAtTarget(points, target) };
}

function rotatePolylineAtTarget(points: ReadonlyArray<Vec2>, target: Vec2): ReadonlyArray<Vec2> {
  let bestEdge = 0;
  let bestPoint = points[0] as Vec2;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) continue;
    const point = projectToEdge(target, a, b);
    const distance = squaredDistance(point, target);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestPoint = point;
    bestEdge = index;
  }
  const rotated = [
    bestPoint,
    ...points.slice(bestEdge + 1, -1),
    ...points.slice(0, bestEdge + 1),
    bestPoint,
  ];
  return rotated.filter((point, index) => index === 0 || !samePoint(point, rotated[index - 1]));
}

function projectToEdge(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return a;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function squaredDistance(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function samePoint(a: Vec2, b: Vec2 | undefined): boolean {
  return b !== undefined && a.x === b.x && a.y === b.y;
}

function samePolyline(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): boolean {
  return a.length === b.length && a.every((point, index) => samePoint(point, b[index]));
}
