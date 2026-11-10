// trim-sketch — cut the clicked piece of an entity back to its nearest
// crossings (ADR-272 Amendment 8, Phase N DS-6c), the partner of extend.
//
// AutoCAD's quick trim and LightBurn's Trim: every other entity is a cutting
// edge, and the piece under the cursor - between the crossing just before it
// and the one just after - is removed. Trimming the middle of a line leaves two
// lines; trimming a closed outline opens it; trimming a circle leaves an arc.
// A piece with no crossing on either side is reported, not deleted: deleting a
// whole entity is Delete's job, and a trim that silently erases a part is the
// failure a precision tool must not have. Preview and commit share this query.

import type { Vec2 } from '../../scene';
import { maxOf, minOf } from '../../util';
import { closestPointOnSegment, entitySegments } from '../snap/snap-segments';
import {
  entityBase,
  MIN_ENTITY_SIZE_MM,
  sanitizeEntity,
  type Sketch,
  type SketchArc,
  type SketchEntity,
} from '../sketch-entity';
import {
  angleOf,
  chainSegments,
  circleCrossings,
  entityPrimitives,
  fullCircle,
  modulo,
  segmentCrossings,
  TRIM_EPS_MM,
  type TrimPrimitive,
} from './trim-crossings';

export type SketchTrim = {
  readonly entityId: string;
  readonly reason: 'ready' | 'no-boundary' | 'unsupported';
  // The piece that goes, for the preview.
  readonly removed: ReadonlyArray<Vec2>;
  // What replaces the entity, in order. The first keeps the entity's id; a
  // second piece (a trim in the middle) takes the id the caller supplies.
  readonly kept: ReadonlyArray<SketchEntity>;
};

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_DEG = 360;
const PREVIEW_STEP_DEG = 5;

/** The trim the click at `pointer` means, or null when no entity is within `toleranceMm`. */
export function findSketchTrim(
  sketch: Sketch,
  pointer: Vec2,
  toleranceMm: number,
): SketchTrim | null {
  const entity = pickEntity(sketch, pointer, toleranceMm);
  if (entity === null) return null;
  const cutters = sketch.entities
    .filter((other) => other.id !== entity.id && sanitizeEntity(other) !== null)
    .flatMap((other) => entityPrimitives(other));
  switch (entity.kind) {
    case 'line':
      return trimChain(entity, [entity.start, entity.end], false, pointer, cutters);
    case 'path':
      return trimChain(entity, entity.points, entity.closed, pointer, cutters);
    case 'rect':
      return entity.cornerRadiusMm > 0
        ? unsupported(entity)
        : trimChain(entity, rectCorners(entity), true, pointer, cutters);
    case 'circle':
      return trimRound(entity, fullCircleArc(entity), pointer, cutters);
    case 'arc':
      return trimRound(entity, entity, pointer, cutters);
    case 'ellipse':
      return unsupported(entity);
  }
}

/** The sketch with the trim applied; `secondId` names a second kept piece. */
export function applySketchTrim(sketch: Sketch, trim: SketchTrim, secondId: string): Sketch {
  if (trim.reason !== 'ready') return sketch;
  if (!sketch.entities.some((entity) => entity.id === trim.entityId)) return sketch;
  const pieces = trim.kept.map((piece, index) =>
    index === 0 ? piece : { ...piece, id: secondId },
  );
  return {
    ...sketch,
    entities: sketch.entities.flatMap((entity) =>
      entity.id === trim.entityId ? pieces : [entity],
    ),
  };
}

function pickEntity(sketch: Sketch, pointer: Vec2, toleranceMm: number): SketchEntity | null {
  let best: SketchEntity | null = null;
  let bestDistance = toleranceMm;
  // Topmost first, so the entity drawn last wins a tie, as the hit test does.
  for (const entity of [...sketch.entities].reverse()) {
    for (const segment of entitySegments(entity)) {
      const near = closestPointOnSegment(pointer, segment);
      const distance = Math.hypot(near.x - pointer.x, near.y - pointer.y);
      if (distance < bestDistance || (best === null && distance <= bestDistance)) {
        best = entity;
        bestDistance = distance;
      }
    }
  }
  return best;
}

// ---- straight chains: lines, polylines, square-cornered rectangles ----------

