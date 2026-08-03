import type { Vec2 } from '../scene';
import { vcarvePointBounds } from './vcarve-medial-budget';
import {
  distinctLoopPoints,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

const AUTO_MAX_RESOLUTION_MM = 0.1;
const SAMPLES_ACROSS_SHORT_SPAN = 32;
const POSITION_KEY_SCALE = 1e7;

export type VCarveBoundarySample = Vec2 & {
  readonly loopIndex: number;
  readonly edgeIndex: number;
  readonly loopEdgeCount: number;
};

export type VCarveMedialResolutionPlan = {
  readonly value: number;
  readonly minimum: number;
  readonly budgetLimited: boolean;
};

export function sampleVCarveBoundary(
  segments: ReadonlyArray<VCarveBoundarySegment>,
  resolutionMm: number,
  sampleBudget: number,
): { readonly samples: ReadonlyArray<VCarveBoundarySample>; readonly budgetLimited: boolean } {
  const samples: VCarveBoundarySample[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    const pieces = Math.max(1, Math.ceil(length / resolutionMm));
    appendSegmentSamples(samples, seen, segment, pieces);
  }
  if (samples.length <= sampleBudget) return { samples, budgetLimited: false };
  return { samples: sampledToBudget(samples, sampleBudget), budgetLimited: true };
}

export function resolveVCarveMedialResolution(
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  requestedResolutionMm: number,
  sampleBudget: number,
): VCarveMedialResolutionPlan | null {
  const points = distinctLoopPoints(region.outer.points);
  if (points.length < 3) return null;
  const bounds = vcarvePointBounds(points);
  const shortSpan = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (!(shortSpan > 0) || !Number.isFinite(shortSpan)) return null;
  const requested =
    Number.isFinite(requestedResolutionMm) && requestedResolutionMm > 0
      ? requestedResolutionMm
      : AUTO_MAX_RESOLUTION_MM;
  const shapeResolution = Math.min(requested, shortSpan / SAMPLES_ACROSS_SHORT_SPAN);
  const perimeter = segments.reduce(
    (sum, segment) => sum + Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y),
    0,
  );
  const budgetFloor = perimeter / sampleBudget;
  const minimum = Math.max(budgetFloor, 0.001);
  const value = Math.max(shapeResolution, minimum);
  return Number.isFinite(value) && value > 0
    ? { value, minimum, budgetLimited: budgetFloor > shapeResolution }
    : null;
}

export function vcarveMedialPointKey(point: Vec2): string {
  return `${Math.round(point.x * POSITION_KEY_SCALE)}:${Math.round(point.y * POSITION_KEY_SCALE)}`;
}

function appendSegmentSamples(
  samples: VCarveBoundarySample[],
  seen: Set<string>,
  segment: VCarveBoundarySegment,
  pieces: number,
): void {
  for (let piece = 0; piece < pieces; piece += 1) {
    const t = piece / pieces;
    const sample: VCarveBoundarySample = {
      x: segment.a.x + (segment.b.x - segment.a.x) * t,
      y: segment.a.y + (segment.b.y - segment.a.y) * t,
      loopIndex: segment.loopIndex,
      edgeIndex: segment.edgeIndex,
      loopEdgeCount: segment.loopEdgeCount,
    };
    const key = vcarveMedialPointKey(sample);
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(sample);
  }
}

function sampledToBudget(
  samples: ReadonlyArray<VCarveBoundarySample>,
  sampleBudget: number,
): ReadonlyArray<VCarveBoundarySample> {
  return Array.from({ length: sampleBudget }, (_, index) => {
    const sourceIndex = Math.floor((index * samples.length) / sampleBudget);
    return samples[sourceIndex];
  }).filter((sample): sample is VCarveBoundarySample => sample !== undefined);
}
