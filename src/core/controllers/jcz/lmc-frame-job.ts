// The galvo Frame (ADR-704): the red pointer light traces the job's footprint.
// It is MeerK40t's light mode (balormk/controller.py L534-561) and live-light
// trace (livelightjob.py L218-267 at d511944e): the program port bit stays
// off, the light bit switches the pointer, and every move is a Jump at the
// red-light speed with the pointer's jump delay. It writes no Mark, no Laser
// On Point and no power, frequency or pulse word: the laser source is never
// asked to fire. MeerK40t loops the trace until stopped; this build writes a
// fixed number of loops lasting about FRAME_TRACE_SECONDS, so the Frame ends
// on its own and a completed Frame can gate Start (non-negotiable 21, ADR-565).

import type { GalvoSetup } from '../../devices/galvo-setup';
import { galvoUnitsPerMm } from './galvo-field';
import { lmcFootprintCorners, type LmcFootprint } from './lmc-footprint';
import { LmcProgramWriter } from './lmc-program-writer';
import { lmcSpeedWord } from './lmc-units';

/** How long the pointer traces the outline, in seconds. */
export const FRAME_TRACE_SECONDS = 5;
const MAX_FRAME_LOOPS = 500;
/** The pointer's jump delay, µs (device.py redlight_delay_dark/light default 1). */
const RED_LIGHT_JUMP_DELAY_US = 1;

export type LmcFrameProgram = {
  readonly lists: ReadonlyArray<Uint8Array>;
  readonly loops: number;
};

export function encodeLmcFrameJob(
  footprint: LmcFootprint,
  setup: Pick<GalvoSetup, 'redLightSpeedMmPerSec' | 'redLightPortBit'>,
  fieldMm: number,
): LmcFrameProgram | null {
  const speedWord = lmcSpeedWord(setup.redLightSpeedMmPerSec, fieldMm);
  if (speedWord === null) return null;
  const lightBits = 1 << setup.redLightPortBit;
  const corners = lmcFootprintCorners(footprint);
  const writer = new LmcProgramWriter();
  writer.ready();
  writer.writePort(0);
  writer.jumpSpeed(speedWord);
  writer.jumpDelay(RED_LIGHT_JUMP_DELAY_US);
  const [start, ...outline] = corners;
  if (start === undefined) return null;
  writer.jump(start);
  writer.writePort(lightBits);
  const loops = frameLoops(footprint, setup.redLightSpeedMmPerSec, fieldMm);
  if (loops === 0) {
    // A footprint of one point: hold the pointer on it instead.
    writer.dwellUs(FRAME_TRACE_SECONDS * 1_000_000);
  }
  for (let loop = 0; loop < loops; loop += 1) {
    for (const corner of outline) writer.jump(corner);
  }
  writer.writePort(0);
  writer.endOfList();
  return { lists: writer.finish(), loops: Math.max(1, loops) };
}

/** Loops lasting about FRAME_TRACE_SECONDS; 0 for a single-point footprint. */
export function frameLoops(
  footprint: LmcFootprint,
  speedMmPerSec: number,
  fieldMm: number,
): number {
  const perimeterUnits =
    2 * (footprint.maxGx - footprint.minGx) + 2 * (footprint.maxGy - footprint.minGy);
  if (perimeterUnits === 0) return 0;
  const loopSeconds = perimeterUnits / galvoUnitsPerMm(fieldMm) / speedMmPerSec;
  return Math.min(MAX_FRAME_LOOPS, Math.max(1, Math.ceil(FRAME_TRACE_SECONDS / loopSeconds)));
}
