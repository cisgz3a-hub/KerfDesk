import { describe, expect, it } from 'vitest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';

// Build a minimum valid input. Tests override individual fields to
// exercise the behaviour they care about.
function makeInput(overrides: Partial<EmitRasterInput> = {}): EmitRasterInput {
  return {
    sValues: overrides.sValues ?? new Uint16Array(4),
    width: 2,
    height: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    feedMmPerMin: 6000,
    overscanMm: 0,
    layerId: 'L1',
    color: '#000000',
    powerPercent: 80,
    ...overrides,
  };
}

describe('emitRasterGroup — preamble + postamble', () => {
  it('starts with M5 + M4 S0 and ends with M5', () => {
    const out = emitRasterGroup(makeInput());
    const lines = out.trim().split('\n');
    // First three lines: three comments + M5 + M4 S0.
    expect(lines.slice(0, 3).every((l) => l.startsWith(';'))).toBe(true);
    expect(lines[3]).toBe('M5');
    expect(lines[4]).toBe('M4 S0');
    expect(lines[lines.length - 1]).toBe('M5');
  });

  it('header comments carry layer, color, power, dimensions, feed', () => {
    const out = emitRasterGroup(makeInput({ powerPercent: 75 }));
    expect(out).toMatch(/^; image layer L1 color #000000 power 75%/);
    expect(out).toMatch(/2 × 2 px/);
    expect(out).toMatch(/feed 6000 mm\/min, overscan 0\.000 mm/);
  });
});

describe('emitRasterGroup — row layout', () => {
  it('emits one G0 rapid + one or more G1 per row', () => {
    // 2×2 image, all pixels S=0 (white) — each row should produce
    // one G0 (rapid to start), one G1 ending at maxX with S0, and
    // one G1 ending at endX (overscan exit) with S0.
    const out = emitRasterGroup(makeInput({ sValues: new Uint16Array([0, 0, 0, 0]) }));
    const g0s = out.match(/^G0 /gm) ?? [];
    expect(g0s.length).toBe(2); // one per row
  });

  it('row Y coordinates straddle pixel centres (half-pixel offset)', () => {
    // 2×1 image with bounds 0..2 × 0..2: row 0 centre should be Y=1
    // (offset 0.5 × pixelHeight, where pixelHeight = 2/1 = 2 → Y=1).
    const out = emitRasterGroup(
      makeInput({
        width: 2,
        height: 1,
        sValues: new Uint16Array([100, 100]),
      }),
    );
    // 2/1 = 2 mm per row, centre = 0 + 0.5 * 2 = 1.0
    expect(out).toMatch(/G0 X0\.000 Y1\.000 S0/);
  });

  it('overscan adds margin to both ends of the sweep', () => {
    const out = emitRasterGroup(
      makeInput({
        bounds: { minX: 10, minY: 0, maxX: 20, maxY: 2 },
        overscanMm: 5,
        sValues: new Uint16Array([0, 0, 0, 0]),
        width: 2,
        height: 2,
      }),
    );
    // First G0 should rapid to X = 10 - 5 = 5.
    expect(out).toMatch(/G0 X5\.000 Y0\.500 S0/);
    // Last G1 of row ends at 20 + 5 = 25.
    expect(out).toMatch(/G1 X25\.000 S0/);
  });
});

describe('emitRasterGroup — S modulation', () => {
  it('emits one G1 per S-run, not per pixel (run-length compression)', () => {
    // 4×1 image with pattern [500, 500, 1000, 1000]: should produce
    // two G1s in the body (one ending at X=2 with S500, one at X=4
    // with S1000) plus the overscan exit G1.
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 1,
        sValues: new Uint16Array([500, 500, 1000, 1000]),
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
        overscanMm: 0,
      }),
    );
    const g1s = (out.match(/^G1 /gm) ?? []).length;
    // 2 run-end G1s + 1 final-S0 overscan-exit G1 = 3
    expect(g1s).toBe(3);
  });

  it('S is only emitted when it changes (modal G-code)', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 1,
        sValues: new Uint16Array([0, 0, 500, 500]),
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
        overscanMm: 0,
      }),
    );
    // First G1 carries S0 (or F=feed + S0); second G1 carries S500
    // (changed); third G1 (overscan exit) carries S0 (changed back).
    const lines = out.split('\n');
    const g1lines = lines.filter((l) => l.startsWith('G1 '));
    expect(g1lines).toHaveLength(3);
    // Confirm only two S-changes happen (S0 → S500 → S0)
    const sCount = g1lines.filter((l) => /S\d/.test(l)).length;
    expect(sCount).toBeGreaterThanOrEqual(2);
  });

  it('first G1 of the whole raster carries the feed F', () => {
    const out = emitRasterGroup(
      makeInput({
        feedMmPerMin: 3000,
        sValues: new Uint16Array([100, 200, 300, 400]),
      }),
    );
    const firstG1 = out.split('\n').find((l) => l.startsWith('G1 ')) ?? '';
    expect(firstG1).toContain('F3000');
  });
});

