// LMC packets and .cor files (ADR-704): six little-endian uint16 words per
// command, 0xC00-byte lists padded with End of List (MeerK40t controller.py
// L23-24, L594-617), 8-byte replies (L438-439), and EZCad .cor tables read
// as MeerK40t reads them (L1088-1133).

import { describe, expect, it } from 'vitest';
import { COR_TABLE_ENTRIES, readCorFile } from './lmc-cor-file';
import { LIST_END_OF_LIST, LIST_MARK_TO, LMC_GET_VERSION } from './lmc-opcodes';
import {
  decodeLmcPacket,
  emptyLmcList,
  lmcCommand,
  LmcListWriter,
  lmcReplyBytes,
  readLmcReply,
} from './lmc-packets';
import { roundHalfEven } from './lmc-units';

describe('LMC packets', () => {
  it('packs a command as six little-endian words', () => {
    expect([...lmcCommand(LMC_GET_VERSION)]).toEqual([7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...lmcCommand(LIST_MARK_TO, 0x1234, 0xabcd, 0, 5)]).toEqual([
      0x05, 0x80, 0x34, 0x12, 0xcd, 0xab, 0, 0, 5, 0, 0, 0,
    ]);
    expect(() => lmcCommand(LIST_MARK_TO, 0x10000)).toThrow(RangeError);
  });

  it('fills a list with End of List and starts a new one after 256 commands', () => {
    const empty = decodeLmcPacket(emptyLmcList()) ?? [];
    expect(empty).toHaveLength(256);
    expect(empty.every((command) => command.opcode === LIST_END_OF_LIST)).toBe(true);
    const writer = new LmcListWriter();
    for (let index = 0; index < 257; index += 1) writer.write(LIST_MARK_TO, index);
    const lists = writer.finish();
    expect(lists.map((list) => list.byteLength)).toEqual([0xc00, 0xc00]);
    expect(decodeLmcPacket(lists[1] ?? new Uint8Array())?.[1]?.opcode).toBe(LIST_END_OF_LIST);
  });

  it('reads an 8-byte reply as four words and refuses any other length', () => {
    expect(readLmcReply(lmcReplyBytes([1, 2, 3, 0x24]))).toEqual([1, 2, 3, 0x24]);
    expect(readLmcReply(new Uint8Array(7))).toBeNull();
  });

  it('rounds halves to even, as Python round does', () => {
    expect([0.5, 1.5, 2.5, 2047.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 2048, 2, 3]);
  });
});

function utf16le(text: string): number[] {
  return [...text].flatMap((char) => [char.charCodeAt(0), 0]);
}

describe('readCorFile', () => {
  it('reads an LMC1COR_1.0 float table, rounding and folding negatives into bit 15', () => {
    const bytes = new Uint8Array(0x16 + 0x1fa + COR_TABLE_ENTRIES * 16);
    bytes.set(utf16le('LMC1COR_1.0'), 0);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0x16 + 0x1fa, 12.5, true);
    view.setFloat64(0x16 + 0x1fa + 8, -3.4, true);
    const read = readCorFile(bytes);
    expect(read).toMatchObject({ ok: true, format: 'float' });
    if (read.ok) {
      expect(read.table).toHaveLength(COR_TABLE_ENTRIES);
      expect(read.table[0]).toEqual([12, 0x8003]);
    }
  });

  it('reads an integer table after a 0x0E-byte header', () => {
    const bytes = new Uint8Array(0x16 + 0xe + COR_TABLE_ENTRIES * 8);
    bytes.set(utf16le('LMC1COR_0.9'), 0);
    const view = new DataView(bytes.buffer);
    view.setInt32(0x24 + 8, -7, true);
    view.setInt32(0x24 + 12, 300, true);
    const read = readCorFile(bytes);
    expect(read).toMatchObject({ ok: true, format: 'int' });
    if (read.ok) expect(read.table[1]).toEqual([0x8007, 300]);
  });

  it('refuses a short file', () => {
    expect(readCorFile(new Uint8Array(100))).toMatchObject({ ok: false });
  });
});
