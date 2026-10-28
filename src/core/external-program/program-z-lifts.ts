// program-z-lifts — the highest Z an external program moves to, for the Run
// review's check against the top of Z travel (ADR-491 Amendment 3). In the
// work coordinates the program starts in it is the top of the Frame's own
// outline: the model is built with `boundsFromStart`, so moves the program
// places elsewhere are left out. A G53 move names a machine position instead,
// which that outline leaves out, so its Z is read from the words. In stock
// GRBL a G53 move applies to its own block only, is never relative, and reads
// in the units in effect (gcode.c):
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c

import type { GcodeRenderModel } from '../gcode-view';
import { scanGcodeWords } from '../gcode/word-scan';

const MM_PER_INCH = 25.4;

export type ExternalProgramZLifts = {
  /** Highest work Z (mm) of the motion placed in the start coordinates; null when none is. */
  readonly workMaxMm: number | null;
  /** Highest machine Z (mm) a G53 move names; null when no G53 move sets Z. */
  readonly machineMaxMm: number | null;
};

/** `gcode` is the program the review reads, comment-free as sent. */
export function externalProgramZLifts(
  gcode: string,
  model: Pick<GcodeRenderModel, 'stats'>,
): ExternalProgramZLifts {
  const bounds = model.stats.programBounds;
  return {
    workMaxMm: bounds !== null && Number.isFinite(bounds.maxZ) ? bounds.maxZ : null,
    machineMaxMm: highestMachineZ(gcode),
  };
}

function highestMachineZ(gcode: string): number | null {
  let mmPerUnit = 1;
  let highest: number | null = null;
  for (const line of gcode.split('\n')) {
    const words = scanGcodeWords(line);
    const codes = words.filter((word) => word.letter === 'G').map((word) => tenths(word.value));
    // A block's units apply before its motion.
    if (codes.includes(200)) mmPerUnit = MM_PER_INCH;
    else if (codes.includes(210)) mmPerUnit = 1;
    if (!codes.includes(530)) continue;
    const z = words.find((word) => word.letter === 'Z')?.value;
    if (z === undefined || !Number.isFinite(z)) continue;
    highest = Math.max(highest ?? -Infinity, z * mmPerUnit);
  }
  return highest;
}

function tenths(value: number): number {
  return Math.round(value * 10);
}
