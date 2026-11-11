// LHYMicro-GL primitives against MeerK40t's published values (ADR-703):
// speed codes from its test_laser_speeds.py table, the .egv rectangle from its
// test_drivers_lihuiyu.py, and the standard CRC-8/MAXIM check value.

import { describe, expect, it } from 'vitest';
import { egvBody, LhyDecoder } from '../../../__fixtures__/controllers/lihuiyu-decoder';
import { encodeLhyDistance } from './lhy-distance';
import {
  lhyCommandPayload,
  lhyCrc,
  lhyPacket,
  lhyPayloads,
  lhyStatusFinished,
  LHY_STATUS,
} from './lhy-packet';
import {
  lhySpeedCode,
  lhySpeedFromCode,
  parseLhySpeedCode,
  type LihuiyuBoard,
} from './lhy-speed-code';
import { LhyWriter, lhyPwmBytes } from './lhy-writer';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('LHY speed codes', () => {
  // meerk40t test/test_laser_speeds.py rows "<code> <board> <mm/s> 0": codes
  // the vendor software wrote. MeerK40t matches them as its own tests do
  // (L3080-3165): value within 1, gearing and step exact, diagonal within
  // max(1, v / 3000). Suffix C is its default below 7 mm/s on M2/M3/B2.
  const rows: ReadonlyArray<readonly [string, LihuiyuBoard, number]> = [
    ['CV0051131001065112C', 'M2', 0.4],
    ['CV0640541008005155', 'M2', 7],
    ['CV1151921011002219', 'M2', 10],
    ['CV0121111011005182', 'B2', 10],
    ['CV0521321002026044C', 'B2', 1],
    ['CV0351481007007122', 'M1', 6],
    ['CV0541281', 'A', 1],
    ['CV0351481', 'M', 6],
  ];
  it.each(rows)('matches %s for %s at %s mm/s', (code, board, speed) => {
    const suffixC = (board === 'M2' || board === 'B2') && speed < 7;
    const written = parseLhySpeedCode(lhySpeedCode(speed, { board, suffixC }));
    const reference = parseLhySpeedCode(code);
    expect(Math.abs(written.value - reference.value)).toBeLessThanOrEqual(1);
    expect(written.accel).toBe(reference.accel);
    expect(written.step).toBe(reference.step);
    expect(Math.abs(written.diagonal - reference.diagonal)).toBeLessThanOrEqual(
      Math.max(1, reference.diagonal / 3000),
    );
    expect(written.suffixC).toBe(reference.suffixC);
  });

  it('writes the twitchless 15 mm/s code of the MeerK40t .egv rectangle', () => {
    expect(lhySpeedCode(15, { board: 'M2', suffixC: true })).toBe('CV2490731016000027C');
  });

  it('reads back the speed it writes, within the 16-bit step (1 %)', () => {
    for (const speed of [1, 5, 12.5, 30, 80, 140]) {
      const code = lhySpeedCode(speed, { board: 'M2', suffixC: true });
      expect(Math.abs(lhySpeedFromCode(code, 'M2') - speed)).toBeLessThan(speed * 0.01);
    }
  });

  it('adds the M3 W power suffix only for 0..999 per mille', () => {
    const code = lhySpeedCode(20, { board: 'M3', suffixC: true, powerPerMille: 450 });
    expect(code.endsWith('CW450')).toBe(true);
    expect(parseLhySpeedCode(code).powerPerMille).toBe(450);
    expect(lhySpeedCode(20, { board: 'M3', suffixC: true, powerPerMille: 1000 })).not.toMatch(/W/);
  });

  it('refuses a speed that is not positive', () => {
    expect(() => lhySpeedCode(0, { board: 'M2', suffixC: true })).toThrow(RangeError);
  });
});

describe('LHY distances', () => {
  it.each([
    [1, 'a'],
    [25, 'y'],
    [26, '|a'],
    [51, '|z'],
    [52, '052'],
    [254, '254'],
    [255, 'z'],
    [394, 'z139'],
    [787, 'zzzv'],
    [510, 'zz'],
  ])('encodes %s steps as %s', (steps, code) => {
    expect(encodeLhyDistance(steps)).toBe(code);
  });
});

