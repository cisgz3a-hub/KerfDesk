/**
 * Transforms a Plan from canvas coordinates (Y-down) to machine coordinates for GRBL.
 * Front-origin machines (e.g. $23=3): machineY = bedHeightMm - canvasY (+ offset).
 * Rear-origin: machineY = canvasY (+ offset) — canvas Y-down matches machine Y from back.
 *
 * Pipeline position: Plan → [applyMachineTransform] → TransformedPlan → strategy.generate → Output
 */

import { type Plan, type PlannedOperation, type Move } from './Plan';
import { emptyAABB, expandAABB } from '../types';
import { type GcodeStartMode, computeGcodeOffset } from '../output/GcodeOrigin';
import { type MachineOriginCorner } from '../devices/DeviceProfile';

const DEFAULT_BED_HEIGHT_MM = 300;

export type { MachineOriginCorner };

export interface MachineTransformOptions {
  startMode: GcodeStartMode;
  savedOrigin: { x: number; y: number } | null;
  originCorner: MachineOriginCorner;
  /**
   * Physical bed height (mm) for front-origin Y mapping: machineY = bedHeightMm - canvasY.
   * Use scene / profile / controller-reported height (see PipelineService resolution order).
   */
  bedHeightMm: number;
}

export interface MachineTransformResult {
  plan: Plan;
  /** The offset and flip values applied — useful for reverse-mapping (e.g. live preview dot). */
  offsetX: number;
  offsetY: number;
  /**
   * Reference Y used when flipY is true: machineY = flipReferenceY - canvasY + offsetY.
   * Equals physical bed height for front-left / front-right.
   */
  flipReferenceY: number;
  /** True when Y is mirrored into machine space (front-left / front-right). */
  flipY: boolean;
  /** Work-coordinate return point for program end (WCS origin after zeroing). */
  returnPosition: { x: number; y: number };
}

export function useFrontOriginYFlip(originCorner: MachineOriginCorner): boolean {
  return originCorner === 'front-left' || originCorner === 'front-right';
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

  const flipY = useFrontOriginYFlip(options.originCorner);
  const bedH =
    Number.isFinite(options.bedHeightMm) && options.bedHeightMm > 0
      ? options.bedHeightMm
      : DEFAULT_BED_HEIGHT_MM;
  const flipReferenceY = flipY ? bedH : maxY;

  const offsetDesignMin = {
    minX,
    minY: flipY ? bedH - maxY : minY,
  };

  const offset = computeGcodeOffset(
    options.startMode,
    offsetDesignMin,
    options.savedOrigin,
  );

  const transformedOps: PlannedOperation[] = plan.operations.map(op => ({
    ...op,
    moves: op.moves.map(move => transformMove(move, offset.x, offset.y, flipReferenceY, flipY)),
  }));

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
    flipReferenceY,
    flipY,
    returnPosition: { x: 0, y: 0 },
  };
}

function transformMove(
  move: Move,
  offsetX: number,
  offsetY: number,
  flipReferenceY: number,
  flipY: boolean,
): Move {
  switch (move.type) {
    case 'rapid':
      return {
        ...move,
        to: {
          x: move.to.x + offsetX,
          y: flipY ? flipReferenceY - move.to.y + offsetY : move.to.y + offsetY,
        },
      };
    case 'linear':
      return {
        ...move,
        to: {
          x: move.to.x + offsetX,
          y: flipY ? flipReferenceY - move.to.y + offsetY : move.to.y + offsetY,
        },
      };
    default:
      return move;
  }
}

/**
 * Transform a single canvas-space point to machine space using the same
 * rules as applyMachineTransform(). Used by Frame / jog previews / etc.
 * that need coordinates matching the compiled G-code job.
 *
 * `sceneBounds` must be the pre-transform bounding rectangle of the same
 * design whose coords are being transformed — the flip reference uses maxY.
 */
export function transformPointToMachine(
  point: { x: number; y: number },
  sceneBounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: MachineTransformOptions,
): { x: number; y: number } {
  const flipY = useFrontOriginYFlip(options.originCorner);
  const bedH =
    Number.isFinite(options.bedHeightMm) && options.bedHeightMm > 0
      ? options.bedHeightMm
      : DEFAULT_BED_HEIGHT_MM;
  const flipReferenceY = flipY ? bedH : sceneBounds.maxY;

  const offsetDesignMin = {
    minX: sceneBounds.minX,
    minY: flipY ? bedH - sceneBounds.maxY : sceneBounds.minY,
  };

  const offset = computeGcodeOffset(
    options.startMode,
    offsetDesignMin,
    options.savedOrigin,
  );

  return {
    x: point.x + offset.x,
    y: flipY ? flipReferenceY - point.y + offset.y : point.y + offset.y,
  };
}
