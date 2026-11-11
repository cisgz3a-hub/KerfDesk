// LHYMicro-GL decoder for tests and the Lihuiyu simulator (ADR-703): the
// state diagram MeerK40t's MIT parser.py runs (meerk40t/lihuiyu/parser.py at
// d511944e, L128-427), reimplemented to report every executed move with the
// beam state it ran at. It reads payloads as the board does: an "AT1" payload
// sets M3 PWM power, every other one runs through the parser. Two P's in one
// payload home the head (parser.py L389-399), so the pause flag is per payload.

import { lhyPayloads } from '../../core/controllers/lihuiyu/lhy-packet';

export type LhyDecodedMove = {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly laser: boolean;
  /** Program (compact) mode; false for a rapid move. */
  readonly program: boolean;
};

const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;
const LOWER_A = 0x61;
const LOWER_Y = 0x79;

type Consumer = 'distance' | 'speed' | 'step' | 'mode' | 'power';

export class LhyDecoder {
  x = 0;
  y = 0;
  laser = false;
  homes = 0;
  readonly moves: LhyDecodedMove[] = [];
  readonly speedCodes: string[] = [];
  readonly pwmPowers: number[] = [];
  /** W<nnn> per-mille powers read from speed codes. */
  readonly speedCodePowers: number[] = [];
  private number = '';
  private consumer: Consumer = 'distance';
  private speedDigits = '';
  private distanceX = 0;
  private distanceY = 0;
  private left = false;
  private top = false;
  private xOn = false;
  private yOn = false;
  private smallJump = false;
  private returningCompact = true;
  private returningFinished = false;
  private mode: number | null = null;
  private rasterStep = 0;
  private pausedState = false;
  private compact = false;
  private finished = false;
  private horizontalMajor = false;

  /** Decodes a whole command stream (an .egv body) payload by payload. */
  writeStream(stream: Uint8Array): void {
    for (const { payload } of lhyPayloads(stream)) this.writePayload(payload);
  }

  writePayload(payload: Uint8Array): void {
    if (payload[0] === 0x41 && payload[1] === 0x54) {
      if (payload[2] === 0x31) this.pwmPowers.push((payload[3] ?? 0) * 254 + (payload[4] ?? 0));
      return;
    }
    this.pausedState = false;
    for (const byte of payload) this.process(byte);
  }

  /** In the finished state, where the board ignores everything until 'I'. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** The moves that ran with the beam on, collinear pieces joined. In program
   *  mode every letter, distance letters too, runs the pending distance first
   *  (parser.py L262-264), so one "zzzv" run decodes as several pieces. */
  burns(): ReadonlyArray<LhyDecodedMove> {
    return joinCollinear(this.moves).filter((move) => move.laser);
  }

  private process(byte: number): void {
    const c = String.fromCharCode(byte);
    if (c === 'I') this.reset();
    if (this.finished) return;
    if (byte >= DIGIT_0 && byte <= DIGIT_9) {
      this.digit(c);
      return;
    }
    if (this.consumer === 'speed') this.closeSpeedCode();
    this.consumer = 'distance';
    this.number = '';
    if (this.compact) this.executeDistance();
    if (c === '|' || c === 'z' || (byte >= LOWER_A && byte <= LOWER_Y))
      this.letterDistance(c, byte);
    else this.command(c);
  }

  private reset(): void {
    this.finished = false;
    this.compact = false;
    this.pausedState = false;
    this.distanceX = 0;
    this.distanceY = 0;
  }

  private digit(c: string): void {
    if (this.consumer === 'speed') {
      this.speedDigits += c;
      return;
    }
    this.number += c;
    const width = this.consumer === 'mode' ? 1 : 3;
    if (this.number.length < width) return;
    const value = Number.parseInt(this.number, 10);
    this.number = '';
    if (this.consumer === 'distance') this.appendDistance(value);
    else if (this.consumer === 'step') this.rasterStep = value;
    else if (this.consumer === 'mode') this.mode = value;
    else this.speedCodePowers.push(value);
    this.consumer = 'distance';
  }

  private closeSpeedCode(): void {
    this.speedCodes.push(`CV${this.speedDigits}`);
    this.speedDigits = '';
  }

  private letterDistance(c: string, byte: number): void {
    if (c === '|') {
      this.appendDistance(25);
      this.smallJump = true;
    } else if (c === 'z') {
      this.appendDistance(this.smallJump ? 26 : 255);
      this.smallJump = false;
    } else {
      this.appendDistance(byte + 1 - LOWER_A);
      this.smallJump = false;
    }
  }

  private appendDistance(amount: number): void {
    if (this.xOn) this.distanceX += amount;
    if (this.yOn) this.distanceY += amount;
  }

