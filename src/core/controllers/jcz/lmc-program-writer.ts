// Writes one LMC list program (ADR-704), as MeerK40t's GalvoController list
// methods do (balormk/controller.py at d511944e): a setting is written only
// when its word changes (L1208-1300, L1425-1435), a jump or mark to where the
// beam already is is skipped (L714-732), and every jump and mark carries an
// angle word of 0 and the straight-line distance from the last position
// (L1147-1206). The beam is assumed at the field centre when the program
// starts, as MeerK40t's controller assumes (L234-235); the first move is
// always written, since the beam may be anywhere.

import type { GalvoPoint } from './galvo-field';
import {
  LIST_DELAY_TIME,
  LIST_END_OF_LIST,
  LIST_JUMP_DELAY,
  LIST_JUMP_SPEED,
  LIST_JUMP_TO,
  LIST_LASER_OFF_DELAY,
  LIST_LASER_ON_DELAY,
  LIST_MARK_SPEED,
  LIST_MARK_TO,
  LIST_POLYGON_DELAY,
  LIST_READY_MARK,
  LIST_WRITE_PORT,
  LMC_GALVO_CENTRE,
} from './lmc-opcodes';
import { LmcListWriter, type LmcParams } from './lmc-packets';
import { lmcDistanceWord, lmcPolygonDelayWord, lmcSignedDelayWords } from './lmc-units';

export type LmcStep = { readonly kind: 'jump' | 'mark' } & GalvoPoint;

export class LmcProgramWriter {
  private readonly list = new LmcListWriter();
  // The last word written per opcode, for the settings that are deduplicated.
  private readonly lastWords = new Map<number, string>();
  private at: GalvoPoint | null = null;
  private readonly moves: LmcStep[] = [];

  /** List Ready Mark: the first command of every program (controller.py L1464-1470). */
  ready(): void {
    this.list.write(LIST_READY_MARK);
  }

  /** The output port bits, written unconditionally (controller.py L1302-1308). */
  writePort(bits: number): void {
    this.list.write(LIST_WRITE_PORT, bits & 0xffff);
  }

  /** A dwell in 10 µs units. */
  delayTime(units: number): void {
    this.list.write(LIST_DELAY_TIME, Math.min(0xffff, Math.abs(Math.trunc(units))));
  }

  /** A dwell in µs, split into DelayTime words of at most 0xFFFF × 10 µs. */
  dwellUs(delayUs: number): void {
    let remaining = Math.abs(Math.trunc(delayUs / 10));
    while (remaining > 0) {
      const units = Math.min(0xffff, remaining);
      this.delayTime(units);
      remaining -= units;
    }
  }

  /** A setting written only when its words differ from the last ones. */
  setting(opcode: number, ...params: LmcParams): void {
    const key = params.join(',');
    if (this.lastWords.get(opcode) === key) return;
    this.lastWords.set(opcode, key);
    this.list.write(opcode, ...params);
  }

  jumpSpeed(word: number): void {
    this.setting(LIST_JUMP_SPEED, word);
  }

  markSpeed(word: number): void {
    this.setting(LIST_MARK_SPEED, word);
  }

  jumpDelay(delayUs: number): void {
    this.setting(LIST_JUMP_DELAY, ...lmcSignedDelayWords(delayUs));
  }

  laserOnDelay(delayUs: number): void {
    this.setting(LIST_LASER_ON_DELAY, ...lmcSignedDelayWords(delayUs));
  }

  laserOffDelay(delayUs: number): void {
    this.setting(LIST_LASER_OFF_DELAY, ...lmcSignedDelayWords(delayUs));
  }

  polygonDelay(delayUs: number): void {
    this.setting(LIST_POLYGON_DELAY, lmcPolygonDelayWord(delayUs));
  }

  /** Whether the beam is already at `point`. */
  isAt(point: GalvoPoint): boolean {
    return this.at !== null && this.at.gx === point.gx && this.at.gy === point.gy;
  }

  jump(point: GalvoPoint): void {
    this.move(LIST_JUMP_TO, 'jump', point);
  }

  mark(point: GalvoPoint): void {
    this.move(LIST_MARK_TO, 'mark', point);
  }

  endOfList(): void {
    this.list.write(LIST_END_OF_LIST);
  }

  /** Every jump and mark written, in order. */
  steps(): ReadonlyArray<LmcStep> {
    return this.moves;
  }

  finish(): ReadonlyArray<Uint8Array> {
    return this.list.finish();
  }

  private move(opcode: number, kind: LmcStep['kind'], point: GalvoPoint): void {
    if (this.isAt(point)) return;
    const from = this.at ?? { gx: LMC_GALVO_CENTRE, gy: LMC_GALVO_CENTRE };
    const distance = lmcDistanceWord(point.gx - from.gx, point.gy - from.gy);
    this.list.write(opcode, point.gx, point.gy, 0, distance);
    this.at = point;
    this.moves.push({ kind, ...point });
  }
}
