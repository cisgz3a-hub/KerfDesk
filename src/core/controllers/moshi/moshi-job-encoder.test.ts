// Moshi job encoder (ADR-705): golden bytes, then programs decoded back into
// the moves and laser states a board would run. The golden is derived by hand
// from MeerK40t's MoshiBuilder (builder.py L376-553 at d511944e): it proves the
// bytes follow that builder, NOT that a real Moshiboard runs them.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { CutGroup, FillGroup, Job, RasterGroup } from '../../job';
import { decodeMoshiProgram, type MoshiDecodedProgram } from './moshi-decoder';
import { encodeMoshiJob } from './moshi-job-encoder';

const MOSHI_DEVICE = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' as const };

// One red layer, a single two-point line, 50 % power, 1500 mm/min, 2 passes.
const LINE: CutGroup = {
  kind: 'cut',
  layerId: 'L1',
  color: '#ff0000',
  power: 50,
  speed: 1500,
  passes: 2,
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
};
const CANONICAL_JOB: Job = { groups: [LINE] };

// 25 mm/s: vector speed 0a (row 5) with 24, 24. Set Offset 00, z 0, x 394
// (10 mm), y 787 (20 mm). Move 8a (row 7) to 0,0 relative. Cut d5 (row 15
// column 1) to +787, +788 (30, 40 mm). The second pass travels back and cuts
// again. Seven termination bytes 80 (row 2).
const GOLDEN_HEX =
  '0a1818' +
  '0000008a011303' +
  '8a00000000' +
  'd513031403' +
  '8a00000000' +
  'd513031403' +
  '80'.repeat(7);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeAll(job: Job): MoshiDecodedProgram[] {
  const result = encodeMoshiJob(job, MOSHI_DEVICE);
  if (!result.ok) throw new Error(`encode failed: ${result.error.kind}`);
  return result.programs.map((program) => {
    const decoded = decodeMoshiProgram(program.bytes);
    if (!decoded.ok) throw new Error(decoded.error);
    return decoded.program;
  });
}