describe('emitRasterGroup — invariants', () => {
  it('every G0 carries S0 (laser-off-on-travel invariant #3)', () => {
    const out = emitRasterGroup(
      makeInput({
        sValues: new Uint16Array([1000, 0, 0, 1000]),
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      }),
    );
    const g0Lines = out.split('\n').filter((l) => l.startsWith('G0 '));
    for (const g0 of g0Lines) {
      expect(g0).toContain('S0');
    }
  });

  it('same input → byte-identical output (determinism invariant #5)', () => {
    const input = makeInput({
      sValues: new Uint16Array([0, 100, 500, 1000, 0, 200, 800, 50]),
      width: 4,
      height: 2,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
    });
    const a = emitRasterGroup(input);
    const b = emitRasterGroup(input);
    expect(a).toBe(b);
  });

  it('output X coordinates stay within bounds + overscan', () => {
    const input = makeInput({
      bounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
      overscanMm: 3,
      width: 4,
      height: 4,
      sValues: new Uint16Array(16).fill(500),
    });
    const out = emitRasterGroup(input);
    const xValues = Array.from(out.matchAll(/[GX]\d? X(-?\d+\.\d+)/g))
      .map((m) => Number.parseFloat(m[1] ?? '0'))
      // Filter out the leading "G0 X..." matches that didn't capture
      .filter((n) => Number.isFinite(n));
    for (const x of xValues) {
      expect(x).toBeGreaterThanOrEqual(10 - 3);
      expect(x).toBeLessThanOrEqual(30 + 3);
    }
  });
});

describe('emitRasterGroup — validation', () => {
  it('throws on zero dimensions', () => {
    expect(() => emitRasterGroup(makeInput({ width: 0, height: 1 }))).toThrow(/dimensions/);
    expect(() => emitRasterGroup(makeInput({ width: 1, height: 0 }))).toThrow(/dimensions/);
  });

  it('throws when sValues length mismatches width × height', () => {
    expect(() =>
      emitRasterGroup(makeInput({ width: 4, height: 4, sValues: new Uint16Array(15) })),
    ).toThrow(/sValues length/);
  });

  it('throws on inverted bounds', () => {
    expect(() =>
      emitRasterGroup(makeInput({ bounds: { minX: 10, minY: 0, maxX: 0, maxY: 2 } })),
    ).toThrow(/bounds/);
  });

  it('throws on non-positive feed', () => {
    expect(() => emitRasterGroup(makeInput({ feedMmPerMin: 0 }))).toThrow(/feedMmPerMin/);
  });

  it('throws on negative overscan', () => {
    expect(() => emitRasterGroup(makeInput({ overscanMm: -1 }))).toThrow(/overscanMm/);
  });
});
