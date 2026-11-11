// The Frame a Lihuiyu link runs (ADR-703): the job's burn bounds traced in
// program mode with the beam never switched on, at the profile's framing
// speed, then a rapid move back to where the head started. MeerK40t documents
// no board-side frame command, so the frame is a stream of its own; it holds
// no 'D', so nothing in it fires the tube. Program mode ends with "FNSE-",
// so the host learns from the board's finish when the trace is done.

import {
  unionLhyBounds,
  type LhyBounds,
  type LhyMotionPart,
  type LhyPoint,
} from './lhy-motion-plan';
import { directionsFor, type LhyBoardSetting } from './lhy-encoder';
import { lhySpeedCode } from './lhy-speed-code';
import { LhyWriter } from './lhy-writer';

/** What a Frame proves: the job's burn bounds and where the head starts, both
 *  in job coordinates. Start compares it with the last Frame's, so a moved,
 *  resized or re-anchored job needs a new Frame (non-negotiable 21, ADR-565). */
export type LhyFootprint = { readonly bounds: LhyBounds; readonly start: LhyPoint };

export function lhyFootprint(
  motion: ReadonlyArray<LhyMotionPart>,
  start: LhyPoint,
): LhyFootprint | null {
  if (motion.length === 0) return null;
  return { bounds: unionLhyBounds(motion), start };
}

export function sameLhyFootprint(a: LhyFootprint | null, b: LhyFootprint | null): boolean {
  if (a === null || b === null) return false;
  return (
    a.start.x === b.start.x &&
    a.start.y === b.start.y &&
    a.bounds.minX === b.bounds.minX &&
    a.bounds.minY === b.bounds.minY &&
    a.bounds.maxX === b.bounds.maxX &&
    a.bounds.maxY === b.bounds.maxY
  );
}

export function encodeLhyFrame(
  footprint: LhyFootprint,
  board: LhyBoardSetting,
  framingMmPerMin: number,
): Uint8Array {
  const { bounds, start } = footprint;
  const writer = new LhyWriter(start);
  const speed = lhySpeedCode(Math.max(1, framingMmPerMin / 60), { ...board, suffixC: true });
  writer.rapidMove(bounds.minX - start.x, bounds.minY - start.y);
  const corners: ReadonlyArray<LhyPoint> = [
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.minY },
  ];
  for (const corner of corners) {
    const dx = corner.x - writer.x;
    const dy = corner.y - writer.y;
    if (dx === 0 && dy === 0) continue;
    writer.enterProgram(speed, directionsFor(dx, dy));
    writer.programMove(dx, dy, false);
  }
  writer.leaveProgram();
  writer.rapidMove(start.x - writer.x, start.y - writer.y);
  return writer.stream();
}