describe('encodeMoshiJob', () => {
  it('writes the MeerK40t builder bytes for the canonical line job', () => {
    const result = encodeMoshiJob(CANONICAL_JOB, MOSHI_DEVICE);
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.programs.map((program) => program.kind)).toEqual(['vector']);
    expect(toHex(result.programs[0]?.bytes ?? new Uint8Array())).toBe(GOLDEN_HEX);
    expect(result.footprint).toEqual({ minX: 394, minY: 787, maxX: 1181, maxY: 1575 });
  });

  it('decodes back to the moves and laser states of both passes', () => {
    const [program] = decodeAll(CANONICAL_JOB);
    expect(program?.mode).toBe('vector');
    expect(program?.speed).toBe(25);
    expect(program?.normalSpeed).toBe(25);
    expect(program?.terminationBytes).toBe(7);
    expect(program?.steps).toEqual([
      { x: 394, y: 787, cut: false },
      { x: 1181, y: 1575, cut: true },
      { x: 394, y: 787, cut: false },
      { x: 1181, y: 1575, cut: true },
    ]);
  });

  it('keeps a 0 % layer laser-off and refuses a job with nothing to burn', () => {
    const dark: Job = { groups: [{ ...LINE, power: 0 }] };
    const result = encodeMoshiJob(dark, MOSHI_DEVICE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('empty-job');
  });

  it('burns a fill segment between laser-off runways', () => {
    const fill: FillGroup = {
      kind: 'fill',
      layerId: 'F',
      color: '#00f',
      power: 40,
      speed: 6000,
      passes: 1,
      airAssist: false,
      overscanMm: 2,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
          closed: false,
          reverse: false,
        },
        {
          polyline: [
            { x: 20, y: 11 },
            { x: 10, y: 11 },
          ],
          closed: false,
          reverse: true,
        },
      ],
    };
    const [program] = decodeAll({ groups: [fill] });
    expect(program?.steps).toEqual([
      { x: 315, y: 394, cut: false },
      { x: 394, y: 394, cut: false },
      { x: 787, y: 394, cut: true },
      { x: 866, y: 394, cut: false },
      { x: 866, y: 433, cut: false },
      { x: 787, y: 433, cut: false },
      { x: 394, y: 433, cut: true },
      { x: 315, y: 433, cut: false },
    ]);
  });

  it('rasters dark pixels as horizontal cuts, both ways, then homes', () => {
    // Two rows of 4 pixels over 4 x 2 mm at x 10 mm: row 0 dark at 0-1 and 3,
    // row 1 dark at 1-2. No overscan, so each row starts at its first dark pixel.
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'R',
      color: '#000',
      power: 100,
      speed: 6000,
      passes: 1,
      airAssist: false,
      sValues: Uint16Array.from([1000, 1000, 0, 1000, 0, 1000, 1000, 0]),
      pixelWidth: 4,
      pixelHeight: 2,
      bounds: { minX: 10, minY: 10, maxX: 14, maxY: 12 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };
    const programs = decodeAll({ groups: [raster] });
    expect(programs.map((program) => program.mode)).toEqual(['raster', 'vector']);
    const [scan, home] = programs;
    expect(scan?.speed).toBe(10); // 100 mm/s = 10 cm/s
    // Row centres 10.5 and 11.5 mm = 413 and 453 mils; pixel edges 10..14 mm.
    expect(scan?.steps).toEqual([
      { x: 394, y: 413, cut: false },
      { x: 472, y: 413, cut: true },
      { x: 512, y: 413, cut: false },
      { x: 551, y: 413, cut: true },
      { x: 551, y: 453, cut: false },
      { x: 512, y: 453, cut: false },
      { x: 433, y: 453, cut: true },
    ]);
    expect(home?.steps).toEqual([{ x: 0, y: 0, cut: false }]);
    expect(home?.speed).toBe(40);
  });

  it('refuses CNC groups, angled rasters and positions off the board', () => {
    const negative: Job = {
      groups: [
        {
          ...LINE,
          segments: [
            {
              polyline: [
                { x: -1, y: 0 },
                { x: 5, y: 5 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const far: Job = {
      groups: [
        {
          ...LINE,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 900, y: 5 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    for (const job of [negative, far]) {
      const result = encodeMoshiJob(job, MOSHI_DEVICE);
      expect(result.ok ? 'ok' : result.error.kind).toBe('coordinate-out-of-range');
    }
  });

  it('is deterministic', () => {
    const a = encodeMoshiJob(CANONICAL_JOB, MOSHI_DEVICE);
    const b = encodeMoshiJob(CANONICAL_JOB, MOSHI_DEVICE);
    if (!a.ok || !b.ok) throw new Error('encode failed');
    expect(toHex(a.programs[0]?.bytes ?? new Uint8Array())).toBe(
      toHex(b.programs[0]?.bytes ?? new Uint8Array()),
    );
  });
});

// Oracle audit O8-P2-1 (ADR-705 Amendment 5): the speed byte carries whole
// mm/s for lines and whole cm/s for images (MeerK40t builder.py L392-412), so a
// set speed between steps runs at a neighbour. The bytes stay MeerK40t's; the
// job now says so when the dose leaves 95-105 %, as the rotary note does.
describe('encodeMoshiJob flat-bed speed steps', () => {
  const RASTER: RasterGroup = {
    kind: 'raster',
    layerId: 'R',
    color: '#000',
    power: 100,
    speed: 6000,
    passes: 1,
    airAssist: false,
    sValues: Uint16Array.from([1000, 0, 1000, 0]),
    pixelWidth: 4,
    pixelHeight: 1,
    bounds: { minX: 10, minY: 10, maxX: 14, maxY: 11 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };

  function encoded(group: CutGroup | RasterGroup) {
    const result = encodeMoshiJob({ groups: [group] }, MOSHI_DEVICE);
    if (!result.ok) throw new Error(result.error.kind);
    return result;
  }

  function speedNotes(group: CutGroup | RasterGroup): string[] {
    return encoded(group).notes.filter((note) => note.includes('of the set dose'));
  }

  it('says when a line speed runs a whole mm/s slower', () => {
    // 599 mm/min = 9.98 mm/s; the board runs 9 mm/s, 111 % of the dose.
    expect(speedNotes({ ...LINE, speed: 599 })).toEqual([
      'Layer L1: a Moshiboard runs lines in whole mm/s, so 9.98 mm/s runs at 9 mm/s (111 % of the set dose).',
    ]);
    // 30 mm/min = 0.5 mm/s is held at the 1 mm/s floor: half the dose.
    expect(speedNotes({ ...LINE, speed: 30 })[0]).toContain(
      'runs at 1 mm/s (50 % of the set dose)',
    );
  });

  it('says when an image speed rounds to a whole cm/s', () => {
    // 1000 mm/min = 16.7 mm/s rounds to 2 cm/s: 83 % of the dose, lighter.
    expect(speedNotes({ ...RASTER, speed: 1000 })).toEqual([
      'Layer R: a Moshiboard runs images in whole cm/s, so 16.67 mm/s runs at 20 mm/s (83 % of the set dose).',
    ]);
  });

  it('stays quiet within 5 % and keeps the bytes', () => {
    expect(speedNotes(LINE)).toEqual([]); // 25 mm/s exact
    expect(speedNotes({ ...LINE, speed: 1000 })).toEqual([]); // 16.67 -> 16, 104 %
    expect(speedNotes(RASTER)).toEqual([]); // 100 mm/s exact
    const program = decodeMoshiProgram(encoded({ ...LINE, speed: 599 }).programs[0]!.bytes);
    if (!program.ok) throw new Error(program.error);
    expect(program.program.speed).toBe(9);
  });
});
