import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MotionBlockColumnData } from '../../../core/job/motion-block-columns';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import { runWorkSteps, type WorkSteps } from '../../../core/recovery';
import { ARCHIVE_SLICE_MS, createCooperativeArchiveRunner } from './cooperative-archive-runner';
import {
  estimateExecutionArtifactBytes,
  estimateExecutionArtifactBytesSteps,
  stringBytes,
} from './execution-artifact-size';
import { utf8BytesSteps } from './execution-provenance';
import {
  isPackedMotionManifest,
  isPackedMotionManifestSteps,
  packedMotionManifestBytes,
  packedMotionManifestBytesSteps,
  packMotionManifest,
  packMotionManifestSteps,
} from './packed-motion-manifest';

function drain<T>(steps: WorkSteps<T>): { readonly value: T; readonly yields: number } {
  let yields = 0;
  for (;;) {
    const step = steps.next();
    if (step.done) return { value: step.value, yields };
    yields += 1;
  }
}

/** A copy of `column` whose last entry is `value`. */
function withLast<T extends Float64Array | Uint32Array | Uint8Array>(column: T, value: number): T {
  const copy = column.slice() as T;
  copy[copy.length - 1] = value;
  return copy;
}

function routeProgram(moves: number): string {
  const lines = ['G21', 'G90', 'M4 S0'];
  for (let i = 0; i < moves; i += 1) {
    lines.push(
      i % 7 === 0
        ? `G0 X${i % 250} Y${(i * 3) % 170}`
        : `N${i} G1 X${(i * 1.25) % 250} Y${(i * 0.5) % 170} S${i % 900}`,
    );
    if (i % 501 === 0) lines.push(`G2 X${i % 250} Y${(i * 3) % 170} I1.5 J0`);
  }
  lines.push('M5', 'G0 X0 Y0');
  return lines.join('\n');
}

