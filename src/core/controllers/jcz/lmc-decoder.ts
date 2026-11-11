// Reads LMC list packets back into operations (ADR-704), the inverse of the
// program writer. The tests and the scripted board (src/__fixtures__/
// controllers/jcz-lmc-simulator.ts) decode what the encoder and Frame wrote
// and check the marks, jumps and settings against the job.

import { decodeLmcPacket, type LmcDecodedCommand } from './lmc-packets';
import {
  LIST_DELAY_TIME,
  LIST_END_OF_LIST,
  LIST_JUMP_TO,
  LIST_LASER_ON_POINT,
  LIST_MARK_TO,
  LIST_READY_MARK,
  LIST_WRITE_PORT,
  lmcListOpcodeName,
} from './lmc-opcodes';

export type LmcListOp =
  | {
      readonly op: 'jump' | 'mark';
      readonly gx: number;
      readonly gy: number;
      /** The distance word: straight-line length from the last position. */
      readonly distance: number;
    }
  | { readonly op: 'port'; readonly bits: number }
  | { readonly op: 'delay'; readonly units: number }
  | { readonly op: 'laser-on-point'; readonly dwell: number }
  | { readonly op: 'ready' }
  | { readonly op: 'end' }
  | {
      readonly op: 'setting';
      readonly opcode: number;
      readonly name: string;
      readonly words: readonly [number, number, number, number, number];
    };

export type DecodedLmcProgram = {
  /** Operations up to and including the first End of List. */
  readonly ops: ReadonlyArray<LmcListOp>;
  /** Whether an End of List closed the program. */
  readonly ended: boolean;
  /** A packet that was not 0xC00 bytes long, by index. */
  readonly badPacket: number | null;
};

export function decodeLmcProgram(lists: ReadonlyArray<Uint8Array>): DecodedLmcProgram {
  const ops: LmcListOp[] = [];
  for (let index = 0; index < lists.length; index += 1) {
    const list = lists[index];
    const commands = list === undefined || list.byteLength !== 0xc00 ? null : decodeLmcPacket(list);
    if (commands === null) return { ops, ended: false, badPacket: index };
    for (const command of commands) {
      const op = decodeOp(command);
      ops.push(op);
      if (op.op === 'end') return { ops, ended: true, badPacket: null };
    }
  }
  return { ops, ended: false, badPacket: null };
}

function decodeOp(command: LmcDecodedCommand): LmcListOp {
  const [p1, p2, , p4] = command.params;
  switch (command.opcode) {
    case LIST_JUMP_TO:
      return { op: 'jump', gx: p1, gy: p2, distance: p4 };
    case LIST_MARK_TO:
      return { op: 'mark', gx: p1, gy: p2, distance: p4 };
    case LIST_WRITE_PORT:
      return { op: 'port', bits: p1 };
    case LIST_DELAY_TIME:
      return { op: 'delay', units: p1 };
    case LIST_LASER_ON_POINT:
      return { op: 'laser-on-point', dwell: p1 };
    case LIST_READY_MARK:
      return { op: 'ready' };
    case LIST_END_OF_LIST:
      return { op: 'end' };
    default:
      return {
        op: 'setting',
        opcode: command.opcode,
        name: lmcListOpcodeName(command.opcode),
        words: command.params,
      };
  }
}

/** The settings a program writes, by name, each with every value in order. */
export function lmcSettingsWritten(
  ops: ReadonlyArray<LmcListOp>,
): ReadonlyMap<string, ReadonlyArray<ReadonlyArray<number>>> {
  const settings = new Map<string, number[][]>();
  for (const op of ops) {
    if (op.op !== 'setting') continue;
    const values = settings.get(op.name) ?? [];
    values.push([...op.words]);
    settings.set(op.name, values);
  }
  return settings;
}
