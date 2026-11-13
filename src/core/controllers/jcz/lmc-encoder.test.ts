// LMC encoder goldens (ADR-704). Each job is encoded, decoded back with the
// core decoder, and checked against the exact operations MeerK40t's balormk
// controller writes for it (controller.py at d511944e): program_mode's
// opening (L486-532), set_settings in order (L643-708), jump/mark with angle 0
// and the distance word (L1147-1206), the end dwell and End of List.

import { describe, expect, it } from 'vitest';
import type { DeviceProfile } from '../../devices';
import { GENERIC_JCZ_GALVO_PROFILES } from '../../devices/galvo-profiles';
import type { CutGroup, FillGroup, Job } from '../../job';
import { machineToGalvo } from './galvo-field';
import { decodeLmcProgram, lmcSettingsWritten, type LmcListOp } from './lmc-decoder';
import { encodeLmcJob, type LmcEncodeResult } from './lmc-encoder';

const FIBER_110 = GENERIC_JCZ_GALVO_PROFILES[0] as DeviceProfile;

function cut(overrides: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power: 50,
    speed: 6000, // 100 mm/s
    passes: 1,
    airAssist: false,
    segments: [square(0, 0, 10)],
    ...overrides,
  };
}

function square(x: number, y: number, size: number) {
  const points = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ] as const;
  return { polyline: points.map(([px, py]) => ({ x: px, y: py })), closed: true };
}

function encode(job: Job, device: DeviceProfile = FIBER_110, layers = []): LmcEncodeResult {
  return encodeLmcJob(job, device, { layers });
}

function opsOf(result: LmcEncodeResult): ReadonlyArray<LmcListOp> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
  const decoded = decodeLmcProgram(result.program.lists);
  expect(decoded.ended).toBe(true);
  return decoded.ops;
}

const setting = (name: string, opcode: number, ...words: number[]): LmcListOp => ({
  op: 'setting',
  opcode,
  name,
  words: [words[0] ?? 0, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0, words[4] ?? 0],
});

describe('galvo field mapping (MeerK40t view: flip X, flip Y, then swap)', () => {
  it('puts the centre of a centred bed on the galvo centre and follows the default flip Y + swap', () => {
    const setup = { flipX: false, flipY: true, swapXY: true };
    expect(machineToGalvo({ x: 0, y: 0 }, FIBER_110, setup)).toEqual({ gx: 32767, gy: 32768 });
    // +X on the bed moves galvo Y; +Y on the bed moves galvo X.
    expect(machineToGalvo({ x: 10, y: 0 }, FIBER_110, setup)).toEqual({ gx: 32767, gy: 38725 });
    expect(machineToGalvo({ x: 0, y: 10 }, FIBER_110, setup)).toEqual({ gx: 38725, gy: 32768 });
    // Without flips or swap, the scene's top-left (rear-left) corner is 0,0.
    const plain = { flipX: false, flipY: false, swapXY: false };
    expect(machineToGalvo({ x: -55, y: 55 }, FIBER_110, plain)).toEqual({ gx: 0, gy: 0 });
    expect(machineToGalvo({ x: 55, y: -55 }, FIBER_110, plain)).toEqual({ gx: 65535, gy: 65535 });
  });

  it('returns null outside the lens field', () => {
    const setup = { flipX: false, flipY: true, swapXY: true };
    expect(machineToGalvo({ x: 55.1, y: 0 }, FIBER_110, setup)).toBeNull();
  });
});