describe('archive work steps', () => {
  it('validate packed columns with checkpoints, finding a fault past the first one', () => {
    const manifest = buildMotionManifest(routeProgram(40_000), { machineKind: 'laser' });
    const packed = packMotionManifest(manifest);
    const { value: valid, yields } = drain(isPackedMotionManifestSteps(packed));
    expect(valid).toBe(true);
    expect(isPackedMotionManifest(packed)).toBe(true);
    expect(yields).toBeGreaterThanOrEqual(2);
    const last = packed.columns.count - 1;
    const faults: Array<(columns: MotionBlockColumnData) => MotionBlockColumnData> = [
      (columns) => ({ ...columns, x: withLast(columns.x, Number.NaN) }),
      (columns) => ({ ...columns, rawLine: withLast(columns.rawLine, 0) }),
      (columns) => ({ ...columns, kind: withLast(columns.kind, 0x7f) }),
    ];
    for (const fault of faults) {
      const broken = { ...packed, columns: fault(packed.columns) };
      expect(broken.columns.count).toBe(last + 1);
      expect(drain(isPackedMotionManifestSteps(broken)).value).toBe(false);
    }
  });

  it('bound a validation step by points as well as blocks, as a photo needs', () => {
    // Few blocks, each with many sampled points, like a photo's scan lines.
    const circles = ['G21', 'G90', 'G0 X0 Y0', 'M4 S0'];
    for (let i = 0; i < 1_200; i += 1) circles.push('G2 X0 Y0 I60 J0 S500');
    const packed = packMotionManifest(
      buildMotionManifest(circles.join('\n'), { machineKind: 'laser' }),
    );
    expect(packed.columns.count).toBeLessThan(1 << 14);
    const points = packed.columns.x.length;
    expect(points).toBeGreaterThan(4 * (1 << 14));
    const { value, yields } = drain(isPackedMotionManifestSteps(packed));
    expect(value).toBe(true);
    expect(yields).toBeGreaterThanOrEqual(Math.floor(points / (1 << 14)));
  });

  it('measure object blocks as the columns they would become, with checkpoints', () => {
    const manifest = buildMotionManifest(routeProgram(40_000), { machineKind: 'laser' });
    const objects = { ...manifest, blocks: Array.from(manifest.blocks) };
    const { value: bytes, yields } = drain(packedMotionManifestBytesSteps(objects));
    expect(bytes).toBe(packedMotionManifestBytes(manifest));
    expect(packedMotionManifestBytes(objects)).toBe(bytes);
    expect(yields).toBeGreaterThan(1);
    // Columns the parser built are stored as they are: nothing to walk.
    expect(drain(packMotionManifestSteps(manifest)).yields).toBe(0);
  });

  it('encode UTF-8 exactly as TextEncoder does, never splitting a surrogate pair', () => {
    const chunk = 1 << 18;
    const pair = '😀';
    const atBoundary = `${'a'.repeat(chunk - 1)}${pair}${'b'.repeat(chunk)}`;
    const loneHigh = `${'a'.repeat(chunk - 1)}\ud83d${'c'.repeat(chunk + 3)}`;
    const loneLow = `${'a'.repeat(chunk)}\ude00${'é'.repeat(chunk)}`;
    for (const value of [atBoundary, loneHigh, loneLow, 'G1 X1\n', '']) {
      const { value: bytes } = drain(utf8BytesSteps(value));
      expect(Buffer.from(bytes).equals(Buffer.from(new TextEncoder().encode(value)))).toBe(true);
    }
    expect(drain(utf8BytesSteps(atBoundary)).yields).toBeGreaterThan(2);
  });

  it('encode arbitrary text as TextEncoder does', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (value) => {
        const bytes = runWorkSteps(utf8BytesSteps(value));
        expect(Buffer.from(bytes).equals(Buffer.from(new TextEncoder().encode(value)))).toBe(true);
      }),
    );
  });

  it('measure an archive-shaped value as the single walk does, a program scan at a time', () => {
    const gcode = routeProgram(30_000);
    const wide = `${gcode}\n; café`;
    const manifest = buildMotionManifest(gcode, { machineKind: 'laser' });
    const value = { gcode, wide, manifest, packed: packMotionManifest(manifest), list: [1, 'a'] };
    const { value: bytes, yields } = drain(estimateExecutionArtifactBytesSteps(value));
    expect(bytes).toBe(estimateExecutionArtifactBytes(value));
    expect(stringBytes(wide)).toBe(wide.length * 3);
    expect(yields).toBeGreaterThan(10);
    const bounded = drain(estimateExecutionArtifactBytesSteps(value, 1_000)).value;
    expect(bounded).toBe(estimateExecutionArtifactBytes(value, 1_000));
  });
});

async function settledWithinMicrotasks(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  for (let i = 0; i < 200; i += 1) await Promise.resolve();
  return settled;
}

function* counting(steps: number, onStep: () => void = () => undefined): WorkSteps<number> {
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    total += i;
    onStep();
    yield;
  }
  return total;
}

describe('cooperative archive runner', () => {
  it('returns what one call returns, resuming on a later task once a slice is spent', async () => {
    let clock = 0;
    const runner = createCooperativeArchiveRunner(() => clock);
    // Each step costs a quarter of a slice on this clock.
    const run = Promise.resolve(runner.run(counting(40, () => (clock += ARCHIVE_SLICE_MS / 4))));
    expect(await settledWithinMicrotasks(run)).toBe(false);
    expect(await run).toBe(runWorkSteps(counting(40)));
    runner.close();
  });

  it('runs straight through while a slice lasts', async () => {
    const runner = createCooperativeArchiveRunner(() => 0);
    const run = Promise.resolve(runner.run(counting(1_000)));
    expect(await settledWithinMicrotasks(run)).toBe(true);
    expect(await run).toBe(runWorkSteps(counting(1_000)));
    runner.close();
  });

  it('still finishes a run that starts after close', async () => {
    let clock = 0;
    const runner = createCooperativeArchiveRunner(() => (clock += ARCHIVE_SLICE_MS));
    runner.close();
    expect(await runner.run(counting(3))).toBe(3);
  });
});
