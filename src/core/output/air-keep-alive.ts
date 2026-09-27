// Best-effort air-command repeats at eligible boundaries in an emitted GRBL
// laser job (ADR-462), for profiles with unreliable air restart/standby.
//
// Reported Falcon A1-family firmware behavior motivates this mitigation; it
// does not establish that an installed controller resets its timer on repeats.
// The firmware/$152 advice and hardware qualification remain necessary.
//
// AIR_KEEP_ALIVE_SECONDS is an estimated-time trigger, not a maximum gap.
// A repeat cannot occur inside a long move or dwell. Under M3 it also waits
// until a laser-off move has left the beam dark (OR-1), which can defer it
// arbitrarily long. No motion is segmented or changed to force a repeat.
// For ordinary short blocks, counting each move from rest to rest can make
// repeats more frequent than a blended-motion estimate. Neither those profile
// assumptions nor command-boundary opportunities bound actual elapsed time.
//
// On firmware that honours M8 normally the repeat changes nothing: stock GRBL
// syncs only when the coolant state differs (grbl/gcode.c:952-956) and grblHAL
// drops an unchanged M8 before executing the block (gcode.c:2647), so it never
// stops the head there. Vendor firmware may differ, so OR-1 still applies.
// https://github.com/gnea/grbl/blob/master/grbl/gcode.c
// https://github.com/grblHAL/core/blob/master/gcode.c

import { scanGcodeWords, stripInlineComments, type GcodeWordMatch } from '../gcode';
import {
  ARC_EPSILON,
  arcSweepAngle,
  ijArcCenter,
  rArcGeometry,
  type XyPoint,
} from '../gcode/arc-solve';
import type { GcodeMotionMode } from '../gcode/modal-motion-line';
import { LINE_END } from './grbl-laser-lines';

export const AIR_KEEP_ALIVE_SECONDS = 5;

export type AirKeepAliveLimits = {
  /** Fastest feed the machine is assumed to reach, mm/min; also its rapid rate. */
  readonly maxFeedMmPerMin: number;
  readonly accelMmPerSec2: number;
};

type AirWord = 'M7' | 'M8';

type KeepAliveCursor = {
  air: AirWord | null;
  spindle: 'M3' | 'M4' | 'off';
  motion: GcodeMotionMode;
  feedMmPerMin: number;
  power: number;
  x: number;
  y: number;
  z: number;
  /** The last move may have left an M3 beam lit, so a drain now would mark. */
  lit: boolean;
  /** Estimated motion/dwell time since the last air command, not a wall clock. */
  elapsed: number;
};

const AIR_ON_LINE = /^M[78]$/m;

/** The program with the air command repeated while air is on; unchanged when
 *  the program never switches air on. */
export function withAirKeepAlive(
  program: string,
  limits: AirKeepAliveLimits,
  intervalSeconds: number = AIR_KEEP_ALIVE_SECONDS,
): string {
  if (!AIR_ON_LINE.test(program)) return program;
  const cursor: KeepAliveCursor = {
    air: null,
    spindle: 'off',
    motion: 0,
    feedMmPerMin: 0,
    power: 0,
    x: 0,
    y: 0,
    z: 0,
    lit: false,
    elapsed: 0,
  };
  const out: string[] = [];
  for (const line of program.split(LINE_END)) {
    const words = blockWords(line);
    if (cursor.air !== null && repeatDue(cursor, words, intervalSeconds)) {
      out.push(cursor.air);
      cursor.elapsed = 0;
    }
    applyBlock(cursor, words, limits);
    out.push(line);
  }
  return out.join(LINE_END);
}

function blockWords(line: string): ReadonlyArray<GcodeWordMatch> {
  const block = line.includes(';') || line.includes('(') ? stripInlineComments(line) : line;
  return block.length === 0 ? [] : scanGcodeWords(block);
}

function repeatDue(
  cursor: KeepAliveCursor,
  words: ReadonlyArray<GcodeWordMatch>,
  intervalSeconds: number,
): boolean {
  if (cursor.elapsed < intervalSeconds || !hasMotionTarget(words)) return false;
  return !(cursor.spindle === 'M3' && cursor.lit);
}

function hasMotionTarget(words: ReadonlyArray<GcodeWordMatch>): boolean {
  // A full circle may name only its I/J center, with both endpoints held.
  return words.some(({ letter }) => 'XYZIJR'.includes(letter));
}

function applyBlock(
  cursor: KeepAliveCursor,
  words: ReadonlyArray<GcodeWordMatch>,
  limits: AirKeepAliveLimits,
): void {
  for (const word of words) applyWord(cursor, word, words);
  const target = axisTarget(cursor, words);
  if (target === null) return;
  const distance = motionDistanceMm(cursor, target, words);
  const feed =
    cursor.motion === 0
      ? limits.maxFeedMmPerMin
      : cappedFeed(cursor.feedMmPerMin, limits.maxFeedMmPerMin);
  cursor.elapsed += moveSecondsUpperBound(distance, feed / 60, limits.accelMmPerSec2);
  cursor.x = target.x;
  cursor.y = target.y;
  cursor.z = target.z;
  cursor.lit = cursor.motion !== 0 && cursor.power > 0 && cursor.spindle !== 'off';
}

