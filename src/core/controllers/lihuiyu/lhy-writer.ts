// LHYMicro-GL command writer (ADR-703): the state machine MeerK40t's MIT
// driver.py runs (meerk40t/lihuiyu/driver.py at d511944e), reimplemented for
// the moves this app plans. Coordinates are 1/1000 in steps; +x is right
// ('B', 'T' left) and +y is toward the front ('R' bottom, 'L' top), so a
// rear-left machine origin maps straight onto them.
//
// - Rapid moves: "I", one direction letter and distance per axis, "S1P\n"
//   (_move_in_rapid_mode, L1294-1304, with the rail auto-lock default on).
// - Program mode: "I", the speed code, "N", the declared directions, "S1E"
//   (finished_mode + program_mode, L514-672). Moves inside it are Bresenham
//   lines grouped into orthogonal and diagonal runs (_goto_relative L1306-1346,
//   _goto_octent L1508-1547, _goto_xy L1469-1506); 'D'/'U' switch the beam
//   (laser_on/laser_off L432-477). "FNSE-\n" leaves it and asks the host to
//   wait for the board's finish (rapid_mode L491-512).
// - Home: "IPP\n" (home L674-696). Power on an M3 with hardware PWM: an "AT1"
//   packet with the per-mille value as two bytes (send_at_pwm_code L479-489).

import { encodeLhyDistance } from './lhy-distance';

export type LhyDirections = {
  readonly leftward: boolean;
  readonly topward: boolean;
  readonly horizontalMajor: boolean;
};

type Mode = 'rapid' | 'program';

const NEWLINE = 0x0a;
/** [backward, forward] letters per axis: x left/right, y top/bottom. */
const LETTERS = { x: ['T', 'B'], y: ['L', 'R'] } as const;

export class LhyWriter {
  private readonly bytes: number[] = [];
  private mode: Mode = 'rapid';
  private speedCode: string | null = null;
  private laser = false;
  private leftward = false;
  private topward = false;
  private xEngaged = false;
  private yEngaged = false;
  x: number;
  y: number;

  constructor(start: { readonly x: number; readonly y: number } = { x: 0, y: 0 }) {
    this.x = start.x;
    this.y = start.y;
  }

