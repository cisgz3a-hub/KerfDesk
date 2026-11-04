import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMotionManifest, type MotionManifest } from '../../../core/job/motion-manifest';
import { runWorkSteps, type WorkSteps } from '../../../core/recovery';
import { ARCHIVE_SLICE_MS, createCooperativeArchiveRunner } from './cooperative-archive-runner';
import {
  estimateExecutionArtifactBytes,
  estimateExecutionArtifactBytesSteps,
  stringBytes,
} from './execution-artifact-size';
import { utf8BytesSteps } from './execution-provenance';
import {
  isPackedMotionManifestSteps,
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

/** The per-block packing these steps replaced (ADR-337 Amendment 1), kept as
 * the oracle for the stored doubles. */
function referencePackedData(manifest: MotionManifest) {
  const kinds = ['travel', 'process', 'plunge', 'park'];
  let pointCount = 0;
  for (const block of manifest.blocks) pointCount += block.points.length;
  const blockData = new Float64Array(manifest.blocks.length * 10);
  const pointData = new Float64Array(pointCount * 3);
  let pointOffset = 0;
  manifest.blocks.forEach((block, index) => {
    blockData.set(
      [
        block.rawLineIndex,
        block.sendableLineIndex,
        kinds.indexOf(block.kind),
        pointOffset,
        block.points.length,
        block.programLineNumber === null ? 0 : 1,
        block.programLineNumber ?? 0,
        block.lengthMm,
        block.routeStartMm,
        block.routeEndMm,
      ],
      index * 10,
    );
    for (const point of block.points) {
      pointData.set([point.x, point.y, point.z], pointOffset * 3);
      pointOffset += 1;
    }
  });
  return { blockData, pointData };
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
  it('pack every block and point to the doubles the single pass stored, with checkpoints', () => {
    const manifest = buildMotionManifest(routeProgram(40_000), { machineKind: 'laser' });
    const { value: packed, yields } = drain(packMotionManifestSteps(manifest));
    const reference = referencePackedData(manifest);
    expect(
      Buffer.from(packed.blockData.buffer).equals(Buffer.from(reference.blockData.buffer)),
    ).toBe(true);
    expect(
      Buffer.from(packed.pointData.buffer).equals(Buffer.from(reference.pointData.buffer)),
    ).toBe(true);
    const again = packMotionManifest(manifest);
    expect(Buffer.from(again.pointData.buffer).equals(Buffer.from(packed.pointData.buffer))).toBe(
      true,
    );
    expect(yields).toBeGreaterThan(4);
    expect(drain(isPackedMotionManifestSteps(packed)).value).toBe(true);
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
