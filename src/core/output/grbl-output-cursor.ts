// Emission cursor for GRBL laser output: keeps constant-power (M3) output from
// making the controller drain its planner while the beam is still lit
// (2026-09-25 controller audit, OR-1).
//
// Under M3 the beam keeps its last programmed power while the head is stopped
// ("Constant laser power mode simply keeps the laser power as programmed,
// regardless if the machine is moving, accelerating, or stopped", GRBL wiki
// "Grbl v1.1 Laser Mode"). A line that drains the planner stops the head:
//   - a spindle word without motion (`M3 S0`, `M4 S0`, `M5`): GRBL 1.1h
//     gcode.c:917-923 and :940-947, grblHAL gcode.c:4121-4128, FluidNC
//     GCode.cpp:1640-1643;
//   - an air change (`M7`/`M8`/`M9`): GRBL coolant_control.c:124, grblHAL
//     coolant_control.c:62, FluidNC GCode.cpp:1731;
//   - a motion to where the head already is, under M3: GRBL
//     motion_control.c:67-76, grblHAL motion_control.c:182-190.
// Written straight after an M3 burn, such a line leaves a dot (GRBL 1.1h also
// blocks for its `$1` idle-lock time before the parser can turn the beam off),
// and an air on-delay (grblHAL `$673`, FluidNC `coolant/delay_ms`) holds the
// lit, stationary beam for the whole delay.
//
// A laser-off seek (`G0 X.. Y.. S0`, or the controlled `G1 ... S0`) queues a
// dark block without a drain (GRBL gcode.c:869-880 flags any line with axis
// words as laser motion and zeroes the power of non-G1/G2/G3 motion), so a
// drain written after it happens with the beam dark. The cursor therefore:
//   - tracks which spindle word is in effect in the stream written so far,
//     where the head is at the controller's three-decimal precision, and
//     whether a drain now would stop the head with an M3 beam lit;
//   - holds mode and air changes while the beam may be lit and writes them
//     after the next laser-off move;
//   - drops a laser-off move to where the head already is while M3 is in
//     effect (it would itself be the coincident-target drain);
//   - when the next burn starts where the head already is and changes are
//     held, adds a short laser-off move along that burn's first edge and back,
//     so the held changes still drain dark (heldLinesBeforeBurn).
// M4 output is dark at any stop (GRBL stepper.c:392-398 switches a
// rate-adjusted block's PWM off at an empty buffer), so nothing is held there
// and its bytes do not change.

import { formatGcodeCoordinateMm } from '../gcode';

export type EmittedHead = { readonly x: string; readonly y: string };
export type SpindleWordInEffect = 'M3' | 'M4' | 'off';

export type LaserOutputCursor = {
  /** Spindle word the controller has in effect after the lines written so far. */
  modeInEffect: SpindleWordInEffect;
  /** Head position at controller precision; null when unknown. */
  head: EmittedHead | null;
  /** A planner drain written now would stop the head with an M3 beam lit. */
  litAtStop: boolean;
  /** Mode and air lines waiting for the next laser-off move. */
  held: string[];
};

export function createLaserOutputCursor(modeInEffect: SpindleWordInEffect): LaserOutputCursor {
  return { modeInEffect, head: null, litAtStop: false, held: [] };
}

export function emittedHead(x: number, y: number): EmittedHead {
  return { x: formatGcodeCoordinateMm(x), y: formatGcodeCoordinateMm(y) };
}

/** Lines to write now for a planner-draining transition. While the beam may be
 * lit they are held instead and follow the next laser-off move. */
export function transitionLinesNow(
  cursor: LaserOutputCursor,
  lines: ReadonlyArray<string>,
): string[] {
  if (cursor.litAtStop) {
    cursor.held.push(...lines);
    return [];
  }
  noteSpindleWords(cursor, lines);
  return [...lines];
}

/** A laser-off move (seek or S0 runway). Under M3 a move to where the head
 * already is is dropped; otherwise the move is written, followed by any held
 * transitions, which now drain with the beam dark. */