  private executeDistance(): void {
    if (this.distanceX === 0 && this.distanceY === 0) return;
    const from = { x: this.x, y: this.y };
    this.x += this.left ? -this.distanceX : this.distanceX;
    this.y += this.top ? -this.distanceY : this.distanceY;
    this.distanceX = 0;
    this.distanceY = 0;
    this.moves.push({
      from,
      to: { x: this.x, y: this.y },
      laser: this.laser,
      program: this.compact,
    });
  }

  private command(c: string): void {
    switch (c) {
      case 'B':
      case 'T':
        this.horizontalDirection(c === 'T');
        return;
      case 'R':
      case 'L':
        this.verticalDirection(c === 'L');
        return;
      case 'U':
      case 'D':
        this.laser = c === 'D';
        return;
      case 'M':
        this.xOn = true;
        this.yOn = true;
        return;
      default:
        this.modeCommand(c);
    }
  }

  private horizontalDirection(left: boolean): void {
    if (this.left !== left && this.horizontalMajor && this.rasterStep && this.compact) {
      this.distanceY += this.rasterStep;
    }
    this.left = left;
    this.xOn = true;
    this.yOn = false;
  }

  private verticalDirection(top: boolean): void {
    if (this.top !== top && !this.horizontalMajor && this.rasterStep && this.compact) {
      this.distanceX += this.rasterStep;
    }
    this.top = top;
    this.xOn = false;
    this.yOn = true;
  }

  private modeCommand(c: string): void {
    switch (c) {
      case 'F':
        this.returningCompact = false;
        this.returningFinished = true;
        return;
      case '@':
        this.returningFinished = false;
        this.returningCompact = false;
        return;
      case 'V':
        this.rasterStep = 0;
        this.speedDigits = '';
        this.consumer = 'speed';
        return;
      case 'G':
        this.consumer = 'step';
        return;
      case 'W':
        this.consumer = 'power';
        return;
      case 'S':
        this.laser = false;
        this.executeDistance();
        this.mode = null;
        this.consumer = 'mode';
        return;
      default:
        this.stateCommand(c);
    }
  }

  private stateCommand(c: string): void {
    if (c === 'E') this.execute();
    else if (c === 'P') this.pause();
    else if (c === 'N') {
      this.executeDistance();
      this.laser = false;
      this.compact = false;
    }
  }

  private execute(): void {
    if (this.mode === null) {
      if (this.returningCompact) this.compact = true;
      if (this.returningFinished) this.finished = true;
      if (this.horizontalMajor) {
        this.left = !this.left;
        this.xOn = true;
        this.yOn = false;
      } else {
        this.top = !this.top;
        this.xOn = false;
        this.yOn = true;
      }
    } else if (this.mode === 1) {
      this.compact = true;
      this.horizontalMajor = this.xOn;
    } else if (this.mode === 2) {
      this.compact = true;
    }
    this.returningFinished = false;
    this.returningCompact = true;
    this.laser = false;
  }

  private pause(): void {
    this.laser = false;
    if (!this.pausedState) {
      this.executeDistance();
      this.pausedState = true;
      return;
    }
    this.x = 0;
    this.y = 0;
    this.distanceX = 0;
    this.distanceY = 0;
    this.finished = true;
    this.pausedState = false;
    this.homes += 1;
  }
}

/** Joins consecutive moves that continue in the same direction with the same beam. */
export function joinCollinear(moves: ReadonlyArray<LhyDecodedMove>): LhyDecodedMove[] {
  const joined: LhyDecodedMove[] = [];
  for (const move of moves) {
    const last = joined[joined.length - 1];
    if (last !== undefined && continues(last, move)) {
      joined[joined.length - 1] = { ...last, to: move.to };
    } else {
      joined.push(move);
    }
  }
  return joined;
}

function continues(a: LhyDecodedMove, b: LhyDecodedMove): boolean {
  if (a.laser !== b.laser || a.program !== b.program) return false;
  if (a.to.x !== b.from.x || a.to.y !== b.from.y) return false;
  const ax = a.to.x - a.from.x;
  const ay = a.to.y - a.from.y;
  const bx = b.to.x - b.from.x;
  const by = b.to.y - b.from.y;
  return ax * by - ay * bx === 0 && ax * bx + ay * by > 0;
}

/** The command stream of an .egv file: everything after the header, which
 *  ends at the fifth '%' after the third newline (parser.py remove_header). */
export function egvBody(file: Uint8Array): Uint8Array {
  let lines = 0;
  let flags = 0;
  for (let i = 0; i < file.length; i += 1) {
    if (file[i] === 0x0a) lines += 1;
    else if (file[i] === 0x25) flags += 1;
    if (lines >= 3 && flags >= 5) return file.subarray(i + 1);
  }
  return new Uint8Array(0);
}