// This postprocessor consumes generated G21/G90 XY-plane output, not arbitrary
// imported programs. Shared arc-center/sweep math counts the actual G2/G3 path.
function motionDistanceMm(
  cursor: KeepAliveCursor,
  target: { readonly x: number; readonly y: number; readonly z: number },
  words: ReadonlyArray<GcodeWordMatch>,
): number {
  const chord = Math.hypot(target.x - cursor.x, target.y - cursor.y, target.z - cursor.z);
  if (cursor.motion !== 2 && cursor.motion !== 3) return chord;
  const center = motionArcCenter(cursor, target, words);
  // An unresolved duration makes the next eligible boundary due. This pass
  // does not validate, reject or rewrite the supplied motion geometry.
  if (center === null) return Number.POSITIVE_INFINITY;
  const radius = Math.hypot(cursor.x - center.x, cursor.y - center.y);
  if (!(radius > 0) || !Number.isFinite(radius)) return Number.POSITIVE_INFINITY;
  const sweep = arcSweepAngle(
    Math.atan2(cursor.y - center.y, cursor.x - center.x),
    Math.atan2(target.y - center.y, target.x - center.x),
    cursor.motion === 2,
    Math.hypot(target.x - cursor.x, target.y - cursor.y) <= ARC_EPSILON,
  );
  return Math.hypot(Math.abs(sweep) * radius, target.z - cursor.z);
}

function motionArcCenter(
  cursor: KeepAliveCursor,
  target: XyPoint,
  words: ReadonlyArray<GcodeWordMatch>,
): XyPoint | null {
  const i = words.find(({ letter }) => letter === 'I')?.value;
  const j = words.find(({ letter }) => letter === 'J')?.value;
  if (i !== undefined || j !== undefined) return ijArcCenter(cursor, i, j, 1);
  const r = words.find(({ letter }) => letter === 'R')?.value;
  if (r === undefined) return null;
  const solved = rArcGeometry(cursor, target, r, cursor.motion === 2, 1);
  return solved !== null && solved.halfChordGapSq >= 0 ? solved.center : null;
}

function applyWord(
  cursor: KeepAliveCursor,
  word: GcodeWordMatch,
  words: ReadonlyArray<GcodeWordMatch>,
): void {
  switch (word.letter) {
    case 'G':
      applyGWord(cursor, word.value, words);
      break;
    case 'M':
      applyMWord(cursor, word.value);
      break;
    case 'F':
      cursor.feedMmPerMin = word.value;
      break;
    case 'S':
      cursor.power = word.value;
      break;
    default:
      break;
  }
}

function axisTarget(
  cursor: KeepAliveCursor,
  words: ReadonlyArray<GcodeWordMatch>,
): { x: number; y: number; z: number } | null {
  let target: { x: number; y: number; z: number } | null = null;
  for (const { letter, value } of words) {
    if (letter !== 'X' && letter !== 'Y' && letter !== 'Z') continue;
    target ??= { x: cursor.x, y: cursor.y, z: cursor.z };
    if (letter === 'X') target.x = value;
    else if (letter === 'Y') target.y = value;
    else target.z = value;
  }
  if (target !== null) return target;
  return (cursor.motion === 2 || cursor.motion === 3) && hasMotionTarget(words)
    ? { x: cursor.x, y: cursor.y, z: cursor.z }
    : null;
}

function applyGWord(
  cursor: KeepAliveCursor,
  value: number,
  words: ReadonlyArray<GcodeWordMatch>,
): void {
  if (value === 0 || value === 1 || value === 2 || value === 3) cursor.motion = value;
  else if (value === 4) {
    // GRBL's G4 P is in seconds; the dwell counts toward the interval.
    const pause = words.find(({ letter }) => letter === 'P')?.value ?? 0;
    if (Number.isFinite(pause) && pause > 0) cursor.elapsed += pause;
  }
}

function applyMWord(cursor: KeepAliveCursor, value: number): void {
  if (value === 3) cursor.spindle = 'M3';
  else if (value === 4) cursor.spindle = 'M4';
  else if (value === 5) {
    cursor.spindle = 'off';
    cursor.lit = false;
  } else if (value === 7 || value === 8) {
    cursor.air = value === 7 ? 'M7' : 'M8';
    cursor.elapsed = 0;
  } else if (value === 9) cursor.air = null;
}

function cappedFeed(feedMmPerMin: number, maxFeedMmPerMin: number): number {
  return Number.isFinite(feedMmPerMin) && feedMmPerMin > 0
    ? Math.min(feedMmPerMin, maxFeedMmPerMin)
    : maxFeedMmPerMin;
}

/** Time for a move that starts and ends at rest: a trapezoid when the move is
 *  long enough to reach `speed`, otherwise a triangle. */
export function moveSecondsUpperBound(
  distanceMm: number,
  speedMmPerSec: number,
  accelMmPerSec2: number,
): number {
  if (!(distanceMm > 0) || !(speedMmPerSec > 0)) return 0;
  if (!(accelMmPerSec2 > 0) || !Number.isFinite(accelMmPerSec2)) return distanceMm / speedMmPerSec;
  const rampDistance = (speedMmPerSec * speedMmPerSec) / accelMmPerSec2;
  return distanceMm >= rampDistance
    ? distanceMm / speedMmPerSec + speedMmPerSec / accelMmPerSec2
    : 2 * Math.sqrt(distanceMm / accelMmPerSec2);
}
