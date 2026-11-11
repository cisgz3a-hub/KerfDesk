// Writes planned Moshi moves into program bytes (ADR-705), the way MeerK40t's
// MoshiDriver drives its builder (meerk40t/moshi/driver.py at d511944e):
// `_start_program_mode` / `_start_raster_mode` (L717-762) write the speed
// header, Set Offset at the first position and a move there; `_goto_absolute`
// (L817-845) writes each move; `commit` (L789-796) terminates the program.
// `home` (L481-493) is itself a program: speed 40, offset 0,0, move to 0,0.

import { MoshiProgram } from './moshi-program';
import type { MoshiBounds, MoshiStep } from './moshi-units';

/** MeerK40t's home program speed (driver.py L489, device.py `rapid_speed`). */
export const MOSHI_HOME_SPEED_MM_S = 40;

/** A vector program: cut speed and travel speed are the same, as MeerK40t
 *  passes them ("Passing same speed so PPI isn't crazy", driver.py L736). */
export function writeVectorProgram(steps: ReadonlyArray<MoshiStep>, speedMmS: number): Uint8Array {
  const first = steps[0];
  if (first === undefined) throw new Error('Moshi vector program: no moves');
  const program = new MoshiProgram();
  program.vectorSpeed(speedMmS, speedMmS);
  program.setOffset(first.x, first.y);
  program.moveAbs(first.x, first.y);
  for (const step of steps.slice(1)) {
    if (step.cut) program.cutAbs(step.x, step.y);
    else program.moveAbs(step.x, step.y);
  }
  return program.terminate();
}

/** A raster program: Set Offset at the upper-left of the moves (MeerK40t's
 *  PLOT_LEFT_UPPER, driver.py L420-422), a move to the first position, then
 *  one-axis moves and cuts. Cuts are horizontal only. */
export function writeRasterProgram(
  steps: ReadonlyArray<MoshiStep>,
  speedMmS: number,
  bounds: MoshiBounds,
): Uint8Array {
  const first = steps[0];
  if (first === undefined) throw new Error('Moshi raster program: no moves');
  const program = new MoshiProgram();
  program.rasterSpeed(speedMmS);
  program.setOffset(bounds.minX, bounds.minY);
  program.moveAbs(first.x, first.y);
  let at = first;
  for (const step of steps.slice(1)) {
    if (step.y === at.y) {
      if (step.cut) program.cutHorizontal(step.x);
      else program.moveHorizontal(step.x);
    } else if (step.x === at.x && !step.cut) {
      program.moveVertical(step.y);
    } else if (!step.cut) {
      program.moveAbs(step.x, step.y);
    } else {
      throw new Error('Moshi raster program: a cut must be horizontal');
    }
    at = step;
  }
  return program.terminate();
}

/** MeerK40t's home: a move to absolute 0,0 at 40 mm/s. A Moshiboard has no
 *  homing cycle a host can command; this is the board's own zero. */
export function writeHomeProgram(): Uint8Array {
  const program = new MoshiProgram();
  program.vectorSpeed(MOSHI_HOME_SPEED_MM_S, MOSHI_HOME_SPEED_MM_S);
  program.setOffset(0, 0);
  program.moveAbs(0, 0);
  return program.terminate();
}

/** The Frame: a vector program of laser-off moves around the footprint. */
export function writeFrameProgram(bounds: MoshiBounds, speedMmS: number): Uint8Array {
  const { minX, minY, maxX, maxY } = bounds;
  const corners: MoshiStep[] = [
    { x: minX, y: minY, cut: false },
    { x: maxX, y: minY, cut: false },
    { x: maxX, y: maxY, cut: false },
    { x: minX, y: maxY, cut: false },
    { x: minX, y: minY, cut: false },
  ];
  return writeVectorProgram(corners, speedMmS);
}
