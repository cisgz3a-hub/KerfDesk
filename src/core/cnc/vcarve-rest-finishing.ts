import type { Vec3 } from '../geometry/vec3';
import type { CncGroup, CncPass, CncPath3dPass } from '../job/job';
import type { CncTool, Polyline } from '../scene';
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import {
  clearedCapsuleInterval,
  mergeClearedIntervals,
  type UnitInterval,
} from './cleared-capsule-interval';
import { representedCncCoordinateMm } from './cnc-output-precision';
import { cncContourEmissionVertices } from './cnc-contour-emission';
import {
  conicalRadialEnvelope,
  radialEnvelopeFootprintMm,
  type RadialEnvelope,
} from './radial-envelope';
import {
  buildVCarveBoundarySegmentIndex,
  everyVCarveBoundarySegmentInBox,
  type VCarveBoundarySegmentIndex,
} from './vcarve-boundary-segment-index';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { emittedChordIsSafe, sourceBoundarySegments } from './vcarve-detail-depth';

// Reserve more than the worst endpoint displacement on the emitted XY grid.
// A skipped span is justified by removed volume, never just by center coverage.
const SWEEP_RESERVE_MM = 0.003;

type ClearedStock = {
  readonly segments: VCarveBoundarySegmentIndex;
  readonly radiusMm: number;
  readonly depthMm: number;
};

/** Shorten a finish only after its actual, correctly owned clearing group exists. */
export function restAwareVCarveGroup(
  finish: CncGroup,
  clearingGroups: ReadonlyArray<CncGroup>,
  source: ReadonlyArray<Polyline> = [],
): CncGroup {
  if (finish.cutType !== 'v-carve' || !finish.vCarveFlatDepthEnabled) return finish;
  const envelope = finishEnvelope(finish);
  if (envelope === null) return finish;
  const clear = clearingGroups.find(
    (group) =>
      group.cutType === 'pocket' &&
      group.toolKind === 'end-mill' &&
      group.layerId === finish.layerId &&
      group.sourceObjectId === finish.sourceObjectId &&
      group.layerPrimaryToolId === finish.toolId,
  );
  if (clear === undefined) return finish;
  const stock = clearedStock(clear);
  if (stock === null) return finish;
  const normalized = normalizeClosedPolylinesEvenOddChecked(source);
  if (normalized.kind === 'error' || normalized.value.length === 0) return finish;
  const boundary = buildVCarveBoundarySegmentIndex(sourceBoundarySegments(normalized.value));
  const passes = finish.passes.flatMap((pass) =>
    pass.kind === 'path3d' ? trimPass(pass, stock, envelope, boundary) : [pass],
  );
  return { ...finish, passes };
}

function finishEnvelope(finish: CncGroup): RadialEnvelope | null {
  if (finish.toolId === undefined || finish.toolName === undefined) return null;
  if (finish.toolKind !== 'v-bit' && finish.toolKind !== 'engraving') return null;
  if (finish.toolTipAngleDeg === undefined) return null;
  const tool: CncTool = {
    id: finish.toolId,
    name: finish.toolName,
    kind: finish.toolKind,
    diameterMm: finish.toolDiameterMm,
    ...(finish.toolTipDiameterMm === undefined ? {} : { tipDiameterMm: finish.toolTipDiameterMm }),
  };
  return conicalRadialEnvelope(tool, finish.toolTipAngleDeg);
}

