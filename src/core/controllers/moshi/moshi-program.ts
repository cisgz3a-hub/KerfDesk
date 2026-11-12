// One Moshiboard program (ADR-705): the bytes MeerK40t's MoshiBuilder writes,
// reimplemented from meerk40t/moshi/builder.py at d511944e (MIT). A program is
// a speed header (vector L376-397 or raster L399-412), one Set Offset (L414-
// 429), moves and cuts relative to that offset (L444-553) and seven
// termination bytes (L431-442). The board runs one program at a time
// (controller.py L597-666). Coordinates are int16 native units (mils, 1/1000
// inch: device.py L332 `View(..., dpi=1000.0)`). The stage order the
// builder asserts is enforced here as a thrown error, never a silent byte.
// Simulator-tested only, not qualified on hardware.

import {
  MOSHI_CUT_ABS,
  MOSHI_CUT_HORIZ,
  MOSHI_CUT_VERT,
  MOSHI_MOVE_ABS,
  MOSHI_MOVE_HORIZ,
  MOSHI_MOVE_VERT,
  MOSHI_RASTER_SPEED,
  MOSHI_SET_OFFSET,
  MOSHI_TERMINATION,
  MOSHI_VECTOR_SPEED,
  moshiCommandByte,
} from './moshi-swizzle';

export const MOSHI_INT16_MIN = -32768;
export const MOSHI_INT16_MAX = 32767;
/** Vector speeds are whole mm/s from 1 to 256 (builder.py L392-397). */
export const MOSHI_VECTOR_SPEED_MAX_MM_S = 256;

/** The vector speed the board runs for a requested mm/s: MeerK40t passes
 *  `int(speed)` and clamps to 1..256 (builder.py L392-397). */
export function moshiVectorSpeedMmS(speedMmS: number): number {
  return Math.min(MOSHI_VECTOR_SPEED_MAX_MM_S, Math.max(1, Math.trunc(speedMmS)));
}

/** The raster speed the board runs for a requested mm/s: one byte of whole
 *  cm/s, rounded, at least 1 (builder.py L399-412). */
export function moshiRasterSpeedCmS(speedMmS: number): number {
  return Math.max(1, Math.round(speedMmS / 10));
}

type Stage = 'empty' | 'speed' | 'offset' | 'moves' | 'terminated';

export type MoshiProgramMode = 'vector' | 'raster';

export class MoshiProgram {
  private readonly bytes: number[] = [];
  private stage: Stage = 'empty';
  private offsetX = 0;
  private offsetY = 0;
  mode: MoshiProgramMode | null = null;

  /** Vector header: cut speed and travel ("normal") speed in mm/s. MeerK40t
   *  clamps the cut speed to 1..256 and passes the travel speed as given,
   *  clamped only to a byte (L392-397, L346-354). */
  vectorSpeed(speedMmS: number, normalSpeedMmS: number): void {
    this.expect('empty', 'speed');
    this.mode = 'vector';
    const speed = moshiVectorSpeedMmS(speedMmS);
    this.bytes.push(moshiCommandByte(MOSHI_VECTOR_SPEED));
    this.uint8(speed - 1);
    this.uint8(Math.trunc(normalSpeedMmS) - 1);
  }

  /** Raster header: speed in cm/s, rounded, at least 1 (L399-412). */
  rasterSpeed(speedMmS: number): void {
    this.expect('empty', 'speed');
    this.mode = 'raster';
    const speedCmS = moshiRasterSpeedCmS(speedMmS);
    this.bytes.push(moshiCommandByte(MOSHI_RASTER_SPEED));
    this.uint8(speedCmS - 1);
  }

  /** Set Offset: an unknown int16 (always 0) then the absolute x, y every
   *  later coordinate is relative to (L414-429). */
  setOffset(x: number, y: number): void {
    this.expect('speed', 'offset');
    this.offsetX = x;
    this.offsetY = y;
    this.bytes.push(moshiCommandByte(MOSHI_SET_OFFSET));
    this.int16(0);
    this.int16(x);
    this.int16(y);
  }

  /** Laser-on line to absolute (x, y); negatives clamp to 0 first (L444-465).
   *  MeerK40t writes this one with swizzle-table column 1. */
  cutAbs(x: number, y: number): void {
    this.point(moshiCommandByte(MOSHI_CUT_ABS, 1), x, y);
  }

  /** Laser-off move to absolute (x, y) (L467-488). */
  moveAbs(x: number, y: number): void {
    this.point(moshiCommandByte(MOSHI_MOVE_ABS), x, y);
  }

  moveHorizontal(x: number): void {
    this.axis(MOSHI_MOVE_HORIZ, x - this.offsetX);
  }

  moveVertical(y: number): void {
    this.axis(MOSHI_MOVE_VERT, y - this.offsetY);
  }

  cutHorizontal(x: number): void {
    this.axis(MOSHI_CUT_HORIZ, x - this.offsetX);
  }

  cutVertical(y: number): void {
    this.axis(MOSHI_CUT_VERT, y - this.offsetY);
  }

  /** Seven termination bytes end the program (L431-442). */
  terminate(): Uint8Array {
    if (this.stage !== 'offset' && this.stage !== 'moves')
      throw new Error(`Moshi program: termination in stage ${this.stage}`);
    this.stage = 'terminated';
    const termination = moshiCommandByte(MOSHI_TERMINATION);
    for (let i = 0; i < 7; i += 1) this.bytes.push(termination);
    return Uint8Array.from(this.bytes);
  }

  private point(command: number, x: number, y: number): void {
    this.inMoves();
    const relX = Math.max(0, x) - this.offsetX;
    const relY = Math.max(0, y) - this.offsetY;
    this.bytes.push(command);
    this.int16(relX);
    this.int16(relY);
  }

  private axis(command: number, relative: number): void {
    this.inMoves();
    this.bytes.push(moshiCommandByte(command));
    this.int16(relative);
  }

  private inMoves(): void {
    if (this.stage !== 'offset' && this.stage !== 'moves')
      throw new Error(`Moshi program: move in stage ${this.stage}`);
    this.stage = 'moves';
  }

  private expect(from: Stage, to: Stage): void {
    if (this.stage !== from) throw new Error(`Moshi program: ${to} in stage ${this.stage}`);
    this.stage = to;
  }

  private uint8(value: number): void {
    this.bytes.push(Math.min(255, Math.max(0, value)));
  }

  /** Little-endian int16; out-of-range values were refused by the encoder,
   *  so the clamp MeerK40t applies (L356-364) never moves a coordinate. */
  private int16(value: number): void {
    const clamped = Math.min(MOSHI_INT16_MAX, Math.max(MOSHI_INT16_MIN, Math.trunc(value)));
    const word = clamped & 0xffff;
    this.bytes.push(word & 0xff, word >> 8);
  }
}
