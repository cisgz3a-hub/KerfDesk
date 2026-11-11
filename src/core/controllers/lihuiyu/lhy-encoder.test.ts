// LHYMicro-GL encoder goldens (ADR-703), decoded back by the simulator's
// decoder (a reimplementation of MeerK40t's parser) to the moves and beam
// states the job asked for. NOT hardware-verified: these pin the encoder's
// own output and its agreement with MeerK40t's grammar, nothing more.

import { describe, expect, it } from 'vitest';
import { LhyDecoder, type LhyDecodedMove } from '../../../__fixtures__/controllers/lihuiyu-decoder';
import type { CutGroup, Job, RasterGroup } from '../../job';
import { encodeLhyJob, lhyBoardSetting, type LhyEncodeOptions } from './lhy-encoder';
import { encodeLhyFrame, lhyFootprint } from './lhy-frame';
import { mmToLhySteps } from './lhy-motion-plan';

const M2: LhyEncodeOptions = { board: lhyBoardSetting('M2'), fullPowerPerMille: 1000 };
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function cut(
  polyline: ReadonlyArray<{ x: number; y: number }>,
  extra: Partial<CutGroup> = {},
): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power: 100,
    speed: 900,
    passes: 1,
    airAssist: false,
    segments: [{ polyline, closed: false }],
    ...extra,
  };
}

const SQUARE = cut([
  { x: 20, y: 20 },
  { x: 30, y: 20 },
  { x: 30, y: 30 },
  { x: 20, y: 30 },
  { x: 20, y: 20 },
]);

function decode(stream: Uint8Array): LhyDecoder {
  const decoder = new LhyDecoder();
  decoder.writeStream(stream);
  return decoder;
}

function ends(moves: ReadonlyArray<LhyDecodedMove>): Array<[number, number, number, number]> {
  return moves.map((m) => [m.from.x, m.from.y, m.to.x, m.to.y]);
}