describe('encodeLmcJob', () => {
  it('golden: a 10 mm fiber square at 50 % and 100 mm/s', () => {
    expect(opsOf(encode({ groups: [cut()] }))).toEqual([
      { op: 'ready' },
      { op: 'delay', units: 800 }, // open-MO delay 8 ms × 100
      { op: 'port', bits: 1 }, // program port bit 0
      setting('JumpSpeed', 0x8006, 1191), // 2000 mm/s × 65535/110 / 1000
      setting('QSwitchPeriod', 0x801b, 667), // 20000 / 30 kHz
      setting('MarkCurrent', 0x8012, 2048), // 50 % of 0xFFF, half to even
      setting('MarkSpeed', 0x800c, 59), // 100 mm/s
      setting('LaserOnDelay', 0x8007, 100, 0),
      setting('LaserOffDelay', 0x8008, 100, 0),
      setting('PolygonDelay', 0x800f, 10), // 100 µs in 10 µs units
      { op: 'jump', gx: 32767, gy: 32768, distance: 1 },
      { op: 'mark', gx: 32767, gy: 38725, distance: 5957 },
      { op: 'mark', gx: 38725, gy: 38725, distance: 5958 },
      { op: 'mark', gx: 38725, gy: 32768, distance: 5957 },
      { op: 'mark', gx: 32767, gy: 32768, distance: 5958 },
      { op: 'delay', units: 30 }, // end delay 300 µs
      { op: 'end' },
    ]);
  });

  it('repeats the marks once per pass without repeating settings', () => {
    const ops = opsOf(encode({ groups: [cut({ passes: 3 })] }));
    expect(ops.filter((op) => op.op === 'mark')).toHaveLength(12);
    // The beam is back at the start after each closed pass: no jump between passes.
    expect(ops.filter((op) => op.op === 'jump')).toHaveLength(1);
    expect(lmcSettingsWritten(ops).get('MarkCurrent')).toEqual([[2048, 0, 0, 0, 0]]);
  });

  it('writes a layer’s own frequency and a second layer’s changed words only', () => {
    const layers = [{ id: 'L2', galvoFrequencyKhz: 80 }];
    const job: Job = {
      groups: [cut(), cut({ layerId: 'L2', power: 50, segments: [square(20, 20, 5)] })],
    };
    const settings = lmcSettingsWritten(opsOf(encodeLmcJob(job, FIBER_110, { layers })));
    expect(settings.get('QSwitchPeriod')).toEqual([
      [667, 0, 0, 0, 0],
      [250, 0, 0, 0, 0],
    ]);
    expect(settings.get('MarkCurrent')).toHaveLength(1);
    expect(settings.get('LaserOnDelay')).toHaveLength(1);
  });

  it('writes the MOPA pulse width first, and CO2 frequency, first-pulse killer and power ratio', () => {
    const mopa = { ...FIBER_110, galvo: { ...FIBER_110.galvo!, source: 'mopa' as const } };
    const mopaOps = opsOf(
      encodeLmcJob({ groups: [cut()] }, mopa, { layers: [{ id: 'L1', galvoPulseWidthNs: 200 }] }),
    );
    // After the program's own opening Jump Speed, the layer opens with its pulse width.
    const opening = mopaOps.findIndex((op) => op.op === 'setting');
    expect(mopaOps[opening + 1]).toEqual(setting('FiberYLPMPulseWidth', 0x8026, 200));
    const co2 = {
      ...FIBER_110,
      galvo: { ...FIBER_110.galvo!, source: 'co2' as const, frequencyKhz: 20 },
    };
    const co2Settings = lmcSettingsWritten(opsOf(encode({ groups: [cut({ power: 40 })] }, co2)));
    expect(co2Settings.get('MarkFreq')).toEqual([[500, 0, 0, 0, 0]]); // 10000 / 20
    expect(co2Settings.get('SetCo2FPK')).toEqual([[100, 100, 0, 0, 0]]); // 2000 / 20
    expect(co2Settings.get('MarkPowerRatio')).toEqual([[400, 0, 0, 0, 0]]); // 200 × 40 / 20
    expect(co2Settings.has('MarkCurrent')).toBe(false);
    // Only a fiber opens the master oscillator, so only it waits for it.
    expect(opsOf(encode({ groups: [cut()] }, co2))[1]).toEqual({ op: 'port', bits: 1 });
  });

  it('marks Fill hatch scanlines as vectors', () => {
    const fill: FillGroup = {
      kind: 'fill',
      layerId: 'F1',
      color: '#ff0000',
      power: 30,
      speed: 12000,
      passes: 1,
      airAssist: false,
      overscanMm: 2,
      segments: [
        {
          polyline: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
          closed: false,
          reverse: false,
        },
        {
          polyline: [
            { x: 5, y: 1 },
            { x: 0, y: 1 },
          ],
          closed: false,
          reverse: true,
        },
      ],
    };
    const moves = opsOf(encode({ groups: [fill] })).filter(
      (op) => op.op === 'jump' || op.op === 'mark',
    );
    expect(moves.map((op) => op.op)).toEqual(['jump', 'mark', 'jump', 'mark']);
  });

  it('is deterministic', () => {
    const a = encode({ groups: [cut()] });
    const b = encode({ groups: [cut()] });
    if (!a.ok || !b.ok) throw new Error('refused');
    expect(a.program.lists).toEqual(b.program.lists);
    expect(a.program.lists[0]?.byteLength).toBe(0xc00);
  });

  it('refuses what it cannot mark exactly', () => {
    const raster = { ...cut(), kind: 'raster' } as unknown as CutGroup;
    expect(encode({ groups: [raster] })).toMatchObject({
      ok: false,
      error: { kind: 'raster-unsupported' },
    });
    expect(encode({ groups: [cut({ segments: [square(50, 50, 10)] })] })).toMatchObject({
      ok: false,
      error: { kind: 'outside-field' },
    });
    expect(encode({ groups: [cut()] }, { ...FIBER_110, galvo: undefined })).toMatchObject({
      ok: false,
      error: { kind: 'galvo-setup-missing' },
    });
    expect(encode({ groups: [cut()] }, { ...FIBER_110, bedHeight: 100 })).toMatchObject({
      ok: false,
      error: { kind: 'field-not-square' },
    });
    expect(encode({ groups: [cut({ speed: 30 })] })).toMatchObject({
      ok: false,
      error: { kind: 'speed-out-of-range' },
    });
    expect(encode({ groups: [cut({ segments: [] })] })).toMatchObject({
      ok: false,
      error: { kind: 'empty-job' },
    });
  });

  it('spills a long program into further 0xC00-byte lists', () => {
    const segments = Array.from({ length: 300 }, (_, index) =>
      square(-50 + (index % 30) * 3, -50 + Math.floor(index / 30) * 3, 1),
    );
    const result = encode({ groups: [cut({ segments })] });
    if (!result.ok) throw new Error('refused');
    expect(result.program.lists.length).toBeGreaterThan(1);
    expect(result.program.marks).toBe(1200);
    expect(
      decodeLmcProgram(result.program.lists).ops.filter((op) => op.op === 'mark'),
    ).toHaveLength(1200);
  });
});
