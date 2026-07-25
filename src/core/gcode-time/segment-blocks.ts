// Render-model segments → planner Blocks (ADR-255 stage 8b).
//
// One segment becomes one Block, which is what the planner already expects:
// it decomposes polylines per edge, and the render model is already per-edge
// (each G-code move, each sampled arc chord).
//
// Known limit, stated rather than hidden: the planner's junction rule is
// planar (it dots XY directions), so a Z-only plunge or retract carries a
// zero direction and corners against its neighbours neutrally rather than as
// a full stop. Feed-vs-rapid transitions still force a stop, which is the
// dominant effect on real programs.

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
  const xyLength = Math.hypot(dx, dy);
  const isRapid = model.segMotion[index] === SEG_MOTION.rapid;
  return {
    kind: isCutting(model, index) ? 'cut' : 'travel',
    motion: isRapid ? 'rapid' : 'feed',
    distance: Math.hypot(xyLength, dz),
    targetVelocity: isRapid
      ? limits.maxFeedMmPerMin / SECONDS_PER_MINUTE
      : feedMmPerSec(model.segFeed[index] ?? 0, limits.maxFeedMmPerMin),
    direction: xyLength > 0 ? { x: dx / xyLength, y: dy / xyLength } : { x: 0, y: 0 },
  };
}

function isCutting(model: GcodeRenderModel, index: number): boolean {
  const kind = model.segKind[index];
  return kind === SEG_KIND.cut || kind === SEG_KIND.plunge;
}

// A feed move with no F word is a program defect (Program Health reports it);
// for timing, fall back to the machine max rather than dividing by zero.
function feedMmPerSec(feedMmPerMin: number, maxFeedMmPerMin: number): number {
  const requested = feedMmPerMin > 0 ? feedMmPerMin : maxFeedMmPerMin;
  return Math.max(1, Math.min(requested, maxFeedMmPerMin)) / SECONDS_PER_MINUTE;
}
