// Audit track RU, finding RU-2 — FAILS on current code.
//
// Defect: every .rd file starts with 0xD8 0x12, which rd-commands.ts calls a
// "start-of-stream marker (upload begin)". It is the Ruida reference-point
// mode command "Ref Point Mode 0 — Current Position". The file therefore tells
// the controller to place the job relative to the head's position at start,
// whatever Start From the operator chose (Absolute here), and it never sends
// Start Process (0xD8 0x00).
//
// Upstream evidence:
//  - meerk40t rdjob.py L135-137:  REF_POINT_2 = b"\xD8\x10"  # MACHINE_ZERO/ABS POSITION
//                                 REF_POINT_1 = b"\xD8\x11"  # ANCHOR_POINT
//                                 REF_POINT_0 = b"\xD8\x12"  # CURRENT_POSITION
//    https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L135-L137
//    and the decoder text, L1066-1074: "Start Process" (D8 00), "Ref Point Mode 2,
//    Machine Zero/Absolute Position" (D8 10), "Ref Point Mode 0, Current Position" (D8 12).
//  - meerk40t's hardware-run header, RDJob.write_header rdjob.py L1409-1414:
//    ref_point_2(); set_absolute(); ref_point_set(); enable_block_cutting(0); start_process()
//    i.e. D8 10, E6 01, F0, F1 02 00, D8 00.
//  - EduTech wiki "Ruida" command table: "0xD8 0x12 | Ref Point Mode 0",
//    "0xD8 0x00 | Start Process"; its RDWorks sample header begins
//    d810 (Ref Point Mode 2), f0 (Ref Point Set), e601 (Set Absolute), f10200, d800 (Start Process).
//  - LightBurn "Coordinates and Job Origin": Current Position "output graphics
//    relative to the position of the laser head at the moment you start a job".
//
// Correct behaviour: an Absolute export declares Machine Zero / Absolute
// (D8 10 + E6 01) and sends Start Process (D8 00) before the first move; it
// never declares Current Position (D8 12).
import { describe, expect, it } from 'vitest';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { unswizzleBytes } from '../../core/controllers/ruida';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile } from '../../io/rd';

function ruidaSquareProject(): Project {
  const entry = profileCatalogEntryById('generic-ruida-rd-export');
  if (entry === undefined) throw new Error('missing generic Ruida profile');
  return {
    ...createProject(),
    device: entry.profile,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'sq',
          source: 'sq.svg',
          bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
          transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                    { x: 40, y: 20 },
                    { x: 0, y: 20 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function commands(bytes: Uint8Array): number[][] {
  const out: number[][] = [];
  for (const byte of unswizzleBytes(bytes)) {
    if (byte >= 0x80 || out.length === 0) out.push([byte]);
    else out[out.length - 1]?.push(byte);
  }
  return out;
}

const is = (cmd: number[] | undefined, op: number, sub?: number): boolean =>
  cmd !== undefined && cmd[0] === op && (sub === undefined || cmd[1] === sub);

describe('RU-2: .rd reference-point mode matches the export placement', () => {
  it('an Absolute export never declares Ref Point Mode 0 (Current Position)', () => {
    const result = emitRdFile(ruidaSquareProject(), {
      jobOrigin: { startFrom: 'absolute', anchor: 'front-left' },
    });
    if (!result.ok) throw new Error(result.messages.join('\n'));
    const cmds = commands(result.bytes);
    expect(cmds.some((cmd) => is(cmd, 0xd8, 0x12))).toBe(false);
  });

  it('an Absolute export declares Machine Zero/Absolute and Start Process before the first move', () => {
    const result = emitRdFile(ruidaSquareProject(), {
      jobOrigin: { startFrom: 'absolute', anchor: 'front-left' },
    });
    if (!result.ok) throw new Error(result.messages.join('\n'));
    const cmds = commands(result.bytes);
    const firstMove = cmds.findIndex((cmd) => is(cmd, 0x88) || is(cmd, 0xa8));
    const preamble = cmds.slice(0, firstMove);
    expect(preamble.some((cmd) => is(cmd, 0xd8, 0x10))).toBe(true);
    expect(preamble.some((cmd) => is(cmd, 0xe6, 0x01))).toBe(true);
    expect(preamble.some((cmd) => is(cmd, 0xd8, 0x00))).toBe(true);
  });
});