function trimChain(
  entity: SketchEntity,
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  pointer: Vec2,
  cutters: ReadonlyArray<TrimPrimitive>,
): SketchTrim {
  const chain = measureChain(points, closed);
  const cuts = chainCuts(chain, cutters);
  const click = chainParameter(chain, pointer);
  const span = closed ? cyclicSpan(cuts, click) : openSpan(cuts, click, chain.total);
  if (span === null) return { entityId: entity.id, reason: 'no-boundary', removed: [], kept: [] };
  const removed = subChain(
    chain,
    span.from,
    span.to + (closed && span.to < span.from ? chain.total : 0),
  );
  const keptRanges: Array<[number, number]> = closed
    ? [[span.to, span.from + (span.from < span.to ? chain.total : 0)]]
    : [
        ...(span.from > 0 ? [[0, span.from] as [number, number]] : []),
        ...(span.to < chain.total ? [[span.to, chain.total] as [number, number]] : []),
      ];
  const kept = keptRanges
    .map(([from, to]) => subChain(chain, from, to))
    .filter((piece) => chainLength(piece) >= MIN_ENTITY_SIZE_MM)
    .map((piece, index) => chainEntity(entity, piece, index));
  return { entityId: entity.id, reason: 'ready', removed, kept };
}

type Chain = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  readonly starts: ReadonlyArray<number>;
  readonly total: number;
};

function measureChain(points: ReadonlyArray<Vec2>, closed: boolean): Chain {
  const starts: number[] = [];
  let total = 0;
  for (const segment of chainSegments(points, closed)) {
    starts.push(total);
    total += Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
  }
  return { points, closed, starts, total };
}

function chainCuts(chain: Chain, cutters: ReadonlyArray<TrimPrimitive>): number[] {
  const cuts: number[] = [];
  chainSegments(chain.points, chain.closed).forEach((segment, index) => {
    const start = chain.starts[index] ?? 0;
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    for (const cutter of cutters) {
      for (const t of segmentCrossings(segment, cutter)) cuts.push(start + t * length);
    }
  });
  return distinct(cuts, chain.closed ? chain.total : null);
}

function chainParameter(chain: Chain, pointer: Vec2): number {
  let best = 0;
  let bestDistance = Infinity;
  chainSegments(chain.points, chain.closed).forEach((segment, index) => {
    const near = closestPointOnSegment(pointer, {
      fromMm: segment.a,
      toMm: segment.b,
      entityId: '',
    });
    const distance = Math.hypot(near.x - pointer.x, near.y - pointer.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = (chain.starts[index] ?? 0) + Math.hypot(near.x - segment.a.x, near.y - segment.a.y);
    }
  });
  return best;
}

function subChain(chain: Chain, from: number, to: number): Vec2[] {
  const points: Vec2[] = [chainPoint(chain, from)];
  const laps = chain.closed ? 2 : 1;
  for (let lap = 0; lap < laps; lap += 1) {
    chain.starts.forEach((start, index) => {
      const at = start + lap * chain.total;
      if (at > from + TRIM_EPS_MM && at < to - TRIM_EPS_MM) {
        const vertex = chain.points[index % chain.points.length];
        if (vertex !== undefined) points.push(vertex);
      }
    });
  }
  points.push(chainPoint(chain, to));
  return points;
}

function chainPoint(chain: Chain, at: number): Vec2 {
  const s = chain.closed ? ((at % chain.total) + chain.total) % chain.total : at;
  const segments = chainSegments(chain.points, chain.closed);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const start = chain.starts[index] ?? 0;
    const segment = segments[index];
    if (segment === undefined || s < start - TRIM_EPS_MM) continue;
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, (s - start) / length));
    return {
      x: segment.a.x + (segment.b.x - segment.a.x) * t,
      y: segment.a.y + (segment.b.y - segment.a.y) * t,
    };
  }
  return chain.points[0] ?? { x: 0, y: 0 };
}

function chainLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  let previous: Vec2 | undefined;
  for (const point of points) {
    if (previous !== undefined) total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

// A two-point piece of a line stays a line; anything else becomes an open path.
function chainEntity(
  source: SketchEntity,
  points: ReadonlyArray<Vec2>,
  index: number,
): SketchEntity {
  const base = { ...entityBase(source), id: index === 0 ? source.id : `${source.id}:trim` };
  const [start, end] = points;
  if (source.kind === 'line' && points.length === 2 && start !== undefined && end !== undefined) {
    return { ...base, kind: 'line', start, end };
  }
  return { ...base, kind: 'path', points, closed: false };
}

function rectCorners(rect: Extract<SketchEntity, { readonly kind: 'rect' }>): Vec2[] {
  const { x, y } = rect.origin;
  return [
    { x, y },
    { x: x + rect.widthMm, y },
    { x: x + rect.widthMm, y: y + rect.heightMm },
    { x, y: y + rect.heightMm },
  ];
}

// ---- circles and arcs -------------------------------------------------------

function fullCircleArc(circle: Extract<SketchEntity, { readonly kind: 'circle' }>): SketchArc {
  return { ...circle, kind: 'arc', startAngleDeg: 0, sweepDeg: FULL_TURN_DEG };
}

function trimRound(
  entity: SketchEntity,
  arc: SketchArc,
  pointer: Vec2,
  cutters: ReadonlyArray<TrimPrimitive>,
): SketchTrim {
  const circle = fullCircle(arc.center, arc.radiusMm);
  const full = Math.abs(arc.sweepDeg) >= FULL_TURN_DEG;
  const sign = arc.sweepDeg < 0 ? -1 : 1;
  const extent = Math.abs(arc.sweepDeg);
  // Position along the arc, in degrees from its start in its own direction.
  const progress = (angle: number): number => modulo(sign * (angle - arc.startAngleDeg));
  const lapDeg = (TRIM_EPS_MM / arc.radiusMm) * (180 / Math.PI);
  const cuts = distinct(
    cutters.flatMap((cutter) => circleCrossings(circle, cutter)).map(progress),
    full ? FULL_TURN_DEG : null,
  ).filter((at) => full || (at > lapDeg && at < extent - lapDeg));
  const click = Math.min(progress(angleOf(arc.center, pointer)), full ? FULL_TURN_DEG : extent);
  const span = full ? cyclicSpan(cuts, click) : openSpan(cuts, click, extent);
  if (span === null) return { entityId: entity.id, reason: 'no-boundary', removed: [], kept: [] };
  const piece = (from: number, to: number, index: number): SketchEntity => ({
    ...entityBase(entity),
    id: index === 0 ? entity.id : `${entity.id}:trim`,
    kind: 'arc',
    center: arc.center,
    radiusMm: arc.radiusMm,
    startAngleDeg: arc.startAngleDeg + sign * from,
    sweepDeg: sign * (to - from),
  });
  const ranges: Array<[number, number]> = full
    ? [[span.to, span.from + (span.from < span.to ? FULL_TURN_DEG : 0)]]
    : [
        ...(span.from > 0 ? [[0, span.from] as [number, number]] : []),
        ...(span.to < extent ? [[span.to, extent] as [number, number]] : []),
      ];
  const kept = ranges
    .filter(([from, to]) => (to - from) * DEG_TO_RAD * arc.radiusMm >= MIN_ENTITY_SIZE_MM)
    .map(([from, to], index) => piece(from, to, index));
  const removedTo = span.to + (full && span.to < span.from ? FULL_TURN_DEG : 0);
  return {
    entityId: entity.id,
    reason: 'ready',
    removed: arcPoints(arc, sign, span.from, removedTo),
    kept,
  };
}

function arcPoints(arc: SketchArc, sign: number, from: number, to: number): Vec2[] {
  const steps = Math.max(1, Math.ceil((to - from) / PREVIEW_STEP_DEG));
  return Array.from({ length: steps + 1 }, (_, step) => {
    const angle = (arc.startAngleDeg + sign * (from + ((to - from) * step) / steps)) * DEG_TO_RAD;
    return {
      x: arc.center.x + Math.cos(angle) * arc.radiusMm,
      y: arc.center.y + Math.sin(angle) * arc.radiusMm,
    };
  });
}

// ---- shared parameter maths -------------------------------------------------

// The cuts either side of the click on an open run, with the ends of the run
// themselves never counting as cuts. Null when neither side has one.
function openSpan(
  cuts: ReadonlyArray<number>,
  click: number,
  total: number,
): { readonly from: number; readonly to: number } | null {
  const inner = cuts.filter((cut) => cut > TRIM_EPS_MM && cut < total - TRIM_EPS_MM);
  const below = inner.filter((cut) => cut < click);
  const above = inner.filter((cut) => cut > click);
  if (below.length === 0 && above.length === 0) return null;
  return {
    from: below.length === 0 ? 0 : maxOf(below),
    to: above.length === 0 ? total : minOf(above),
  };
}

// On a closed run the cuts either side wrap around; one cut alone cannot bound
// a piece, because both sides of it are the same piece.
function cyclicSpan(
  cuts: ReadonlyArray<number>,
  click: number,
): { readonly from: number; readonly to: number } | null {
  if (cuts.length < 2) return null;
  const below = cuts.filter((cut) => cut < click);
  const above = cuts.filter((cut) => cut > click);
  return {
    from: below.length > 0 ? maxOf(below) : maxOf(cuts),
    to: above.length > 0 ? minOf(above) : minOf(cuts),
  };
}

function distinct(values: ReadonlyArray<number>, period: number | null): number[] {
  const wrapped = values.map((value) =>
    period === null ? value : ((value % period) + period) % period,
  );
  const sorted = [...wrapped].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const value of sorted) {
    const last = kept[kept.length - 1];
    if (last === undefined || value - last > TRIM_EPS_MM) kept.push(value);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (period !== null && first !== undefined && last !== undefined && kept.length > 1) {
    if (first + period - last <= TRIM_EPS_MM) kept.pop();
  }
  return kept;
}

function unsupported(entity: SketchEntity): SketchTrim {
  return { entityId: entity.id, reason: 'unsupported', removed: [], kept: [] };
}