describe('encodeLhyJob', () => {
  it('writes the golden stream for a 10 mm square at 15 mm/s', () => {
    const result = encodeLhyJob({ groups: [SQUARE] }, M2);
    if (!result.ok) throw new Error(result.error.kind);
    // The program line matches MeerK40t's own test .egv rectangle
    // (test_drivers_lihuiyu.py egv_rect) except the declared vertical
    // direction, which only names the board's resting direction.
    expect(text(result.stream)).toBe(
      'IBzzzvRzzzvS1P\n' +
        'ICV2490731016000027CNRBS1EDz139Rz139Tz139Lz139FNSE-\n' +
        'ITzzzvLzzzvS1P\n',
    );
  });

  it('decodes to the square burned with the beam on and every travel dark', () => {
    const result = encodeLhyJob({ groups: [SQUARE] }, M2);
    if (!result.ok) throw new Error(result.error.kind);
    const decoder = decode(result.stream);
    expect(ends(decoder.burns())).toEqual([
      [787, 787, 1181, 787],
      [1181, 787, 1181, 1181],
      [1181, 1181, 787, 1181],
      [787, 1181, 787, 787],
    ]);
    expect(decoder.moves.filter((m) => !m.laser)).toHaveLength(2);
    // The head returns to where the stream started.
    expect([decoder.x, decoder.y]).toEqual([0, 0]);
  });

  it('burns a diagonal as grouped runs that end on the rounded target', () => {
    const line = cut([
      { x: 0, y: 0 },
      { x: 7.3, y: 2.9 },
    ]);
    const result = encodeLhyJob({ groups: [line] }, M2);
    if (!result.ok) throw new Error(result.error.kind);
    const burns = decode(result.stream).burns();
    const last = burns[burns.length - 1];
    expect(last?.to).toEqual({ x: mmToLhySteps(7.3), y: mmToLhySteps(2.9) });
    // Every corner of the grouped runs lies within one step of the true line.
    const [tx, ty] = [mmToLhySteps(7.3), mmToLhySteps(2.9)];
    const offLine = (p: { x: number; y: number }): number =>
      Math.abs(p.x * ty - p.y * tx) / Math.hypot(tx, ty);
    expect(burns.length).toBeGreaterThan(2);
    expect(Math.max(...burns.map((m) => offLine(m.to)))).toBeLessThanOrEqual(1);
  });

  it('starts from the head and returns to it', () => {
    const start = { x: 100, y: 50 };
    const result = encodeLhyJob({ groups: [SQUARE] }, { ...M2, start });
    if (!result.ok) throw new Error(result.error.kind);
    const decoder = new LhyDecoder();
    decoder.x = start.x;
    decoder.y = start.y;
    decoder.writeStream(result.stream);
    expect(decoder.burns()[0]?.from).toEqual({ x: 787, y: 787 });
    expect([decoder.x, decoder.y]).toEqual([100, 50]);
  });

  it('runs image rows as alternating sweeps that burn only lit pixels', () => {
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'IMG',
      color: '#000000',
      power: 100,
      speed: 6000,
      passes: 1,
      airAssist: false,
      sValues: Uint16Array.of(0, 1000, 1000, 0, 1000, 0, 0, 1000),
      pixelWidth: 4,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };
    const result = encodeLhyJob({ groups: [raster] }, M2);
    if (!result.ok) throw new Error(result.error.kind);
    const x = (mm: number): number => mmToLhySteps(mm);
    expect(ends(decode(result.stream).burns())).toEqual([
      [x(1), x(0.5), x(3), x(0.5)],
      [x(4), x(1.5), x(3), x(1.5)],
      [x(1), x(1.5), x(0), x(1.5)],
    ]);
  });

  it('sends M3 PWM power as AT1 packets, one per power change', () => {
    const job: Job = {
      groups: [
        SQUARE,
        { ...SQUARE, layerId: 'L2', power: 50 },
        { ...SQUARE, layerId: 'L3', power: 50 },
      ],
    };
    const result = encodeLhyJob(job, { board: lhyBoardSetting('M3-pwm'), fullPowerPerMille: 300 });
    if (!result.ok) throw new Error(result.error.kind);
    expect(decode(result.stream).pwmPowers).toEqual([300, 150]);
  });

  it('leaves out 0 % layers and refuses CNC and angled images', () => {
    const skipped = encodeLhyJob({ groups: [SQUARE, { ...SQUARE, layerId: 'OFF', power: 0 }] }, M2);
    expect(skipped.ok && skipped.zeroPowerLayers).toEqual(['OFF']);
    const angled = encodeLhyJob(
      { groups: [{ ...(SQUARE as unknown as RasterGroup), kind: 'raster', scanAngleDeg: 45 }] },
      M2,
    );
    expect(angled.ok ? null : angled.error.kind).toBe('angled-raster-unsupported');
    expect(encodeLhyJob({ groups: [] }, M2).ok).toBe(false);
  });

  it('is deterministic', () => {
    const a = encodeLhyJob({ groups: [SQUARE] }, M2);
    const b = encodeLhyJob({ groups: [SQUARE] }, M2);
    expect(a.ok && b.ok && text(a.stream) === text(b.stream)).toBe(true);
  });
});

describe('encodeLhyFrame', () => {
  it('traces the footprint with the beam never on and returns to the start', () => {
    const result = encodeLhyJob({ groups: [SQUARE] }, M2);
    if (!result.ok) throw new Error(result.error.kind);
    const footprint = lhyFootprint(result.motion, { x: 0, y: 0 });
    if (footprint === null) throw new Error('no footprint');
    const frame = encodeLhyFrame(footprint, M2.board, 3000);
    expect(text(frame)).not.toContain('D');
    const decoder = decode(frame);
    expect(decoder.moves.every((m) => !m.laser)).toBe(true);
    const visited = decoder.moves.map((m) => [m.to.x, m.to.y]);
    expect(visited).toEqual(
      expect.arrayContaining([
        [787, 787],
        [1181, 787],
        [1181, 1181],
        [787, 1181],
      ]),
    );
    expect([decoder.x, decoder.y]).toEqual([0, 0]);
  });
});
