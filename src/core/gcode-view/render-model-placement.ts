// render-model-placement — which moves a program places in the work
// coordinates it starts in (ADR-630 Amendment 1). An external run's Frame
// traces that outline, so a move the program states in other coordinates, or
// that ends where the program does not say, must not become a framed corner.
// Built only with `boundsFromStart`; the Inspector's own drawing keeps its
// reading of these words.
//
// What stock GRBL does with them (gcode.c):
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c
//   - G10, G28, G30 and G92 claim the line's axis words as their own data, so
//     they are not a move; G28.1, G30.1 and G92.1 do not, and their axis words
//     are an ordinary move in the current motion mode.
//   - G53 moves in machine coordinates, on its own line only.
//   - G38.2 to G38.5 are motion modes: they last until another motion command,
//     and each probe stops where it touches.
//   - G10 L2 and L20 rewrite a work coordinate system (P0 the active one,
//     P1 to P6 G54 to G59); L20 makes the current position the given values.
//     G92 makes the current position the given values in every system; G92.1
//     clears that offset, which the reported origin may have held.
//   - M2 and M30 put G54 and G1 back after their block.

import type { GcodeWordMatch } from '../gcode';
import type { ProgramBoundsTracker } from './program-bounds';
import { roundToTenth } from '../util/rounding';

export type PlacedAxis = 'X' | 'Y' | 'Z';

export type LinePlacement = {
  /** 'work': the axis words move in the coordinates the program started in.
   * 'unplaced': they move somewhere those coordinates do not state (G53, a
   * probe, G30's stored position). 'none': they set an origin and move nothing. */
  readonly motion: 'work' | 'unplaced' | 'none';
  /** Axes whose origin the line moves away from the one the program started with. */
  readonly displaced: ReadonlyArray<PlacedAxis>;
  /** Axes the line leaves at a position the program does not state. */
  readonly unknownAfter: ReadonlyArray<PlacedAxis>;
  /** Axes whose current position (program coordinates, mm) the line now states. */
  readonly declared: ReadonlyArray<readonly [PlacedAxis, number]>;
  /** The program now runs in another work coordinate system than G54. */
  readonly foreign: boolean;
};

const AXES: ReadonlyArray<PlacedAxis> = ['X', 'Y', 'Z'];
const START_WCS = 54;
const PROBES: ReadonlyArray<number> = [38.2, 38.3, 38.4, 38.5];
const OTHER_MOTION: ReadonlyArray<number> = [0, 1, 2, 3, 73, 80, 81, 82, 83];
const G92_CLEARS: ReadonlyArray<number> = [92.1, 92.2, 92.3];

type Line = {
  readonly g: ReadonlyArray<number>;
  readonly words: ReadonlyArray<GcodeWordMatch>;
  readonly named: ReadonlyArray<PlacedAxis>;
  readonly unitScale: number;
};

/** Applies what a line does before its motion: the system it runs in, the
 * origins it moves, and, for an origin write, which moves nothing, the
 * position its axes now have in the program's coordinates. */
export function placeBeforeMotion(
  program: Pick<ProgramBoundsTracker, 'setForeign' | 'displace'>,
  position: { x: number; y: number; z: number },
  placement: LinePlacement,
): void {
  program.setForeign(placement.foreign);
  program.displace(placement.displaced);
  for (const [axis, value] of placement.declared) {
    if (axis === 'X') position.x = value;
    else if (axis === 'Y') position.y = value;
    else position.z = value;
  }
}

/** Reads each line in order; call it after the line's words have applied. */
export function createPlacementReader(): (
  words: ReadonlyArray<GcodeWordMatch>,
  unitScale: number,
) => LinePlacement {
  let wcs = START_WCS;
  let probing = false;
  let endingProgram = false;
  return (words, unitScale) => {
    if (endingProgram) {
      wcs = START_WCS;
      probing = false;
      endingProgram = false;
    }
    const g = words.filter((word) => word.letter === 'G').map((word) => roundToTenth(word.value));
    for (const code of g) {
      if (PROBES.includes(code)) probing = true;
      else if (OTHER_MOTION.includes(code)) probing = false;
      else if (Number.isInteger(code) && code >= START_WCS && code <= 59) wcs = code;
    }
    endingProgram = words.some(
      (word) => word.letter === 'M' && (word.value === 2 || word.value === 30),
    );
    const line: Line = { g, words, named: AXES.filter((axis) => has(words, axis)), unitScale };
    return { ...placementOf(line, wcs, probing), foreign: wcs !== START_WCS };
  };
}

function placementOf(line: Line, wcs: number, probing: boolean): Omit<LinePlacement, 'foreign'> {
  const { g, named } = line;
  if (g.includes(10)) return offsetWrite(line, wcs);
  if (g.includes(92)) {
    return { motion: 'none', displaced: named, unknownAfter: [], declared: declared(line) };
  }
  const displaced = g.some((code) => G92_CLEARS.includes(code)) ? AXES : [];
  if (g.includes(30)) {
    return {
      motion: 'unplaced',
      displaced,
      unknownAfter: named.length === 0 ? AXES : named,
      declared: [],
    };
  }
  const unplaced = g.includes(53) || probing;
  return {
    motion: unplaced ? 'unplaced' : 'work',
    displaced,
    unknownAfter: unplaced ? named : [],
    declared: [],
  };
}

// G10 L2/L20 Pn: n 0 is the active system, 1 to 6 are G54 to G59. Only a write
// to G54 moves the outline's origin; any other system is already left out.
function offsetWrite(line: Line, wcs: number): Omit<LinePlacement, 'foreign'> {
  const mode = wordValue(line.words, 'L');
  const p = wordValue(line.words, 'P') ?? 0;
  const target = p === 0 ? wcs : START_WCS - 1 + p;
  const writes = mode === 2 || mode === 20;
  return {
    motion: 'none',
    displaced: writes && target === START_WCS ? line.named : [],
    unknownAfter: [],
    declared: mode === 20 && target === wcs ? declared(line) : [],
  };
}

function declared(line: Line): ReadonlyArray<readonly [PlacedAxis, number]> {
  return line.named.map(
    (axis) => [axis, (wordValue(line.words, axis) ?? 0) * line.unitScale] as const,
  );
}

function has(words: ReadonlyArray<GcodeWordMatch>, letter: string): boolean {
  return words.some((word) => word.letter === letter);
}

function wordValue(words: ReadonlyArray<GcodeWordMatch>, letter: string): number | null {
  let value: number | null = null;
  for (const word of words) if (word.letter === letter) value = word.value;
  return value;
}
