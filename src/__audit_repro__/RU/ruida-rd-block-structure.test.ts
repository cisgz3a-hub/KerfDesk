// Audit track RU, finding RU-3 — FAILS on current code.
//
// Defect: encodeRdJob ends every file with `EB D7`. rd-commands.ts calls 0xEB
// "end of block / flush", but 0xEB is "Array End", the closer of an
// `EA <index>` Array Start that KerfDesk never writes. The real Block End
// (E7 00) and End Layer (CA 01 00) are never written either.
//
// Upstream evidence:
//  - meerk40t rdjob.py L175 `BLOCK_END = b"\xE7\x00"`, L205-206
//    `ARRAY_START = b"\xEA"  # index(1)` / `ARRAY_END = b"\xEB"`, L102 `LAYER_END = b"\xCA\x01\x00"`.
//    https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L175
//  - meerk40t RDJob.write_header writes `array_start(0)` (L1496) and every layer
//    is closed by write_layer_end (L1511-1515): block_end(); layer_end();
//    en_laser_2_offset_0()  ->  E7 00, CA 01 00, CA 01 30; write_tail (L1550-1554)
//    closes the last layer, then set_file_sum and end_of_file (D7).
//  - EduTech wiki "Ruida": "0xEA <Index> | Array Start", "0xEB | Array End",
//    "0xE7 0x00 | Block End", "0xCA 0x01 0x00 | End Layer"; its RDWorks sample
//    contains `ea00 (Array Start (0))` in the header and ends `eb (Array End)`,
//    `e700 (Block End)`, ..., `d7 (End Of File)`.
//
// Correct behaviour: an 0xEB Array End only appears after an 0xEA Array Start,
// and the geometry is closed with Block End (E7 00) before End Of File (D7).
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { encodeRdJob, unswizzleBytes } from '../../core/controllers/ruida';

const RUIDA = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function commands(bytes: Uint8Array): number[][] {
  const out: number[][] = [];
  for (const byte of unswizzleBytes(bytes)) {
    if (byte >= 0x80 || out.length === 0) out.push([byte]);
    else out[out.length - 1]?.push(byte);
  }
  return out;
}

describe('RU-3: .rd block structure', () => {
  it('writes an 0xEB Array End only after an 0xEA Array Start', () => {
    const encoded = encodeRdJob(JOB, RUIDA);
    if (!encoded.ok) throw new Error(encoded.error.kind);
    const cmds = commands(encoded.bytes);
    const arrayEnd = cmds.findIndex((cmd) => cmd[0] === 0xeb);
    const arrayStart = cmds.findIndex((cmd) => cmd[0] === 0xea);
    if (arrayEnd !== -1) {
      expect(arrayStart).toBeGreaterThanOrEqual(0);
      expect(arrayStart).toBeLessThan(arrayEnd);
    }
  });

  it('closes the geometry with Block End (E7 00) before End Of File', () => {
    const encoded = encodeRdJob(JOB, RUIDA);
    if (!encoded.ok) throw new Error(encoded.error.kind);
    const cmds = commands(encoded.bytes);
    const lastMove = cmds.map((cmd) => cmd[0]).lastIndexOf(0xa8);
    const eof = cmds.findIndex((cmd) => cmd[0] === 0xd7);
    const between = cmds.slice(lastMove + 1, eof);
    expect(between.some((cmd) => cmd[0] === 0xe7 && cmd[1] === 0x00)).toBe(true);
  });
});
