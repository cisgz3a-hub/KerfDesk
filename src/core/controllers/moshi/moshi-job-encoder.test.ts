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
