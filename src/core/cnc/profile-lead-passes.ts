// Bake ADR-250 lead-in / lead-out geometry into profile passes. Converts each
// closed profile CONTOUR pass into a path3d pass that plunges out in the waste,
// feeds tangentially onto the contour, cuts the loop, and feeds back out — so
// the full-depth plunge mark lands in the offcut, not on the finished wall.
//
// Reuses the existing path3d emitter (no emitter change): the path3d starts at
// the waste plunge point, so appendPath3dPass rapids there, plunges, then feeds
// through the lead. Frame envelope and motion-bounds read pass points, so the
// lead is covered for free (cncPassXyPoints handles path3d).
//
// The waste side is resolved PER CONTOUR, not per layer: a profile-outside part
// with a hole cuts the hole INSIDE its own boundary (waste = the enclosed slug),
// so the hole's lead must go inward even though the layer is "outside". Outer
// boundaries and holes come out of the kerf offset with OPPOSITE windings, and
// that winding is invariant to concentric roughing/finishing offsets — so a
// loop whose winding matches the job's outermost loop keeps the layer side, and
// the opposite winding (a hole) flips to the inverse side.
// Leads default-on for closed profile-outside/inside cuts; ramp entry, an
// off-bed lead, a lead that curls into this contour, or into a disjoint sibling
// part all fall back to the legacy straight plunge. A tabbed pass is represented
// as one XY-closed path3d ring, so it keeps the same lead without flattening its
// per-point tab Z moves.

import type { MachineBounds } from '../devices';
import { pointInPolygon } from '../geometry';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { Vec3 } from '../geometry/vec3';
import type { CncContourPass, CncPass, CncPath3dPass } from '../job';
import type { CncCutType, CncLayerSettings, Polyline, Vec2 } from '../scene';
import { computeProfileLead, type ProfileLeadOptions } from './profile-lead';
import type { ProfileSide } from './profile-paths';

type LeadContext = {
  readonly side: ProfileSide;
  readonly options: ProfileLeadOptions;
  readonly bed: MachineBounds;
  readonly siblings: ReadonlyArray<ReadonlyArray<Vec2>>;
};

// Tab interpolation can place an analytically shared contour endpoint at
// 1 - ~1e-16 on the lead chord. Treat only parameter-scale roundoff as the
// endpoint; real boundary crossings farther into the segment remain cuts.
const BOUNDARY_PARAMETER_EPSILON = 1e-12;

export function applyProfileLeadPasses(
  passes: ReadonlyArray<CncPass>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  bed: MachineBounds,
): ReadonlyArray<CncPass> {
  if (settings.rampEntryDeg !== undefined) return passes; // ramp owns the entry
  // ADR-258 removed the `tabsEnabled` early return that used to live here. Tabs
  // are now a Z-rise inside ONE continuous path (cnc-tab-ramp.ts). Treat that
  // XY-closed path3d ring as the same contour for lead placement, while keeping
  // its original Z values intact.
  const baseSide = leadSide(settings.cutType);
  const options = resolveProfileLeadOptions(settings.profileLead, toolDiameterMm);
  if (baseSide === null || options === null) return passes;
  const outerSign = dominantWindingSign(passes);
  const shapes = distinctClosedContours(passes);
  return passes.map((pass) => {
    const polygon = profileLeadPolygon(pass);
    if (polygon === null) return pass;
    if (pass.kind !== 'contour' && pass.kind !== 'path3d') return pass;
    const side = windingSide(polygon, outerSign, baseSide);
    const context: LeadContext = {
      side,
      options,
      bed,
      siblings: leadObstacles(polygon, shapes, side),
    };
    return leadForPass(pass, polygon, context);
  });
}

/**
 * Resolve the per-layer lead choice into concrete arc/line options, or null
 * when leads are off. THIS is the single default switch (ADR-250 is default-on):
 * a layer with no `profileLead` gets a tool-radius arc; `shape: 'none'` is the
 * explicit opt-out back to the legacy straight plunge.
 */
export function resolveProfileLeadOptions(
  lead: CncLayerSettings['profileLead'],
  toolDiameterMm: number,
): ProfileLeadOptions | null {
  const shape = lead?.shape ?? 'arc';
  if (shape === 'none') return null;
  const radiusMm = lead?.radiusMm ?? Math.max(0, toolDiameterMm) / 2;
  return lead?.sweepDeg === undefined
    ? { shape, radiusMm }
    : { shape, radiusMm, sweepDeg: lead.sweepDeg };
}

