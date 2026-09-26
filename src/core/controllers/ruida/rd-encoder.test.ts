// .rd file structure against meerk40t's RDJob writer (ruida/rdjob.py at
// 7e82652f: write_header L1401-1504, write_settings L1517-1548,
// write_layer_end L1511-1515, write_tail L1550-1554, jump/mark L1556-1595).
// Regression tests for controller audit 2026-09-25 findings RU-1 to RU-5. The
// same two-layer job, decoded by meerk40t's own RDJob.process, plots layer 0
// at 50 mm/s / 20 % and layer 1 at 5 mm/s / 80 % with no unknown command.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { CutGroup, Job, JobOriginPlacement } from '../../job';
import {
  decodeRdStream,
  expectedRdFileSum,
  layerBodySettings,
  splitRdCommands,
} from '../../../__fixtures__/controllers/ruida-decoder';
import { encodeRdJob, rdReferencePointFor } from './rd-encoder';

const RUIDA_DEVICE = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

function cutGroup(overrides: Partial<CutGroup>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power: 50,
    speed: 1500,
    passes: 1,
    airAssist: false,
    segments: [],
    ...overrides,
  };
}

type XY = readonly [number, number];

function line(...points: ReadonlyArray<XY>) {
  return { polyline: points.map(([x, y]) => ({ x, y })), closed: false };
}

// A closed contour as compile-job produces it: the last point is the first.
function closedLine(...points: ReadonlyArray<XY>) {
  return { ...line(...points), closed: true };
}

// 50 mm/s at 20 % without air, then 5 mm/s at 80 % with air.
const TWO_LAYER: Job = {
  groups: [
    cutGroup({
      layerId: 'L1',
      color: '#ff0000',
      power: 20,
      speed: 3000,
      segments: [line([10, 10], [20, 10])],
    }),
    cutGroup({
      layerId: 'L2',
      color: '#0000ff',
      power: 80,
      speed: 300,
      airAssist: true,
      segments: [line([50, 10], [60, 30])],
    }),
  ],
};

function encode(job: Job, jobOrigin?: JobOriginPlacement): Uint8Array {
  const encoded = encodeRdJob(job, RUIDA_DEVICE, jobOrigin === undefined ? {} : { jobOrigin });
  if (!encoded.ok) throw new Error(`encode failed: ${encoded.error.kind}`);
  return encoded.bytes;
}

// Opcode prefix of each command: CA 01 xx is named by all three bytes.
function opcodes(bytes: Uint8Array): string[] {
  return splitRdCommands(bytes).map((command) => {
    const width =
      command[0] === 0xca && command[1] === 0x01 ? 3 : SINGLE_BYTE.has(command[0] ?? 0) ? 1 : 2;
    return command
      .slice(0, width)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  });
}

const SINGLE_BYTE = new Set([0x88, 0xa8, 0xea, 0xf0, 0xd7]);

const PART_RECORD = ['c904', 'c631', 'c632', 'c641', 'c642', 'ca06', 'ca41'];
const PART_BOUNDS = ['e752', 'e753', 'e761', 'e762'];
const LAYER_END = ['e700', 'ca0100', 'ca0130'];

function layerBody(air: 'ca0113' | 'ca0112'): string[] {
  return ['ca02', 'ca0110', air, 'c902', 'c612', 'c613', 'c601', 'c602', 'c621', 'c622', 'ca03'];
}

