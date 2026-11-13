// LMC packet builder and reader (ADR-704). A command is six little-endian
// uint16 words: the opcode and five parameters (MeerK40t controller.py
// L594-623, struct "<6H"). A single command goes out alone as 12 bytes and is
// answered by 8 bytes, four uint16 words (controller.py L421-441). List
// commands are packed 256 to a 0xC00-byte packet whose unused slots hold the
// End-of-List filler (controller.py L23-24, L589-617) and is sent with no
// reply read (controller.py L578).

import {
  LIST_END_OF_LIST,
  LMC_COMMAND_BYTES,
  LMC_LIST_BYTES,
  LMC_REPLY_BYTES,
} from './lmc-opcodes';

/** Four reply words, word 3 carrying the status bits. */
export type LmcReply = readonly [number, number, number, number];

/** The five parameter words of one command; missing words are zero. */
export type LmcParams = readonly [number?, number?, number?, number?, number?];

function writeCommand(target: Uint8Array, offset: number, opcode: number, params: LmcParams): void {
  const view = new DataView(target.buffer, target.byteOffset + offset, LMC_COMMAND_BYTES);
  const words = [opcode, ...params];
  for (let index = 0; index < 6; index += 1) {
    const word = words[index] ?? 0;
    if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
      throw new RangeError(
        `LMC word ${index} of 0x${opcode.toString(16)} is not a uint16: ${word}`,
      );
    }
    view.setUint16(index * 2, word, true);
  }
}

/** One 12-byte single command. */
export function lmcCommand(opcode: number, ...params: LmcParams): Uint8Array {
  const bytes = new Uint8Array(LMC_COMMAND_BYTES);
  writeCommand(bytes, 0, opcode, params);
  return bytes;
}

/** A fresh list packet: every slot the End-of-List filler. */
export function emptyLmcList(): Uint8Array {
  const bytes = new Uint8Array(LMC_LIST_BYTES);
  for (let offset = 0; offset < LMC_LIST_BYTES; offset += LMC_COMMAND_BYTES) {
    writeCommand(bytes, offset, LIST_END_OF_LIST, []);
  }
  return bytes;
}

/** Packs list commands into 0xC00-byte packets in order. */
export class LmcListWriter {
  private readonly packets: Uint8Array[] = [];
  private current: Uint8Array | null = null;
  private offset = 0;
  private count = 0;

  write(opcode: number, ...params: LmcParams): void {
    if (this.current === null || this.offset >= LMC_LIST_BYTES) {
      this.current = emptyLmcList();
      this.packets.push(this.current);
      this.offset = 0;
    }
    writeCommand(this.current, this.offset, opcode, params);
    this.offset += LMC_COMMAND_BYTES;
    this.count += 1;
  }

  /** Commands written so far. */
  get commandCount(): number {
    return this.count;
  }

  /** The packets, the last one padded with the filler. */
  finish(): ReadonlyArray<Uint8Array> {
    return [...this.packets];
  }
}

/** Reads one 8-byte reply; null when it is not exactly 8 bytes. */
export function readLmcReply(bytes: Uint8Array): LmcReply | null {
  if (bytes.byteLength !== LMC_REPLY_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, LMC_REPLY_BYTES);
  return [
    view.getUint16(0, true),
    view.getUint16(2, true),
    view.getUint16(4, true),
    view.getUint16(6, true),
  ];
}

/** Encodes four reply words (the simulator's side of readLmcReply). */
export function lmcReplyBytes(words: LmcReply): Uint8Array {
  const bytes = new Uint8Array(LMC_REPLY_BYTES);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => view.setUint16(index * 2, word & 0xffff, true));
  return bytes;
}

/** One decoded command: its opcode and five parameter words. */
export type LmcDecodedCommand = {
  readonly opcode: number;
  readonly params: readonly [number, number, number, number, number];
};

/** Splits a 12-byte command or a 0xC00-byte list into its commands; null for
 *  any other length. A list keeps its filler slots. */
export function decodeLmcPacket(bytes: Uint8Array): ReadonlyArray<LmcDecodedCommand> | null {
  if (bytes.byteLength !== LMC_COMMAND_BYTES && bytes.byteLength !== LMC_LIST_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commands: LmcDecodedCommand[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += LMC_COMMAND_BYTES) {
    const word = (index: number): number => view.getUint16(offset + index * 2, true);
    commands.push({ opcode: word(0), params: [word(1), word(2), word(3), word(4), word(5)] });
  }
  return commands;
}
