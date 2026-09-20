// The compact motion spelling for raster rows (ADR-332).
//
// Every other suite in this directory exercises the verbose default, so this
// file owns the compact path: what it emits, that it means the same thing, and
// that it is materially smaller. "Means the same thing" is checked by parsing
// both spellings with the shared modal reader the Inspector, the estimator and
// the executable plan all use, then comparing the motion they produce.
//
// NOT verified here: a physical machine. The spelling rests on grbl 1.1's
// parser (whitespace discarded on receive; a block with axis words and no
// motion word executes in the current motion mode) and on our own readers.

import { describe, expect, it } from 'vitest';
import { buildMotionManifest } from '../job/motion-manifest-parser';
import type { MotionBlock } from '../job/motion-manifest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';

function checkerRow(overrides: Partial<EmitRasterInput> = {}): EmitRasterInput {
  const width = 12;
  const height = 2;
  return {
    sValues: Uint16Array.from({ length: width * height }, (_, i) => (i % 2 === 0 ? 1000 : 0)),
    width,
    height,
    bounds: { minX: 0, minY: 0, maxX: 1.2, maxY: 0.2 },
    feedMmPerMin: 3000,
    overscanMm: 0.5,
    ...overrides,
  };
}

/** A photo-like dither: long and short runs mixed, deterministic. */
function ditheredImage(compact: boolean): string {
  const width = 400;
  const height = 20;
  let seed = 7;
  const values = Uint16Array.from({ length: width * height }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % 5 === 0 ? 0 : seed % 1000;
  });
  return emitRasterGroup({
    sValues: values,
    width,
    height,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 2 },
    feedMmPerMin: 3000,
    overscanMm: 2,
    compactMotionWords: compact,
  });
}

function motionBlocks(gcode: string): ReadonlyArray<MotionBlock> {
  return buildMotionManifest(gcode, { machineKind: 'laser' }).blocks;
}

function byteLength(gcode: string): number {
  return new TextEncoder().encode(gcode).byteLength;
}

describe('raster compact motion spelling (ADR-332)', () => {
  it('holds the modal motion word, the modal power and the trailing zeros', () => {
    const compact = emitRasterGroup(checkerRow({ compactMotionWords: true }));

    // The rapid states everything; the runway G1 holds its S0; the burn moves
    // hold the G1 and only restate S when the power changes.
    expect(compact).toContain(
      ['G0X-0.5Y0.05S0', 'G1X0F3000', 'X0.1S1000', 'X0.2S0', 'X0.3S1000'].join('\n'),
    );
    expect(compact).not.toContain('X0.100');
    expect(compact).not.toContain('G1 X');
  });

  it('keeps the verbose spelling by default, byte for byte', () => {
    const verbose = emitRasterGroup(checkerRow());

    expect(verbose).toContain(
      ['G0 X-0.500 Y0.050 S0', 'G1 X0.000 F3000 S0', 'G1 X0.100 S1000'].join('\n'),
    );
    expect(emitRasterGroup(checkerRow({ compactMotionWords: false }))).toBe(verbose);
  });

  it('never emits a power-only block: the row exit keeps its axis word', () => {
    // No lead-out and no dot-width correction puts the exit move exactly where
    // the last burn ended, which is the only place an axis word could vanish.
    const compact = emitRasterGroup(
      checkerRow({ compactMotionWords: true, overscanMm: 0, dotWidthCorrectionMm: 0 }),
    );

    for (const line of compact.split('\n')) {
      if (line.startsWith(';') || line === '') continue;
      expect(line, line).not.toMatch(/^S-?[\d.]+$/);
    }
    // The last burn ends at X1.1 and the exit move stays there: it restates
    // the axis word rather than collapsing to a bare `S0`.
    expect(compact).toContain('X1.1S1000\nX1.1S0');
  });

  it('commands exactly the same motion as the verbose spelling', () => {
    const compactBlocks = motionBlocks(ditheredImage(true));
    const verboseBlocks = motionBlocks(ditheredImage(false));

    expect(compactBlocks).toHaveLength(verboseBlocks.length);
    expect(compactBlocks.length).toBeGreaterThan(1_000);
    for (let i = 0; i < verboseBlocks.length; i += 1) {
      const compactBlock = compactBlocks[i];
      const verboseBlock = verboseBlocks[i];
      expect(compactBlock?.points, `block ${i}`).toEqual(verboseBlock?.points);
      expect(compactBlock?.kind, `block ${i}`).toBe(verboseBlock?.kind);
      expect(compactBlock?.lengthMm, `block ${i}`).toBeCloseTo(verboseBlock?.lengthMm ?? -1, 9);
    }
  });

  it('cuts a third or more off a dithered image', () => {
    const verboseBytes = byteLength(ditheredImage(false));
    const compactBytes = byteLength(ditheredImage(true));

    const savedFraction = (verboseBytes - compactBytes) / verboseBytes;

    // Bounded rather than pinned: the exact totals move with unrelated emitter
    // edits (a header comment, an overscan default), while a collapse in the
    // saving is what this guards.
    expect(verboseBytes).toBeGreaterThan(50_000);
    expect(savedFraction).toBeGreaterThan(0.33);
    expect(savedFraction).toBeLessThan(0.6);
  });
});