function leadSide(cutType: CncCutType): ProfileSide | null {
  if (cutType === 'profile-outside') return 'outside';
  if (cutType === 'profile-inside') return 'inside';
  return null; // on-path / pocket / engrave / etc. carry no waste side
}

function oppositeSide(side: ProfileSide): ProfileSide {
  return side === 'outside' ? 'inside' : 'outside';
}

// The winding of the job's outermost (largest-area) loop marks the outer-cut
// direction. A loop with the SAME winding is an outer boundary (or a concentric
// roughing/finishing copy of one) and keeps the layer side; the OPPOSITE winding
// is a hole and flips to the inverse side. Winding — unlike containment depth —
// is not fooled by concentric offsets of the same feature.
function dominantWindingSign(passes: ReadonlyArray<CncPass>): number {
  let maxAbsArea = 0;
  let sign = 0;
  for (const pass of passes) {
    const polygon = profileLeadPolygon(pass);
    if (polygon === null) continue;
    const area = signedAreaMm2(polygon);
    if (Math.abs(area) > maxAbsArea) {
      maxAbsArea = Math.abs(area);
      sign = Math.sign(area);
    }
  }
  return sign;
}

function windingSide(
  polygon: ReadonlyArray<Vec2>,
  outerSign: number,
  baseSide: ProfileSide,
): ProfileSide {
  const sign = Math.sign(signedAreaMm2(polygon));
  if (sign === 0 || outerSign === 0) return baseSide;
  return sign === outerSign ? baseSide : oppositeSide(baseSide);
}

// Disjoint parts and retained islands inside an inward-led boundary are
// obstacles. Opposite winding distinguishes those islands from concentric
// roughing/finishing copies of the same boundary. Enclosing parents remain
// excluded: their interior includes this contour's legitimate waste region.
function leadObstacles(
  polygon: ReadonlyArray<Vec2>,
  shapes: ReadonlyArray<ReadonlyArray<Vec2>>,
  side: ProfileSide,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  const probe = polygon[0];
  if (probe === undefined) return [];
  // Identify the contour's OWN shape by geometry, not array identity:
  // contourPassFromPolyline clones the ring for every depth pass, so a
  // reference check (`shape === polygon`) misses the clone and each depth pass
  // after the first mistakes its own shape for a disjoint sibling — dropping
  // the inside-side lead it should keep (an ADR-250 regression). Two genuinely
  // different parts never share a signature (position or area differs).
  const selfSignature = profileContourSignature(polygon);
  return shapes.filter((shape) => {
    if (profileContourSignature(shape) === selfSignature) return false;
    const other = shape[0];
    if (other === undefined) return false;
    if (pointInPolygon(other, polygon)) {
      return (
        side === 'inside' && Math.sign(signedAreaMm2(shape)) !== Math.sign(signedAreaMm2(polygon))
      );
    }
    return !pointInPolygon(probe, shape);
  });
}

// Distinct closed contour geometries among the passes (depth passes repeat the
// same shape); one representative polyline per shape, used for containment.
function distinctClosedContours(
  passes: ReadonlyArray<CncPass>,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  const seen = new Map<string, ReadonlyArray<Vec2>>();
  for (const pass of passes) {
    const polygon = profileLeadPolygon(pass);
    if (polygon === null) continue;
    const key = profileContourSignature(polygon);
    if (!seen.has(key)) seen.set(key, polygon);
  }
  return [...seen.values()];
}

export function profileContourSignature(polygon: ReadonlyArray<Vec2>): string {
  const vertices = canonicalSignatureVertices(polygon);
  if (vertices.length === 0) return '';
  const tokens = vertices.map(signaturePoint);
  const start = minimumCyclicRotation(tokens);
  const ordered = new Array<string>(tokens.length);
  for (let index = 0; index < tokens.length; index += 1) {
    ordered[index] = tokens[(start + index) % tokens.length] as string;
  }
  return ordered.join(';');
}

function canonicalSignatureVertices(polygon: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const quantized = quantizedSignatureVertices(polygon);
  return quantized.length <= 2 ? quantized : signatureVerticesWithoutCollinearPoints(quantized);
}

function quantizedSignatureVertices(polygon: ReadonlyArray<Vec2>): Vec2[] {
  const quantized: Vec2[] = [];
  for (const point of polygon) {
    const next = { x: Math.round(point.x * 1e6), y: Math.round(point.y * 1e6) };
    const prior = quantized.at(-1);
    if (prior?.x !== next.x || prior.y !== next.y) quantized.push(next);
  }
  if (
    quantized.length > 1 &&
    quantized[0]?.x === quantized.at(-1)?.x &&
    quantized[0]?.y === quantized.at(-1)?.y
  ) {
    quantized.pop();
  }
  return quantized;
}