function clearedStock(group: CncGroup): ClearedStock | null {
  // Use only complete constant-Z contours actually handed to the emitter.
  // Shallower pecks and unsupported pass shapes cannot justify full-floor removal.
  const contours = group.passes.filter((pass) => pass.kind === 'contour');
  const depthMm = contours.reduce(
    (deepest, pass) => Math.max(deepest, -representedCncCoordinateMm(pass.zMm)),
    0,
  );
  const segments: BoundarySegment[] = [];
  for (const pass of contours) {
    if (-representedCncCoordinateMm(pass.zMm) !== depthMm) continue;
    const points = cncContourEmissionVertices(pass).map((vertex) => vertex.point);
    // The compiler explicitly repeats a closed contour's first vertex. The
    // emitter consumes only these vertices; a flag is not a removed segment.
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (a !== undefined && b !== undefined) segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  const radiusMm = group.toolDiameterMm / 2 - SWEEP_RESERVE_MM;
  return segments.length === 0 || !(depthMm > 0) || !(radiusMm > 0)
    ? null
    : { segments: buildVCarveBoundarySegmentIndex(segments), radiusMm, depthMm };
}

function coveredIntervals(
  a: Vec3,
  b: Vec3,
  stock: ClearedStock,
  envelope: RadialEnvelope,
): UnitInterval[] {
  const depthMm = Math.max(-a.z, -b.z);
  if (depthMm > stock.depthMm || !(depthMm > 0)) return [];
  const radius = stock.radiusMm - radialEnvelopeFootprintMm(envelope, depthMm);
  if (!(radius > 0)) return [];
  const intervals: UnitInterval[] = [];
  everyVCarveBoundarySegmentInBox(
    stock.segments,
    {
      minX: Math.min(a.x, b.x) - radius,
      minY: Math.min(a.y, b.y) - radius,
      maxX: Math.max(a.x, b.x) + radius,
      maxY: Math.max(a.y, b.y) + radius,
    },
    (segment) => {
      const interval = clearedCapsuleInterval(a, b, segment, radius);
      if (interval !== null) intervals.push(interval);
      return true;
    },
  );
  return mergeClearedIntervals(intervals);
}

function trimPass(
  pass: CncPath3dPass,
  stock: ClearedStock,
  envelope: RadialEnvelope,
  boundary: VCarveBoundarySegmentIndex,
): CncPass[] {
  const fragments: Vec3[][] = [];
  const represented = pass.points.map((point) => ({
    x: representedCncCoordinateMm(point.x),
    y: representedCncCoordinateMm(point.y),
    z: representedCncCoordinateMm(point.z),
  }));
  let changed = false;
  for (let i = 1; i < represented.length; i += 1) {
    const a = represented[i - 1];
    const b = represented[i];
    if (a === undefined || b === undefined) continue;
    let low = 0;
    // Only shorten constant-depth floor chords. Preserve the complete wall
    // profile, and avoid a new split's Z rounding changing its radial sweep.
    const intervals = a.z === b.z ? coveredIntervals(a, b, stock, envelope) : [];
    for (const cut of intervals) {
      changed = changed || cut.high > cut.low;
      if (cut.low > low)
        appendFragment(
          fragments,
          interpolate(a, b, low),
          interpolate(a, b, cut.low),
          stock,
          envelope,
        );
      low = cut.high;
    }
    if (low < 1) appendFragment(fragments, interpolate(a, b, low), b, stock, envelope);
  }
  if (!changed || pass.points.length < 2) return [pass];
  // Recheck all newly rounded split endpoints and replacement connectors with
  // the source-boundary certificate. A failed optimization keeps the original
  // complete pass; clearing must never weaken its containment contract.
  if (!fragmentsAreContained(fragments, boundary, envelope)) return [pass];
  return fragments
    .filter((points) => points.length > 1)
    .map((points) => ({
      ...pass,
      points,
      closed: samePoint(points[0], points.at(-1)),
    }));
}

function fragmentsAreContained(
  fragments: ReadonlyArray<ReadonlyArray<Vec3>>,
  boundary: VCarveBoundarySegmentIndex,
  envelope: RadialEnvelope,
): boolean {
  for (const points of fragments) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (
        a !== undefined &&
        b !== undefined &&
        !emittedChordIsSafe(a, b, -a.z, -b.z, boundary, envelope)
      )
        return false;
    }
  }
  return true;
}

function appendFragment(
  fragments: Vec3[][],
  a: Vec3,
  b: Vec3,
  stock: ClearedStock,
  envelope: RadialEnvelope,
): void {
  const previous = fragments.at(-1);
  const end = previous?.at(-1);
  // A direct connector may replace a long already-cleared detour only when
  // that connector's complete volume has the same independent clearing proof.
  const joined = end === undefined ? [] : coveredIntervals(end, a, stock, envelope);
  if (
    previous !== undefined &&
    (samePoint(end, a) || (joined.length === 1 && joined[0]?.low === 0 && joined[0].high === 1))
  ) {
    if (!samePoint(end, a)) previous.push(a);
    previous.push(b);
  } else {
    fragments.push([a, b]);
  }
}

function interpolate(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t === 0) return a;
  if (t === 1) return b;
  return {
    x: representedCncCoordinateMm(a.x + (b.x - a.x) * t),
    y: representedCncCoordinateMm(a.y + (b.y - a.y) * t),
    // Newly split positions stay at least as shallow as the certified chord.
    z: a.z === b.z ? a.z : Math.ceil((a.z + (b.z - a.z) * t) * 1000) / 1000,
  };
}

function samePoint(a: Vec3 | undefined, b: Vec3 | undefined): boolean {
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.z === b.z;
}
