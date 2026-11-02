// Performance audit S1-P1-1 (ADR-676 Amendment 3): a Marlin Pause reads the
// program's beam facts from a table built once per stream, and decides exactly
// as the old whole-program scan did.
import { describe, expect, it } from 'vitest';
import {
  scannedMarlinStreamPauseBeam,
  scannedMarlinStreamPauseOffLinesFrom,
} from '../../../__fixtures__/controllers/marlin-stream-pause-beam-scan';
import { toMarlinFanGcode } from '../../output/marlin-fan-transform';
import { toMarlinInlineGcode } from '../../output/marlin-inline-transform';
import { createStreamer } from '../grbl';
import {
  carryMarlinStreamPauseBeam,
  marlinStreamPauseOffLinesFrom,
  planMarlinStreamPauseBeam,
  prepareMarlinStreamPauseBeam,
  prepareMarlinStreamPauseBeamSlice,
} from './stream-pause-beam';
import { INLINE_STRIDE } from './stream-pause-beam-index';

/** A GRBL-shaped raster: per row a travel, then burns at varying power. With
 * several layers, each re-arms with its own M3/M4 (the inline transform writes
 * `M5 I` + `M3 I S0` there). */
function rasterBody(rows: number, cols: number, layers = 1): string {
  const out = ['G21', 'G90'];
  for (let layer = 0; layer < layers; layer += 1) {
    out.push(layer % 2 === 0 ? 'M4 S0' : 'M3 S0');
    for (let row = 0; row < rows; row += 1) {
      out.push(`G0 X0.000 Y${(row * 0.1).toFixed(3)} S0`);
      for (let col = 1; col <= cols; col += 1) {
        // Some runs repeat their power, so later burn moves carry none.
        const power = (row * 7 + col * 13 + layer) % 5 === 0 ? 0 : ((row + col) % 4) * 250;
        const s = col % 3 === 0 ? '' : ` S${power}`;
        out.push(`G1 X${(col * 0.1).toFixed(3)}${col === 1 ? ' F3000' : ''}${s}`);
      }
    }
    out.push('M5');
  }
  return out.join('\n');
}

function queued(gcode: string): ReadonlyArray<string> {
  return createStreamer(gcode).queued;
}

const FAN = queued(toMarlinFanGcode(rasterBody(22, 30), 1000));
const INLINE = queued(toMarlinInlineGcode(rasterBody(12, 20, 3)));

// Hand-placed lines the transforms never write, each a case the old scan
// read: comments, lower case, bare M106, M106 S0, plain M3/M5 inside inline
// mode, a G1 with an I word, and switches between the two dialects.
const ODD_LINES = [
  'M106\n',
  'M106 S0\n',
  'm106 s40\n',
  'G1 X1 ; M106 S200\n',
  '(M3 I) G1 X2\n',
  'M3 I S0\n',
  'M4 I\n',
  'M5 I\n',
  'M5\n',
  'M3 S90\n',
  'M3\n',
  'G1 X3 S30\n',
  'G1 X4\n',
  'G1 X5 I\n',
  'G2 X6 Y1 I1 J0\n',
  'G0 X7\n',
  'M107\n',
  'M107 ; off\n',
  'G28 X\n',
  'M400\n',
  'G1 Y2 F600\n',
];

/** A mixed program from a fixed seed, long enough to cross many checkpoints. */
function mixedProgram(length: number, seed: number): ReadonlyArray<string> {
  let state = seed;
  const lines: string[] = [];
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    lines.push(ODD_LINES[state % ODD_LINES.length] ?? '');
  }
  return lines;
}

function expectSameAsScanAtEveryIndex(lines: ReadonlyArray<string>): void {
  for (let index = -1; index <= lines.length + 1; index += 1) {
    expect(planMarlinStreamPauseBeam(lines, index), `plan at ${index}`).toEqual(
      scannedMarlinStreamPauseBeam(lines, index),
    );
    expect(marlinStreamPauseOffLinesFrom(lines, index), `off lines at ${index}`).toEqual(
      scannedMarlinStreamPauseOffLinesFrom(lines, index),
    );
  }
}