describe('.rd writer order (meerk40t write_header → write_settings → write_tail)', () => {
  it('writes the two-layer job in meerk40t order', () => {
    // meerk40t writes no air command for a layer without a coolant setting and
    // its driver repeats C6 02/C6 01 before a cut; this encoder always states
    // the layer's air and sets power once per layer. Otherwise identical.
    expect(opcodes(encode(TWO_LAYER))).toEqual([
      ...['d810', 'e601', 'f0', 'f102', 'd800', 'e706', 'e738'],
      ...['e703', 'e707', 'e750', 'e751', 'e704', 'e705'],
      ...[...PART_RECORD, ...PART_BOUNDS, ...PART_RECORD, ...PART_BOUNDS],
      ...['ca22', 'e754', 'e754', 'e755', 'e755', 'f103', 'e70a'],
      ...['ea', 'e760', 'e70b', 'e713', 'e717', 'e723', 'e724', 'e708'],
      ...[...layerBody('ca0112'), '88', 'a8', ...LAYER_END],
      ...[...layerBody('ca0113'), '88', 'a8', ...LAYER_END],
      ...['e505', 'd7'],
    ]);
  });

  it('decodes every command it writes', () => {
    const events = decodeRdStream(encode(TWO_LAYER));
    expect(events.filter((event) => event.kind === 'unknown')).toEqual([]);
  });

  it('records the job and part bounds with meerk40t corners', () => {
    const events = decodeRdStream(encode(TWO_LAYER));
    // Native Ruida X grows toward the operator's left, so the process
    // "top-left" is (max x, min y) (write_header L1419-1422).
    expect(events.filter((event) => event.kind === 'job-bounds')).toEqual([
      { kind: 'job-bounds', tag: 0x03, xMm: 60, yMm: 10 },
      { kind: 'job-bounds', tag: 0x07, xMm: 10, yMm: 30 },
      { kind: 'job-bounds', tag: 0x50, xMm: 60, yMm: 10 },
      { kind: 'job-bounds', tag: 0x51, xMm: 10, yMm: 30 },
    ]);
    expect(events.filter((event) => event.kind === 'part-bounds')).toEqual([
      { kind: 'part-bounds', part: 0, tag: 0x52, xMm: 10, yMm: 10 },
      { kind: 'part-bounds', part: 0, tag: 0x53, xMm: 20, yMm: 10 },
      { kind: 'part-bounds', part: 0, tag: 0x61, xMm: 10, yMm: 10 },
      { kind: 'part-bounds', part: 0, tag: 0x62, xMm: 20, yMm: 10 },
      { kind: 'part-bounds', part: 1, tag: 0x52, xMm: 50, yMm: 10 },
      { kind: 'part-bounds', part: 1, tag: 0x53, xMm: 60, yMm: 30 },
      { kind: 'part-bounds', part: 1, tag: 0x61, xMm: 50, yMm: 10 },
      { kind: 'part-bounds', part: 1, tag: 0x62, xMm: 60, yMm: 30 },
    ]);
  });
});

describe('RU-1: each layer body activates its own speed and power', () => {
  it('sets C9 02 speed and C6 01/C6 02 power after CA 02 for every layer', () => {
    const settings = layerBodySettings(decodeRdStream(encode(TWO_LAYER)));
    const first = settings.get(0);
    const second = settings.get(1);
    expect(first?.mmPerMin).toBeCloseTo(3000, 6);
    expect(first?.minPercent).toBeCloseTo(20, 1);
    expect(first?.maxPercent).toBeCloseTo(20, 1);
    expect(second?.mmPerMin).toBeCloseTo(300, 6);
    expect(second?.minPercent).toBeCloseTo(80, 1);
    expect(second?.maxPercent).toBeCloseTo(80, 1);
  });

  it('keeps the header part table in step with the bodies', () => {
    const events = decodeRdStream(encode(TWO_LAYER));
    expect(events.filter((event) => event.kind === 'part-speed')).toEqual([
      { kind: 'part-speed', part: 0, mmPerMin: 3000 },
      { kind: 'part-speed', part: 1, mmPerMin: 300 },
    ]);
    expect(
      events.find((event) => event.kind === 'record' && event.name === 'max-layer-part'),
    ).toEqual({ kind: 'record', name: 'max-layer-part', values: [1] });
  });
});

describe('RU-5: layer air assist reaches the .rd file', () => {
  it('writes Air Assist On / Off in each layer body', () => {
    const settings = layerBodySettings(decodeRdStream(encode(TWO_LAYER)));
    expect(settings.get(0)?.airAssist).toBe(false);
    expect(settings.get(1)?.airAssist).toBe(true);
  });

  it('encodes airAssist:true differently from airAssist:false', () => {
    const job = (airAssist: boolean): Job => ({
      groups: [
        cutGroup({
          airAssist,
          segments: [line([10, 10], [40, 10])],
        }),
      ],
    });
    expect([...encode(job(true))]).not.toEqual([...encode(job(false))]);
  });
});

