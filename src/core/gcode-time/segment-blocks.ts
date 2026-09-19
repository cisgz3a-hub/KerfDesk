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
import { SECONDS_PER_MINUTE, type MotionLimits } from './motion-limits';

const FLOATS_PER_SEGMENT = 6;

export function segmentBlocks(model: GcodeRenderModel, limits: MotionLimits): ReadonlyArray<Block> {
  const blocks: Block[] = [];
  for (let index = 0; index < model.segmentCount; index += 1) {
    blocks.push(segmentBlock(model, index, limits));
  }
  return blocks;
}

function segmentBlock(model: GcodeRenderModel, index: number, limits: MotionLimits): Block {
  const base = index * FLOATS_PER_SEGMENT;
  const dx = (model.positions[base + 3] ?? 0) - (model.positions[base] ?? 0);
  const dy = (model.positions[base + 4] ?? 0) - (model.positions[base + 1] ?? 0);
  const dz = (model.positions[base + 5] ?? 0) - (model.positions[base + 2] ?? 0);
  const length = Math.hypot(dx, dy, dz);
  const isRapid = model.segMotion[index] === SEG_MOTION.rapid;
  return {
    kind: isCutting(model, index) ? 'cut' : 'travel',
    motion: isRapid ? 'rapid' : 'feed',
    distance: segmentDistance(model, index, length),
    targetVelocity: isRapid
      ? limits.maxFeedMmPerMin / SECONDS_PER_MINUTE
      : feedMmPerSec(model.segFeed[index] ?? 0, limits.maxFeedMmPerMin),
    direction:
      length > 0 ? { x: dx / length, y: dy / length, z: dz / length } : { x: 0, y: 0, z: 0 },
  };
}

function segmentDistance(model: GcodeRenderModel, index: number, chordLength: number): number {
  const preciseLength = model.segLengthMm?.[index];
  if (preciseLength !== undefined && Number.isFinite(preciseLength) && preciseLength > 0) {
    return preciseLength;
  }
  const motion = model.segMotion[index];
  if (motion !== SEG_MOTION.cw && motion !== SEG_MOTION.ccw) return chordLength;
  // Compatibility for render-only models that did not retain precise lengths.
  // Execution timelines use the non-cumulative lengths above, since display
  // route differences can round to zero after a long prior route.
  const start = index === 0 ? 0 : model.segRouteEndMm[index - 1];
  const end = model.segRouteEndMm[index];
  const routeLength = start === undefined || end === undefined ? 0 : end - start;
  return Number.isFinite(routeLength) && routeLength > 0 ? routeLength : chordLength;
}

function isCutting(model: GcodeRenderModel, index: number): boolean {
  const kind = model.segKind[index];
  return kind === SEG_KIND.cut || kind === SEG_KIND.plunge;
}

// A feed move with no F word is a program defect (Program Health reports it);
// for timing, fall back to the machine max rather than dividing by zero.
function feedMmPerSec(feedMmPerMin: number, maxFeedMmPerMin: number): number {
  const requested = feedMmPerMin > 0 ? feedMmPerMin : maxFeedMmPerMin;
  return Math.min(requested, maxFeedMmPerMin) / SECONDS_PER_MINUTE;
}