/** Counts every line read, whatever reads it. */
function counted(lines: ReadonlyArray<string>): {
  readonly lines: ReadonlyArray<string>;
  readonly reads: () => number;
  readonly reset: () => void;
} {
  let reads = 0;
  const proxy = new Proxy(lines, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { lines: proxy, reads: () => reads, reset: () => (reads = 0) };
}

describe(
  'the indexed Pause beam decision matches the whole-program scan',
  { timeout: 60_000 },
  () => {
    it('on a fan program, at every index', () => {
      expect(FAN.length).toBeGreaterThan(4 * INLINE_STRIDE);
      expectSameAsScanAtEveryIndex(FAN);
    });

    it('on an inline program with three layers, at every index', () => {
      expect(INLINE.length).toBeGreaterThan(2 * INLINE_STRIDE);
      expectSameAsScanAtEveryIndex(INLINE);
    });

    it('on mixed fan and inline programs, at every index', () => {
      for (const seed of [1, 7, 42]) expectSameAsScanAtEveryIndex(mixedProgram(1100, seed));
    });

    it('on short programs and an empty one', () => {
      expectSameAsScanAtEveryIndex([]);
      expectSameAsScanAtEveryIndex(['M3 I S0\n', 'G1 X1 S50\n', 'G1 X2\n']);
      expectSameAsScanAtEveryIndex(['M106 S80\n', 'G1 X1\n', 'M107\n']);
    });

    it('while the slices behind Start have read only part of the stream', () => {
      for (const program of [FAN, INLINE, mixedProgram(1100, 3)]) {
        // The plan reads only as far as its position. Slices of 60 facts and 40
        // replayed lines every 50 positions run ahead of it and fall behind it.
        const ascending = [...program];
        let unfinished = 0;
        for (let position = 0; position <= ascending.length; position += 1) {
          expect(planMarlinStreamPauseBeam(ascending, position)).toEqual(
            scannedMarlinStreamPauseBeam(ascending, position),
          );
          if (position % 50 === 0 && !prepareMarlinStreamPauseBeamSlice(ascending, 60, 40)) {
            unfinished += 1;
          }
        }
        expect(unfinished).toBeGreaterThan(0);
        // The off lines read every fact, and replay only as far as the position.
        const descending = [...program];
        for (let slice = 0; slice < 3; slice += 1)
          prepareMarlinStreamPauseBeamSlice(descending, 60, 40);
        for (let position = descending.length; position >= 0; position -= 1) {
          expect(marlinStreamPauseOffLinesFrom(descending, position)).toEqual(
            scannedMarlinStreamPauseOffLinesFrom(descending, position),
          );
        }
      }
    });

    it('after Resume restated a burn move, at every index of the new stream', () => {
      let restatedPauses = 0;
      for (let pause = 0; pause < INLINE.length && restatedPauses < 4; pause += 11) {
        const restated = planMarlinStreamPauseBeam(INLINE, pause).restatedLine;
        if (restated === null) continue;
        restatedPauses += 1;
        const next = [...INLINE];
        next[pause + restated.offset] = restated.line;
        carryMarlinStreamPauseBeam(INLINE, next);
        expectSameAsScanAtEveryIndex(next);
      }
      expect(restatedPauses).toBe(4);
    });
  },
);

describe('a Pause on a 700k-line program does no per-line work', { timeout: 60_000 }, () => {
  function pauseReads(program: ReadonlyArray<string>, positions: ReadonlyArray<number>): number {
    const stream = counted(program);
    prepareMarlinStreamPauseBeam(stream.lines);
    let most = 0;
    for (const position of positions) {
      stream.reset();
      marlinStreamPauseOffLinesFrom(stream.lines, position);
      planMarlinStreamPauseBeam(stream.lines, position);
      most = Math.max(most, stream.reads());
    }
    return most;
  }

  it('reads at most a few lines on the fan dialect, wherever the stream is', () => {
    const fan = queued(toMarlinFanGcode(rasterBody(1300, 350), 1000));
    expect(fan.length).toBeGreaterThan(700_000);
    const positions = [0, 1, 1000, 350_000, fan.length - 2, fan.length];
    // The held fan line, and the next line for the restore.
    expect(pauseReads(fan, positions)).toBeLessThanOrEqual(3);
  });

  it('replays at most one checkpoint stride on the inline dialect', () => {
    const inline = queued(toMarlinInlineGcode(rasterBody(2000, 350)));
    expect(inline.length).toBeGreaterThan(700_000);
    const positions = [1, INLINE_STRIDE - 1, 350_000 + INLINE_STRIDE - 1, inline.length - 1];
    // Twice the stride (the off lines and the plan each replay), and the
    // restated burn move's short look ahead.
    expect(pauseReads(inline, positions)).toBeLessThanOrEqual(2 * INLINE_STRIDE + 8);
  });
});