function signatureVerticesWithoutCollinearPoints(quantized: ReadonlyArray<Vec2>): Vec2[] {
  const previous = quantized.map((_, index) => (index - 1 + quantized.length) % quantized.length);
  const next = quantized.map((_, index) => (index + 1) % quantized.length);
  const removed = quantized.map(() => false);
  const queue = quantized.map((_, index) => index);
  let remaining = quantized.length;
  for (let cursor = 0; cursor < queue.length && remaining > 2; cursor += 1) {
    const index = queue[cursor] as number;
    if (removed[index]) continue;
    const priorIndex = previous[index] as number;
    const nextIndex = next[index] as number;
    if (
      !collinear(
        quantized[priorIndex] as Vec2,
        quantized[index] as Vec2,
        quantized[nextIndex] as Vec2,
      )
    ) {
      continue;
    }
    removed[index] = true;
    remaining -= 1;
    next[priorIndex] = nextIndex;
    previous[nextIndex] = priorIndex;
    queue.push(priorIndex, nextIndex);
  }
  const first = removed.findIndex((value) => !value);
  if (first < 0) return [];
  return linkedSignatureVertices(quantized, next, first);
}

function linkedSignatureVertices(
  quantized: ReadonlyArray<Vec2>,
  next: ReadonlyArray<number>,
  first: number,
): Vec2[] {
  const result: Vec2[] = [];
  let index = first;
  do {
    result.push(quantized[index] as Vec2);
    index = next[index] as number;
  } while (index !== first);
  return result;
}

function signaturePoint(point: Vec2): string {
  return `${point.x},${point.y}`;
}

function collinear(a: Vec2, b: Vec2, c: Vec2): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const baseLength = Math.hypot(c.x - a.x, c.y - a.y);
  // Coordinates are quantized to 1e-6 mm above. A source point that lies
  // exactly on an edge can land within one integer unit of it after rounding
  // (for example 1/3); treat only that representational noise as collinear.
  if (Math.abs(cross) > Math.max(1, baseLength)) return false;
  const between = (b.x - a.x) * (b.x - c.x) + (b.y - a.y) * (b.y - c.y);
  return between <= 0;
}

// Booth's minimum-rotation algorithm: O(n) token comparisons and no quadratic
// rotated-array/string construction for dense imported contours.
function minimumCyclicRotation(tokens: ReadonlyArray<string>): number {
  const length = tokens.length;
  if (length < 2) return 0;
  let left = 0;
  let right = 1;
  let offset = 0;
  while (left < length && right < length && offset < length) {
    const a = tokens[(left + offset) % length] as string;
    const b = tokens[(right + offset) % length] as string;
    if (a === b) {
      offset += 1;
      continue;
    }
    if (a > b) {
      left += offset + 1;
      if (left <= right) left = right + 1;
    } else {
      right += offset + 1;
      if (right <= left) right = left + 1;
    }
    offset = 0;
  }
  return Math.min(left, right) % length;
}

function profileLeadPolygon(pass: CncPass): ReadonlyArray<Vec2> | null {
  if (pass.kind === 'contour') return pass.closed ? pass.polyline : null;
  if (pass.kind !== 'path3d' || pass.entryRamp === true || pass.points.length < 3) return null;
  const first = pass.points[0];
  const last = pass.points.at(-1);
  if (first === undefined || last === undefined) return null;
  if (Math.abs(first.x - last.x) > 1e-9 || Math.abs(first.y - last.y) > 1e-9) return null;
  return pass.points;
}

function leadForPass(
  pass: CncContourPass | CncPath3dPass,
  polygon: ReadonlyArray<Vec2>,
  ctx: LeadContext,
): CncPass {
  const toolpath: Polyline = { points: polygon, closed: true };
  const result = computeProfileLead(toolpath, ctx.side, ctx.options);
  if (!result.ok) return pass;
  const { leadIn, leadOut } = result.lead;
  if (!fitsBed(leadIn, ctx.bed) || !fitsBed(leadOut, ctx.bed)) return pass;
  if (!leadClearsPart(leadIn, leadOut, ctx.side, polygon)) return pass;
  if (!leadClearsSiblings(leadIn, leadOut, ctx.siblings)) return pass;
  return ledPath3d(pass, leadIn, leadOut);
}