describe('RU-2: the reference point follows the export placement', () => {
  const placements: ReadonlyArray<readonly [string, JobOriginPlacement | undefined, string]> = [
    ['no placement', undefined, 'machine-zero'],
    ['Absolute', { startFrom: 'absolute', anchor: 'front-left' }, 'machine-zero'],
    ['User Origin', { startFrom: 'user-origin', anchor: 'front-left' }, 'anchor-point'],
    ['Verified Origin', { startFrom: 'verified-origin', anchor: 'center' }, 'anchor-point'],
    [
      'Current Position',
      { startFrom: 'current-position', anchor: 'front-left', currentPosition: { x: 1, y: 2 } },
      'current-position',
    ],
  ];

  it.each(placements)('%s declares the %s reference point', (_label, placement, mode) => {
    expect(rdReferencePointFor(placement)).toBe(mode);
    expect(decodeRdStream(encode(TWO_LAYER, placement))[0]).toEqual({
      kind: 'reference-point',
      mode,
    });
  });

  it('writes the meerk40t preamble with Start Process before any move', () => {
    const codes = opcodes(encode(TWO_LAYER, { startFrom: 'absolute', anchor: 'front-left' }));
    expect(codes.slice(0, 5)).toEqual(['d810', 'e601', 'f0', 'f102', 'd800']);
    expect(codes).not.toContain('d812');
  });
});

describe('RU-3: .rd block structure', () => {
  it('writes one Array Start in the header and never an Array End', () => {
    const codes = opcodes(encode(TWO_LAYER));
    expect(codes.filter((code) => code === 'ea')).toHaveLength(1);
    expect(codes.indexOf('ea')).toBeLessThan(codes.indexOf('ca02'));
    expect(codes).not.toContain('eb');
  });

  it('closes every layer with Block End, End Layer and EnLaser2Offset 0', () => {
    const codes = opcodes(encode(TWO_LAYER));
    const layerStarts = codes.flatMap((code, index) => (code === 'ca02' ? [index] : []));
    const ends = [...layerStarts.slice(1), codes.indexOf('e505')];
    for (const end of ends) expect(codes.slice(end - 3, end)).toEqual(LAYER_END);
  });

  it('ends with the meerk40t file sum and End Of File', () => {
    const bytes = encode(TWO_LAYER);
    const events = decodeRdStream(bytes);
    expect(events.at(-1)).toEqual({ kind: 'file-end' });
    expect(events.at(-2)).toEqual({ kind: 'file-sum', value: expectedRdFileSum(bytes) });
  });
});

describe('RU-4: no stationary travel or cut', () => {
  const square = closedLine([10, 10], [20, 10], [20, 20], [10, 20], [10, 10]);

  function motion(job: Job) {
    return decodeRdStream(encode(job)).filter(
      (event) => event.kind === 'move' || event.kind === 'cut',
    );
  }

  it('never moves or cuts to the position the head already holds', () => {
    const steps = motion({ groups: [cutGroup({ passes: 2, segments: [square] })] });
    // One travel, then four edges per pass: the second pass starts where the
    // first ended, and nothing is appended to close the closed contour.
    expect(steps.map((step) => step.kind)).toEqual(['move', ...Array<'cut'>(8).fill('cut')]);
    steps.forEach((step, index) => {
      const previous = steps[index - 1];
      if (previous !== undefined)
        expect([step.xMm, step.yMm]).not.toEqual([previous.xMm, previous.yMm]);
    });
  });

  it('skips a layer-start travel to where the previous layer ended', () => {
    const job: Job = {
      groups: [
        cutGroup({ segments: [line([0, 0], [5, 0])] }),
        cutGroup({ layerId: 'L2', segments: [line([5, 0], [5, 5])] }),
      ],
    };
    expect(motion(job).map((step) => step.kind)).toEqual(['move', 'cut', 'cut']);
  });

  it('drops a segment that collapses to one micrometre point, travel included', () => {
    const job: Job = {
      groups: [cutGroup({ segments: [line([1, 1], [1.0001, 1.0004]), line([2, 2], [3, 2])] })],
    };
    expect(motion(job)).toEqual([
      { kind: 'move', xMm: 2, yMm: 2 },
      { kind: 'cut', xMm: 3, yMm: 2 },
    ]);
  });

  it('refuses a job whose every segment collapses as empty', () => {
    const job: Job = { groups: [cutGroup({ segments: [line([1, 1], [1, 1])] })] };
    expect(encodeRdJob(job, RUIDA_DEVICE)).toEqual({ ok: false, error: { kind: 'empty-job' } });
  });
});