  /** The command stream written so far. */
  stream(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  get inProgram(): boolean {
    return this.mode === 'program';
  }

  /** A laser-off move in rapid mode, leaving program mode first. */
  rapidMove(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.leaveProgram();
    this.text('I');
    this.gotoXy(dx, dy, null);
    this.text('S1P\n');
  }

  /** Enters program mode at `speedCode`, or stays when already there at it. */
  enterProgram(speedCode: string, directions: LhyDirections): void {
    if (this.mode === 'program' && this.speedCode === speedCode) return;
    this.leaveProgram();
    this.leftward = directions.leftward;
    this.topward = directions.topward;
    this.text(`I${speedCode}N`);
    const xDir = this.leftward ? 'T' : 'B';
    const yDir = this.topward ? 'L' : 'R';
    this.xEngaged = directions.horizontalMajor;
    this.yEngaged = !directions.horizontalMajor;
    this.text(directions.horizontalMajor ? yDir + xDir : xDir + yDir);
    this.text('S1E');
    this.mode = 'program';
    this.speedCode = speedCode;
    this.laser = false;
  }

  /** "FNSE-\n": back to rapid mode once the board has finished the program. */
  leaveProgram(): void {
    if (this.mode !== 'program') return;
    this.text('FNSE-\n');
    this.mode = 'rapid';
    this.speedCode = null;
    this.laser = false;
  }

  /** A program-mode move with the beam on (`burn`) or off. */
  programMove(dx: number, dy: number, burn: boolean): void {
    if (this.mode !== 'program') throw new Error('LHY program move outside program mode.');
    let runX = 0;
    let runY = 0;
    let runLength = 0;
    for (const [stepX, stepY] of bresenhamSteps(dx, dy)) {
      if (runLength > 0 && (stepX !== runX || stepY !== runY)) {
        this.octant(runX * runLength, runY * runLength, burn);
        runLength = 0;
      }
      runX = stepX;
      runY = stepY;
      runLength += 1;
    }
    if (runLength > 0) this.octant(runX * runLength, runY * runLength, burn);
  }

  home(): void {
    this.leaveProgram();
    this.text('IPP\n');
    this.x = 0;
    this.y = 0;
    this.leftward = false;
    this.topward = false;
    this.xEngaged = false;
    this.yEngaged = false;
  }

  /** M3 hardware PWM power, 0..1000 per mille, as an "AT1" packet. */
  pwmPower(perMille: number): void {
    this.leaveProgram();
    const last = this.bytes[this.bytes.length - 1];
    if (last !== undefined && last !== NEWLINE) this.bytes.push(NEWLINE);
    this.bytes.push(0x41, 0x54, 0x31, ...lhyPwmBytes(perMille), NEWLINE);
  }

  private octant(dx: number, dy: number, burn: boolean): void {
    if (Math.abs(dx) !== Math.abs(dy)) {
      this.gotoXy(dx, dy, burn);
      return;
    }
    this.xEngaged = true;
    this.yEngaged = true;
    if (dx > 0 && this.leftward) this.direction('B');
    if (dx < 0 && !this.leftward) this.direction('T');
    if (dy > 0 && this.topward) this.direction('R');
    if (dy < 0 && !this.topward) this.direction('L');
    this.x += dx;
    this.y += dy;
    this.text('M');
    this.beam(burn);
    this.text(encodeLhyDistance(Math.abs(dy)));
  }

  private gotoXy(dx: number, dy: number, burn: boolean | null): void {
    if (dx !== 0) this.axisMove('x', dx, burn);
    if (dy !== 0) this.axisMove('y', dy, burn);
  }

  /** One orthogonal move. In program mode the direction letter is written
   *  only when the board is not already engaged on this axis that way. */
  private axisMove(axis: 'x' | 'y', delta: number, burn: boolean | null): void {
    const forward = delta > 0;
    if (this.mode !== 'program' || !this.engaged(axis, forward)) {
      this.direction(LETTERS[axis][forward ? 1 : 0]);
    }
    if (axis === 'x') this.x += delta;
    else this.y += delta;
    this.xEngaged = axis === 'x';
    this.yEngaged = axis === 'y';
    if (burn !== null) this.beam(burn);
    this.text(encodeLhyDistance(Math.abs(delta)));
  }

  /** Moving on `axis` alone, already heading forward (+) or back (−). */
  private engaged(axis: 'x' | 'y', forward: boolean): boolean {
    if (axis === 'x') return this.xEngaged && !this.yEngaged && this.leftward === !forward;
    return !this.xEngaged && this.yEngaged && this.topward === !forward;
  }

  private direction(letter: 'B' | 'T' | 'R' | 'L'): void {
    if (letter === 'B' || letter === 'T') this.leftward = letter === 'T';
    else this.topward = letter === 'L';
    this.text(letter);
  }

  private beam(on: boolean): void {
    if (on === this.laser) return;
    this.laser = on;
    this.text(on ? 'D' : 'U');
  }

  private text(value: string): void {
    for (let i = 0; i < value.length; i += 1) this.bytes.push(value.charCodeAt(i));
  }
}

/** The two AT1 bytes for a per-mille power: value / 254 and value % 254.
 *  A low byte of 10 would read as a newline and cut the packet short, so it
 *  becomes 11 (0.1 % more). */
export function lhyPwmBytes(perMille: number): readonly [number, number] {
  let value = Math.min(1000, Math.max(0, Math.round(perMille)));
  if (value % 254 === NEWLINE) value += 1;
  return [Math.floor(value / 254), value % 254];
}

/** Unit steps of the Zingl-Bresenham line from (0, 0) to (dx, dy)
 *  (meerk40t/tools/zinglplotter.py plot_line). */
function* bresenhamSteps(dx: number, dy: number): Generator<readonly [number, number]> {
  const ax = Math.abs(dx);
  const ay = -Math.abs(dy);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  let err = ax + ay;
  let x = 0;
  let y = 0;
  while (x !== dx || y !== dy) {
    const e2 = 2 * err;
    let stepX = 0;
    let stepY = 0;
    if (e2 >= ay) {
      err += ay;
      stepX = sx;
    }
    if (e2 <= ax) {
      err += ax;
      stepY = sy;
    }
    x += stepX;
    y += stepY;
    yield [stepX, stepY];
  }
}