describe('LHY packets', () => {
  it('computes the Dallas/Maxim CRC-8 (check value and lookup-table entries)', () => {
    expect(lhyCrc(ascii('123456789'))).toBe(0xa1);
    expect(lhyCrc(Uint8Array.of(0x01))).toBe(0x5e);
    expect(lhyCrc(Uint8Array.of(0x0f))).toBe(0x41);
    expect(lhyCrc(Uint8Array.of(0x10))).toBe(0x9d);
    expect(lhyCrc(Uint8Array.of(0xf0))).toBe(0x74);
  });

  it('frames 0x00, 30 payload bytes and the CRC', () => {
    const payload = lhyCommandPayload('IPP');
    const packet = lhyPacket(payload);
    expect(packet).toHaveLength(32);
    expect(packet[0]).toBe(0);
    expect(text(packet.subarray(1, 31))).toBe(`IPP${'F'.repeat(27)}`);
    expect(packet[31]).toBe(lhyCrc(payload));
  });

  it('cuts at newlines, pads with F and marks the wait-for-finish dash', () => {
    const payloads = lhyPayloads(ascii(`IBzzzvRzzzvS1P\nICV2490731016000027CNLBS1EDz139FNSE-\n`));
    expect(payloads.map((p) => text(p.payload))).toEqual([
      `IBzzzvRzzzvS1PF${'F'.repeat(15)}`,
      'ICV2490731016000027CNLBS1EDz13',
      `9FNSE${'F'.repeat(25)}`,
    ]);
    expect(payloads.map((p) => p.waitFinish)).toEqual([false, false, true]);
  });

  it('pads an AT payload with zero bytes', () => {
    const [at] = lhyPayloads(Uint8Array.of(0x41, 0x54, 0x31, 1, 50, 0x0a));
    expect(Array.from(at?.payload.subarray(0, 6) ?? [])).toEqual([0x41, 0x54, 0x31, 1, 50, 0]);
  });

  it('reads finish from status bit 1', () => {
    expect(lhyStatusFinished(LHY_STATUS.finish)).toBe(true);
    expect(lhyStatusFinished(LHY_STATUS.okM3Finish)).toBe(true);
    expect(lhyStatusFinished(LHY_STATUS.ok)).toBe(false);
    expect(lhyStatusFinished(LHY_STATUS.busy)).toBe(false);
    expect(lhyStatusFinished(0)).toBe(false);
  });

  it('never writes a newline byte into the AT1 power value', () => {
    expect(lhyPwmBytes(10)).toEqual([0, 11]);
    expect(lhyPwmBytes(264)).toEqual([1, 11]);
    expect(lhyPwmBytes(300)).toEqual([1, 46]);
  });
});

describe('LHY decoder', () => {
  it("decodes MeerK40t's golden .egv rectangle", () => {
    const egv = ascii(
      'Document type : LHYMICRO-GL file\nFile version: 1.0.01\nCopyright: Unknown\n' +
        'Creator-Software: MeerK40t v0.0.0-testing\n\n%0%0%0%0%\n' +
        'IBzzzvRzzzvS1P\nICV2490731016000027CNLBS1EDz139Rz139Tz139Lz139FNSE-\n',
    );
    const decoder = new LhyDecoder();
    decoder.writeStream(egvBody(egv));
    expect(decoder.moves.map((m) => [m.to.x, m.to.y, m.laser])).toEqual([
      [787, 787, false],
      [1181, 787, true],
      [1181, 1181, true],
      [787, 1181, true],
      [787, 787, true],
    ]);
    expect(decoder.speedCodes).toEqual(['CV2490731016000027']);
  });

  it('round-trips the writer: rapid, program cuts with diagonals, home', () => {
    const writer = new LhyWriter();
    writer.rapidMove(500, 300);
    writer.enterProgram('CV2490731016000027C', {
      leftward: false,
      topward: false,
      horizontalMajor: true,
    });
    writer.programMove(400, 0, true);
    writer.programMove(0, 250, false);
    writer.programMove(-123, -77, true);
    writer.programMove(-200, 200, true);
    writer.leaveProgram();
    const decoder = new LhyDecoder();
    decoder.writeStream(writer.stream());
    expect([decoder.x, decoder.y]).toEqual([writer.x, writer.y]);
    expect([decoder.x, decoder.y]).toEqual([577, 673]);
    const burned = decoder.burns().reduce((sum, m) => sum + Math.abs(m.to.x - m.from.x), 0);
    expect(burned).toBe(400 + 123 + 200);
    writer.home();
    decoder.writeStream(writer.stream().subarray(writer.stream().length - 4));
    expect(decoder.homes).toBe(1);
    expect([decoder.x, decoder.y]).toEqual([0, 0]);
  });
});
