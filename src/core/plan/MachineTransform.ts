/**
 * Transforms a Plan from canvas coordinates (Y-down) to machine coordinates (Y-up).
 * This is the bridge between the design world and the physical machine.
 *
 * Pipeline position: Plan → [applyMachineTransform] → TransformedPlan → strategy.generate → Output
 */

import { type Plan, type PlannedOperation, type Move } from './Plan';
import { emptyAABB, expandAABB } from '../types';
import { type GcodeStartMode, computeGcodeOffset } from '../output/GcodeOrigin';

export interface MachineTransformOptions {
  startMode: GcodeStartMode;
  savedOrigin: { x: number; y: number } | null;
  flipY: boolean;
}

export interface MachineTransformResult {
  plan: Plan;
  /** The offset and flip values applied — useful for reverse-mapping (e.g. live preview dot). */
  offsetX: number;
  offsetY: number;
  designMaxY: number;
  flipY: boolean;
}

/**
 * Transform all move coordinates in a Plan from canvas space to machine space.
 * Returns a new Plan (original is not mutated) plus the transform parameters
 * so callers can reverse-map machine positions back to canvas positions.
 */
export function applyMachineTransform(
  plan: Plan,
  options: MachineTransformOptions,
): MachineTransformResult {
  // 1. Compute design bounds from all move destinations
  let bounds = emptyAABB();
  for (const op of plan.operations) {
    for (const move of op.moves) {
      if (move.type === 'rapid' || move.type === 'linear') {
        bounds = expandAABB(bounds, move.to.x, move.to.y);
      }
    }
  }
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 0;

  // 2. Compute X/Y offset from start mode
  const offset = computeGcodeOffset(
    options.startMode,
    { minX, minY },
    options.savedOrigin,
  );

  const flipY = options.flipY;
  const designMaxY = maxY;

  // 3. Transform every rapid/linear move
  const transformedOps: PlannedOperation[] = plan.operations.map(op => ({
    ...op,
    moves: op.moves.map(move => transformMove(move, offset.x, designMaxY, flipY)),
  }));

  // 4. Recompute bounds
  let newBounds = emptyAABB();
  for (const op of transformedOps) {
    for (const move of op.moves) {
      if (move.type === 'rapid' || move.type === 'linear') {
        newBounds = expandAABB(newBounds, move.to.x, move.to.y);
      }
    }
  }

  const transformedPlan: Plan = {
    ...plan,
    operations: transformedOps,
    bounds: {
      minX: Number.isFinite(newBounds.minX) ? newBounds.minX : 0,
      minY: Number.isFinite(newBounds.minY) ? newBounds.minY : 0,
      maxX: Number.isFinite(newBounds.maxX) ? newBounds.maxX : 0,
      maxY: Number.isFinite(newBounds.maxY) ? newBounds.maxY : 0,
    },
  };

  return {
    plan: transformedPlan,
    offsetX: offset.x,
    offsetY: offset.y,
    designMaxY,
    flipY,
  };
}

function transformMove(move: Move, offsetX: number, designMaxY: number, flipY: boolean): Move {
  switch (move.type) {
    case 'rapid':
      return {
        ...move,
        to: {
          x: move.to.x + offsetX,
          y: flipY ? designMaxY - move.to.y : move.to.y,
        },
      };
    case 'linear':
      return {
        ...move,
        to: {
          x: move.to.x + offsetX,
          y: flipY ? designMaxY - move.to.y : move.to.y,
        },
      };
    default:
      return move;
  }
}
