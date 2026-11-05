// Render-model segments → planner Blocks (ADR-255 stage 8b).
//
// One segment becomes one Block, which is what the planner already expects:
// it decomposes polylines per edge, and the render model is already per-edge
// (each G-code move, each sampled arc chord).
//
// Distance and direction both use XYZ: pure-Z reversals must stop, while
// collinear 3D moves retain their continuous junction velocity.

import { SEG_KIND, SEG_MOTION, type GcodeRenderModel } from '../gcode-view';
import type { Block } from '../motion-planner';
import { plannedDriveShare } from '../motion-planner/planner-kinematics';
import { SECONDS_PER_MINUTE, type MotionLimits } from './motion-limits';

const FLOATS_PER_SEGMENT = 6;

/** Blocks for segments [start, end); each block depends only on its own segment. */
export function segmentBlocks(
  model: GcodeRenderModel,
  limits: MotionLimits,
  start = 0,
  end = model.segmentCount,
): ReadonlyArray<Block> {
  const blocks: Block[] = [];
  for (let index = start; index < end; index += 1) {
    blocks.push(segmentBlock(model, index, limits));
  }
  return blocks;
}

/**
 * One segment's values as the render model stores them: positions, feed and
 * route ends rounded to Float32, the precise length as a double. A parser can
 * time a segment it never stores from the same values (ADR-244 Amendment 2).
 */
export type StoredSegment = {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly motion: number;
  readonly kind: number;
  readonly feed: number;
  readonly lengthMm: number | undefined;
  /** The route length before this segment and through it (segRouteEndMm). */
  readonly routeStartMm: number;
  readonly routeEndMm: number;
};

/** The block for one segment of the model. */
export function segmentBlock(model: GcodeRenderModel, index: number, limits: MotionLimits): Block {
  const base = index * FLOATS_PER_SEGMENT;
  const at = (offset: number) => model.positions[base + offset] ?? 0;
  return storedSegmentBlock(
    {
      dx: at(3) - at(0),
      dy: at(4) - at(1),
      dz: at(5) - at(2),
      motion: model.segMotion[index] ?? 0,
      kind: model.segKind[index] ?? 0,
      feed: model.segFeed[index] ?? 0,
      lengthMm: model.segLengthMm?.[index],
      routeStartMm: index === 0 ? 0 : (model.segRouteEndMm[index - 1] ?? 0),
      routeEndMm: model.segRouteEndMm[index] ?? 0,
    },
    limits,
  );
}

export function storedSegmentBlock(segment: StoredSegment, limits: MotionLimits): Block {
  const { dx, dy, dz } = segment;
  const length = Math.hypot(dx, dy, dz);
  const isRapid = segment.motion === SEG_MOTION.rapid;
  const direction =
    length > 0 ? { x: dx / length, y: dy / length, z: dz / length } : { x: 0, y: 0, z: 0 };
  const maxRate = maxRateAlong(direction, limits);
  return {
    kind: isCutting(segment) ? 'cut' : 'travel',
    motion: isRapid ? 'rapid' : 'feed',
    distance: segmentDistance(segment, length),
    targetVelocity: isRapid ? maxRate / SECONDS_PER_MINUTE : feedMmPerSec(segment.feed, maxRate),
    direction,
    ...(limits.laserModeMotion === true ? { laserModeMotion: true } : {}),
  };
}

// The max rate is per motor on CoreXY, so a diagonal tops out below it (ADR-675).
function maxRateAlong(direction: Block['direction'], limits: MotionLimits): number {
  return limits.maxFeedMmPerMin / plannedDriveShare(limits.kinematics ?? 'cartesian', direction);
}

function segmentDistance(segment: StoredSegment, chordLength: number): number {
  const preciseLength = segment.lengthMm;
  if (preciseLength !== undefined && Number.isFinite(preciseLength) && preciseLength > 0) {
    return preciseLength;
  }
  const motion = segment.motion;
  if (motion !== SEG_MOTION.cw && motion !== SEG_MOTION.ccw) return chordLength;
  // Compatibility for render-only models that did not retain precise lengths.
  // Execution timelines use the non-cumulative lengths above, since display
  // route differences can round to zero after a long prior route.
  const routeLength = segment.routeEndMm - segment.routeStartMm;
  return Number.isFinite(routeLength) && routeLength > 0 ? routeLength : chordLength;
}

function isCutting(segment: StoredSegment): boolean {
  const kind = segment.kind;
  if (kind === SEG_KIND.cut || kind === SEG_KIND.plunge) return true;
  // A Z-only retract commanded at feed rate is the chip clear inside a peck
  // cycle, not a seek: the tool is still in the hole at working feed and the
  // preview counts it in the cut step. Only a rapid retract is travel.
  return kind === SEG_KIND.retract && segment.motion !== SEG_MOTION.rapid;
}

// A feed move with no F word is a program defect (Program Health reports it);
// for timing, fall back to the machine max rather than dividing by zero.
function feedMmPerSec(feedMmPerMin: number, maxFeedMmPerMin: number): number {
  const requested = feedMmPerMin > 0 ? feedMmPerMin : maxFeedMmPerMin;
  return Math.min(requested, maxFeedMmPerMin) / SECONDS_PER_MINUTE;
}