// Both sampled vertices and the emitted segments between them must stay on
// the waste side. The shared contour endpoint is allowed on the boundary.
function leadClearsPart(
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
  side: ProfileSide,
  polygon: ReadonlyArray<Vec2>,
): boolean {
  const onWasteSide = (point: Vec2): boolean =>
    side === 'outside' ? !pointInPolygon(point, polygon) : pointInPolygon(point, polygon);
  return (
    leadIn.slice(0, -1).every(onWasteSide) &&
    leadOut.slice(1).every(onWasteSide) &&
    segmentsStayOnSide(leadIn, polygon, side === 'inside') &&
    segmentsStayOnSide(leadOut, polygon, side === 'inside')
  );
}

// These are the already cutter-offset contours, so checking the complete lead
// centreline against them also accounts for the cutter footprint. Do not add
// the tool radius again. An unsafe lead retains the existing plunge fallback.
function leadClearsSiblings(
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
  siblings: ReadonlyArray<ReadonlyArray<Vec2>>,
): boolean {
  if (siblings.length === 0) return true;
  const clear = (point: Vec2): boolean => siblings.every((s) => !pointInPolygon(point, s));
  return (
    leadIn.slice(0, -1).every(clear) &&
    leadOut.slice(1).every(clear) &&
    siblings.every(
      (polygon) =>
        segmentsStayOnSide(leadIn, polygon, false) && segmentsStayOnSide(leadOut, polygon, false),
    )
  );
}

// Polygon membership can change only at a boundary intersection. Split each
// emitted line/chord there and inspect every intervening open interval, rather
// than adding a sampling spacing that could still miss a thin kept feature.
function segmentsStayOnSide(
  points: ReadonlyArray<Vec2>,
  polygon: ReadonlyArray<Vec2>,
  inside: boolean,
): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1] as Vec2;
    const end = points[i] as Vec2;
    const cuts = segmentBoundaryCuts(start, end, polygon);
    for (let j = 1; j < cuts.length; j += 1) {
      const from = cuts[j - 1] as number;
      const to = cuts[j] as number;
      if (from === to) continue;
      const t = (from + to) / 2;
      const midpoint = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
      if (pointInPolygon(midpoint, polygon) !== inside) return false;
    }
  }
  return true;
}

function segmentBoundaryCuts(a: Vec2, b: Vec2, polygon: ReadonlyArray<Vec2>): number[] {
  const cuts = [0, 1];
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  for (let i = 0; i < polygon.length; i += 1) {
    const c = polygon[i] as Vec2;
    const d = polygon[(i + 1) % polygon.length] as Vec2;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const cross = rx * sy - ry * sx;
    if (cross === 0) continue;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / cross;
    if (t > BOUNDARY_PARAMETER_EPSILON && t < 1 - BOUNDARY_PARAMETER_EPSILON && u >= 0 && u <= 1) {
      cuts.push(t);
    }
  }
  cuts.sort((left, right) => left - right);
  return cuts.filter(
    (cut, index) => index === 0 || cut - (cuts[index - 1] as number) > BOUNDARY_PARAMETER_EPSILON,
  );
}

// leadIn ends on, and leadOut begins on, the contour start vertex, so both
// splice on without a gap; the shared vertex is dropped to avoid a zero-length
// move. Every point rides the pass's cutting depth.
function ledPath3d(
  pass: CncContourPass | CncPath3dPass,
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
): CncPath3dPass {
  const sourcePoints: ReadonlyArray<Vec3> =
    pass.kind === 'contour'
      ? pass.polyline.map((point) => ({ ...point, z: pass.zMm }))
      : pass.points;
  const entryZ = sourcePoints[0]?.z;
  const exitZ = sourcePoints.at(-1)?.z;
  if (entryZ === undefined || exitZ === undefined) return pass as CncPath3dPass;
  const points: Vec3[] = [];
  for (const point of leadIn) points.push({ x: point.x, y: point.y, z: entryZ });
  for (let i = 1; i < sourcePoints.length; i += 1) {
    points.push(sourcePoints[i] as Vec3);
  }
  for (let i = 1; i < leadOut.length; i += 1) {
    const point = leadOut[i] as Vec2;
    points.push({ x: point.x, y: point.y, z: exitZ });
  }
  return {
    kind: 'path3d',
    points,
    closed: false,
    ...(pass.kind === 'path3d' && pass.lateralFeed !== undefined
      ? { lateralFeed: pass.lateralFeed }
      : {}),
  };
}

// Compile-time bed guard in the machine frame. Dropping a lead is always safe
// (it restores the legacy plunge); relative-origin jobs additionally rely on
// the runtime motion-bounds warning and the physical Frame.
function fitsBed(points: ReadonlyArray<Vec2>, bed: MachineBounds): boolean {
  return points.every(
    (point) =>
      point.x >= bed.minX && point.x <= bed.maxX && point.y >= bed.minY && point.y <= bed.maxY,
  );
}