export function laserOffMoveLines(
  cursor: LaserOutputCursor,
  target: EmittedHead,
  line: string,
): string[] {
  if (cursor.modeInEffect === 'M3' && sameHead(cursor.head, target)) return [];
  noteLaserOffMove(cursor, target);
  return [line, ...releaseHeldLines(cursor)];
}

type Point = { readonly x: number; readonly y: number };

/**
 * Transitions still held when a burn starts. That happens only when the burn
 * begins where the head already is (the next layer starts where the last burn
 * ended), so its seek was dropped and no laser-off move has darkened the beam.
 * A short laser-off move along the burn's first edge and back takes the drain
 * dark instead. It stays on the burn path, so it adds no reach beyond it. It
 * runs 1 mm, or the whole first edge when that is shorter: a move that rounds
 * to zero motor steps is the coincident-target drain again (GRBL planner.c:381
 * returns PLAN_EMPTY_BLOCK), and 1 mm is many steps on any laser axis, while a
 * shorter first edge is exactly the move the burn itself is about to make.
 */
export function heldLinesBeforeBurn(
  cursor: LaserOutputCursor,
  burn: { readonly start: Point; readonly firstTarget: Point },
  seekLine: (x: number, y: number) => string,
): string[] {
  if (cursor.held.length === 0) return [];
  const aside = excursionPoint(burn.start, burn.firstTarget);
  noteLaserOffMove(cursor, emittedHead(aside.x, aside.y));
  const held = releaseHeldLines(cursor);
  noteLaserOffMove(cursor, emittedHead(burn.start.x, burn.start.y));
  return [seekLine(aside.x, aside.y), ...held, seekLine(burn.start.x, burn.start.y)];
}

/** Length of that darkening move, bounded by the burn's first edge. */
export const DARKENING_EXCURSION_MM = 1;

function excursionPoint(start: Point, target: Point): Point {
  const length = Math.hypot(target.x - start.x, target.y - start.y);
  if (!(length > DARKENING_EXCURSION_MM)) return target;
  const scale = DARKENING_EXCURSION_MM / length;
  return {
    x: start.x + (target.x - start.x) * scale,
    y: start.y + (target.y - start.y) * scale,
  };
}

export function noteBurn(cursor: LaserOutputCursor, head: EmittedHead): void {
  cursor.head = head;
  cursor.litAtStop = cursor.modeInEffect === 'M3';
}

/** A laser-off move that follows burns inside one sweep (never held lines). */
export function noteLaserOffMove(cursor: LaserOutputCursor, head: EmittedHead): void {
  cursor.head = head;
  cursor.litAtStop = false;
}

export function releaseHeldLines(cursor: LaserOutputCursor): string[] {
  const lines = cursor.held;
  cursor.held = [];
  noteSpindleWords(cursor, lines);
  return lines;
}

/** Hand the held lines to a group that writes them itself (raster). */
export function takeHeldLines(cursor: LaserOutputCursor): string[] {
  const lines = cursor.held;
  cursor.held = [];
  return lines;
}

/** After a raster group, which writes its own spindle lines. Its last position
 * is not tracked here. An M3 group that ended on a burn left its closing `M5`
 * to be held until the next laser-off move. */
export function noteRasterGroupEnd(cursor: LaserOutputCursor, closingM5Deferred: boolean): void {
  cursor.head = null;
  cursor.held = closingM5Deferred ? ['M5'] : [];
  cursor.modeInEffect = closingM5Deferred ? 'M3' : 'off';
  cursor.litAtStop = closingM5Deferred;
}

function noteSpindleWords(cursor: LaserOutputCursor, lines: ReadonlyArray<string>): void {
  for (const line of lines) {
    if (/^M3\b/.test(line)) cursor.modeInEffect = 'M3';
    else if (/^M4\b/.test(line)) cursor.modeInEffect = 'M4';
    else if (/^M5\b/.test(line)) cursor.modeInEffect = 'off';
  }
}

function sameHead(head: EmittedHead | null, target: EmittedHead): boolean {
  return head !== null && head.x === target.x && head.y === target.y;
}
