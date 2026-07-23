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
// Leads default-on for closed profile-outside/inside cuts; ramp entry, tabs, an
// off-bed lead, a lead that curls into this contour, or into a disjoint sibling
// part all fall back to the legacy straight plunge.

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

export function applyProfileLeadPasses(
  passes: ReadonlyArray<CncPass>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  bed: MachineBounds,
): ReadonlyArray<CncPass> {
  if (settings.rampEntryDeg !== undefined) return passes; // ramp owns the entry
  // Tabs split the loop into open segments; a lead on the surviving full loops
  // while the split passes still plunge on the wall would be inconsistent, so a
  // tabbed profile keeps the legacy entry. Tab-aware leads are a follow-up.
  if (settings.tabsEnabled) return passes;
  const baseSide = leadSide(settings.cutType);
  const options = resolveProfileLeadOptions(settings.profileLead, toolDiameterMm);
  if (baseSide === null || options === null) return passes;
  const outerSign = dominantWindingSign(passes);
  const shapes = distinctClosedContours(passes);
  return passes.map((pass) => {
    if (pass.kind !== 'contour' || !pass.closed) return pass;
    const context: LeadContext = {
      side: windingSide(pass.polyline, outerSign, baseSide),
      options,
      bed,
      siblings: disjointSiblings(pass.polyline, shapes),
    };
    return leadForPass(pass, context);
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
    if (pass.kind !== 'contour' || !pass.closed) continue;
    const area = signedAreaMm2(pass.polyline);
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

// Sibling parts (neither contains the other): a lead reaching into one of these
// would gouge a different part, so the lead is dropped. The containment chain
// (this contour's own holes/parents) is excluded — those are handled by the
// per-contour side, not treated as collisions.
function disjointSiblings(
  polygon: ReadonlyArray<Vec2>,
  shapes: ReadonlyArray<ReadonlyArray<Vec2>>,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  const probe = polygon[0];
  if (probe === undefined) return [];
  return shapes.filter((shape) => {
    if (shape === polygon) return false;
    const other = shape[0];
    if (other === undefined) return false;
    return !pointInPolygon(probe, shape) && !pointInPolygon(other, polygon);
  });
}

// Distinct closed contour geometries among the passes (depth passes repeat the
// same shape); one representative polyline per shape, used for containment.
function distinctClosedContours(
  passes: ReadonlyArray<CncPass>,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  const seen = new Map<string, ReadonlyArray<Vec2>>();
  for (const pass of passes) {
    if (pass.kind !== 'contour' || !pass.closed) continue;
    const key = contourSignature(pass.polyline);
    if (!seen.has(key)) seen.set(key, pass.polyline);
  }
  return [...seen.values()];
}

function contourSignature(polygon: ReadonlyArray<Vec2>): string {
  const first = polygon[0];
  const area = Math.round(signedAreaMm2(polygon) * 1000);
  const x = first === undefined ? 0 : Math.round(first.x * 1000);
  const y = first === undefined ? 0 : Math.round(first.y * 1000);
  return `${polygon.length}:${area}:${x},${y}`;
}

function leadForPass(pass: CncContourPass, ctx: LeadContext): CncPass {
  const toolpath: Polyline = { points: pass.polyline, closed: pass.closed };
  const result = computeProfileLead(toolpath, ctx.side, ctx.options);
  if (!result.ok) return pass;
  const { leadIn, leadOut } = result.lead;
  if (!fitsBed(leadIn, ctx.bed) || !fitsBed(leadOut, ctx.bed)) return pass;
  if (!leadClearsPart(leadIn, leadOut, ctx.side, pass.polyline)) return pass;
  if (!leadClearsSiblings(leadIn, leadOut, ctx.siblings)) return pass;
  return ledPath3d(pass, leadIn, leadOut);
}

// Self-collision guard: every lead point (except the shared entry vertex, which
// sits on the boundary) must be on the WASTE side of this contour — outside the
// loop for an outside cut, inside it for an inside cut. A concave lead that
// curls back into the kept material fails here and falls back to the plunge.
function leadClearsPart(
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
  side: ProfileSide,
  polygon: ReadonlyArray<Vec2>,
): boolean {
  const onWasteSide = (point: Vec2): boolean =>
    side === 'outside' ? !pointInPolygon(point, polygon) : pointInPolygon(point, polygon);
  return leadIn.slice(0, -1).every(onWasteSide) && leadOut.slice(1).every(onWasteSide);
}

// Cross-part guard: no lead point may fall inside a disjoint sibling part.
function leadClearsSiblings(
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
  siblings: ReadonlyArray<ReadonlyArray<Vec2>>,
): boolean {
  if (siblings.length === 0) return true;
  const clear = (point: Vec2): boolean => siblings.every((s) => !pointInPolygon(point, s));
  return leadIn.slice(0, -1).every(clear) && leadOut.slice(1).every(clear);
}

// leadIn ends on, and leadOut begins on, the contour start vertex, so both
// splice on without a gap; the shared vertex is dropped to avoid a zero-length
// move. Every point rides the pass's cutting depth.
function ledPath3d(
  pass: CncContourPass,
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
): CncPath3dPass {
  const z = pass.zMm;
  const points: Vec3[] = [];
  for (const point of leadIn) points.push({ x: point.x, y: point.y, z });
  for (let i = 1; i < pass.polyline.length; i += 1) {
    const point = pass.polyline[i] as Vec2;
    points.push({ x: point.x, y: point.y, z });
  }
  for (let i = 1; i < leadOut.length; i += 1) {
    const point = leadOut[i] as Vec2;
    points.push({ x: point.x, y: point.y, z });
  }
  return { kind: 'path3d', points, closed: false };
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
