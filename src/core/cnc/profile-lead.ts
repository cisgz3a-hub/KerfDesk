// Arc/line lead-in and lead-out geometry for closed CNC profile cuts
// (ADR-250). Pure geometry only: it computes WHERE the bit should plunge (out
// in the scrap) and the tangent path onto the finished contour. It does NOT
// emit G-code itself; profile-lead-passes.ts bakes it into closed profile
// passes, and leads are DEFAULT-ON for profile-outside/inside cuts (ADR-250).
//
// Why this exists: a profile pass today plunges straight down onto its first
// contour vertex. With cutter-radius compensation that vertex sits tangent to
// the finished wall, so a full-depth plunge marks the wall exactly where the
// cut starts. A lead moves the plunge into the waste and arrives on the
// contour tangentially, so the entry mark lands in the offcut, not on the part
// (LightBurn / Fusion / Easel parity).

import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { Polyline, Vec2 } from '../scene';
import type { ProfileSide } from './profile-paths';

/** arc = tangent quarter-turn (smooth); line = straight perpendicular from the waste. */
export type LeadShape = 'arc' | 'line';

export type ProfileLeadOptions = {
  readonly shape: LeadShape;
  /** Arc radius, or straight-line length, in mm. Must be positive and finite. */
  readonly radiusMm: number;
  /** Arc sweep in degrees, clamped to [10, 180]. Ignored for line leads. */
  readonly sweepDeg?: number;
};

/** `leadIn` ends on — and `leadOut` begins on — the contour start vertex, so
 * both splice onto the cut without a gap. `plunge` is the waste-side descent. */
export type ProfileLead = {
  readonly plunge: Vec2;
  readonly leadIn: ReadonlyArray<Vec2>;
  readonly leadOut: ReadonlyArray<Vec2>;
};

export type ProfileLeadResult =
  | { readonly ok: true; readonly lead: ProfileLead }
  | { readonly ok: false; readonly reason: string };

const EPSILON = 1e-7;
const DEFAULT_SWEEP_DEG = 90;
const MIN_SWEEP_DEG = 10;
const MAX_SWEEP_DEG = 180;
const ARC_STEP_DEG = 15;
const MIN_RING_POINTS = 3;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Compute the lead-in / lead-out for a closed, already-offset profile toolpath.
 * Returns a typed refusal (never throws, never emits poison geometry) for
 * on-path cuts and degenerate input, matching the core Result convention.
 */
export function computeProfileLead(
  toolpath: Polyline,
  side: ProfileSide,
  options: ProfileLeadOptions,
): ProfileLeadResult {
  if (side === 'on-path') {
    return { ok: false, reason: 'On-path profile cuts have no waste side for a lead.' };
  }
  if (!(Number.isFinite(options.radiusMm) && options.radiusMm > EPSILON)) {
    return { ok: false, reason: 'Lead radius/length must be a positive, finite length.' };
  }
  const ring = normalizedRing(toolpath.points);
  if (!toolpath.closed || ring.length < MIN_RING_POINTS) {
    return { ok: false, reason: 'A lead requires a closed profile with at least three points.' };
  }
  const area = signedAreaMm2(ring);
  if (Math.abs(area) <= EPSILON) {
    return { ok: false, reason: 'A zero-area profile has no defined interior.' };
  }
  const entry = ring[0] as Vec2;
  const inDir = edgeDirectionForward(ring);
  const outDir = edgeDirectionArriving(ring);
  if (inDir === null || outDir === null) {
    return { ok: false, reason: 'The profile has no non-degenerate edge to align a lead to.' };
  }
  const isCcw = area > 0;
  const leadIn = buildLead('in', entry, inDir, wasteNormal(inDir, isCcw, side), options);
  const leadOut = buildLead('out', entry, outDir, wasteNormal(outDir, isCcw, side), options);
  return { ok: true, lead: { plunge: leadIn[0] as Vec2, leadIn, leadOut } };
}

type LeadKind = 'in' | 'out';

function buildLead(
  kind: LeadKind,
  entry: Vec2,
  dir: Vec2,
  wasteN: Vec2,
  options: ProfileLeadOptions,
): ReadonlyArray<Vec2> {
  if (options.shape === 'line') {
    const off: Vec2 = {
      x: entry.x + wasteN.x * options.radiusMm,
      y: entry.y + wasteN.y * options.radiusMm,
    };
    return kind === 'in' ? [off, entry] : [entry, off];
  }
  const sweep = options.sweepDeg ?? DEFAULT_SWEEP_DEG;
  return arcLead(kind, entry, dir, wasteN, options.radiusMm, sweep);
}

function arcLead(
  kind: LeadKind,
  entry: Vec2,
  dir: Vec2,
  wasteN: Vec2,
  radiusMm: number,
  sweepDeg: number,
): ReadonlyArray<Vec2> {
  const sweep = clamp(sweepDeg, MIN_SWEEP_DEG, MAX_SWEEP_DEG) * DEG_TO_RAD;
  const center: Vec2 = { x: entry.x + wasteN.x * radiusMm, y: entry.y + wasteN.y * radiusMm };
  const uEx = -wasteN.x;
  const uEy = -wasteN.y;
  const thetaE = Math.atan2(uEy, uEx);
  // A counter-clockwise sweep's velocity at the entry is the +90 degree
  // rotation of the outward radial. If that matches the edge direction, time
  // runs with increasing theta; otherwise with decreasing theta.
  const ccwGivesDir = -uEy * dir.x + uEx * dir.y > 0;
  const s = ccwGivesDir ? 1 : -1;
  return kind === 'out'
    ? sampleArc(center, radiusMm, thetaE, thetaE + s * sweep)
    : sampleArc(center, radiusMm, thetaE - s * sweep, thetaE);
}

function sampleArc(center: Vec2, radiusMm: number, thetaStart: number, thetaEnd: number): Vec2[] {
  const span = thetaEnd - thetaStart;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / (ARC_STEP_DEG * DEG_TO_RAD)));
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = thetaStart + span * (i / steps);
    points.push({
      x: center.x + radiusMm * Math.cos(theta),
      y: center.y + radiusMm * Math.sin(theta),
    });
  }
  return points;
}

// Waste side: exterior of the loop for an outside profile, interior for an
// inside profile. Interior lies to the left of travel for a CCW loop (Y up),
// to the right for a CW loop.
function wasteNormal(dir: Vec2, isCcw: boolean, side: ProfileSide): Vec2 {
  const interior: Vec2 = isCcw ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
  return side === 'outside' ? { x: -interior.x, y: -interior.y } : interior;
}

function edgeDirectionForward(ring: ReadonlyArray<Vec2>): Vec2 | null {
  const start = ring[0] as Vec2;
  for (let i = 1; i < ring.length; i += 1) {
    const next = ring[i] as Vec2;
    const dir = unit(next.x - start.x, next.y - start.y);
    if (dir !== null) return dir;
  }
  return null;
}

function edgeDirectionArriving(ring: ReadonlyArray<Vec2>): Vec2 | null {
  const end = ring[0] as Vec2;
  for (let i = ring.length - 1; i >= 1; i -= 1) {
    const prev = ring[i] as Vec2;
    const dir = unit(end.x - prev.x, end.y - prev.y);
    if (dir !== null) return dir;
  }
  return null;
}

function unit(x: number, y: number): Vec2 | null {
  const length = Math.hypot(x, y);
  return length <= EPSILON ? null : { x: x / length, y: y / length };
}

function normalizedRing(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON ? points.slice(0, -1) : points;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
