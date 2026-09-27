// Repeats the air command inside a running job on a controller whose own timer
// switches the pump off while the job still wants air (ADR-462).
//
// Creality's Falcon A1 family stops the air pump, and the enclosure fan that
// runs with it, a fixed time after the last M8: `$152`, 0..100 s, reported
// default 20 or 30, 100 = never. A user testing A1 firmware 1.0.6 found air
// "does turn off after a while (20ish seconds) with the main fan unless I
// continue issuing M8s", and that `$152=0` stops it at once (LightBurn forum
// 181704, posts 19, 22 and 24). LightBurn staff call the 30-second cut-off a
// confirmed firmware bug on both the A1 and the A1 Pro (post 2). KerfDesk wrote
// one M8 before the first Air-on operation, so on that firmware a job ran
// without air or exhaust from about half a minute in.
//
// So on a profile flagged `airAssistRestartUnreliable` the program repeats the
// air command every AIR_KEEP_ALIVE_SECONDS of motion while air is on. On
// firmware that honours M8 normally the repeat changes nothing: stock GRBL
// syncs only when the coolant state differs (grbl/gcode.c:952-956) and grblHAL
// drops an unchanged M8 before executing the block (gcode.c:2647), so it never
// stops the head. Under M3 a repeat still waits for a laser-off move, the rule
// the output cursor applies to air changes (OR-1), in case vendor firmware
// drains its planner on it.
//
// Each move is costed as if it started and ended at rest under the profile's
// acceleration and at no more than its maximum feed. That over-states the time,
// so on a machine at least that quick two repeats are never further apart than
// the interval; the firmware's shortest reported standby is four times longer.
// https://github.com/gnea/grbl/blob/master/grbl/gcode.c
// https://github.com/grblHAL/core/blob/master/gcode.c

import { scanGcodeWords, stripInlineComments, type GcodeWordMatch } from '../gcode';
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
  rapid: boolean;
  feedMmPerMin: number;
  power: number;
  x: number;
  y: number;
  z: number;
  /** The last move may have left an M3 beam lit, so a drain now would mark. */
  lit: boolean;
  /** Upper bound on motion time since the air command was last written. */
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
    rapid: true,
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
  if (cursor.elapsed < intervalSeconds || !hasAxisWord(words)) return false;
  return !(cursor.spindle === 'M3' && cursor.lit);
}

function hasAxisWord(words: ReadonlyArray<GcodeWordMatch>): boolean {
  return words.some(({ letter }) => letter === 'X' || letter === 'Y' || letter === 'Z');
}

function applyBlock(
  cursor: KeepAliveCursor,
  words: ReadonlyArray<GcodeWordMatch>,
  limits: AirKeepAliveLimits,
): void {
  for (const word of words) applyWord(cursor, word, words);
  const target = axisTarget(cursor, words);
  if (target === null) return;
  const distance = Math.hypot(target.x - cursor.x, target.y - cursor.y, target.z - cursor.z);
  const feed = cursor.rapid
    ? limits.maxFeedMmPerMin
    : cappedFeed(cursor.feedMmPerMin, limits.maxFeedMmPerMin);
  cursor.elapsed += moveSecondsUpperBound(distance, feed / 60, limits.accelMmPerSec2);
  cursor.x = target.x;
  cursor.y = target.y;
  cursor.z = target.z;
  cursor.lit = !cursor.rapid && cursor.power > 0 && cursor.spindle !== 'off';
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
  return target;
}

function applyGWord(
  cursor: KeepAliveCursor,
  value: number,
  words: ReadonlyArray<GcodeWordMatch>,
): void {
  if (value === 0) cursor.rapid = true;
  else if (value === 1 || value === 2 || value === 3) cursor.rapid = false;
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
