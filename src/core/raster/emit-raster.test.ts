import { describe, expect, it } from 'vitest';
import { emitRasterGroup, type EmitRasterInput } from './emit-raster';
import { findLongBlankFeedMoves } from '../invariants';

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

describe('emitRasterGroup — gap-rapid split (ADR-039)', () => {
  // Two ink islands (cols 0-1 and 8-9) with a 12mm white gap (cols 2-7 @ 2mm/px).
  const TWO_ISLAND = {
    sValues: new Uint16Array([100, 100, 0, 0, 0, 0, 0, 0, 100, 100]),
    width: 10,
    height: 1,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 2 },
    feedMmPerMin: 1500,
    overscanMm: 0,
  };

  it('rapids (G0) across a wide interior white gap instead of feeding S0', () => {
    const out = emitRasterGroup(makeInput(TWO_ISLAND));
    expect(out).toMatch(/^G0 X16\.000 Y1\.000 S0$/m);
    expect(out).not.toMatch(/^G1 X16\.000/m);
  });

  it('emits no long blank-feed move across the gap (clean under the P0-A invariant)', () => {
    const out = emitRasterGroup(makeInput(TWO_ISLAND));
    expect(findLongBlankFeedMoves(out, { thresholdMm: 5 })).toEqual([]);
  });

  it('keeps a small interior gap in one sweep, blanked at feed (no extra G0)', () => {
    // Ink at cols 0-1 and 4-5; white cols 2-3 = 4mm @ 2mm/px, under the 5mm split.
    const out = emitRasterGroup(
      makeInput({
        sValues: new Uint16Array([100, 100, 0, 0, 100, 100, 0, 0, 0, 0]),
        width: 10,
        height: 1,
        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 2 },
        feedMmPerMin: 1500,
        overscanMm: 0,
      }),
    );
    expect((out.match(/^G0 /gm) ?? []).length).toBe(1);
    expect(out).toMatch(/^G1 X8\.000 S0$/m);
  });
});

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
  it('emits one G0 rapid + one or more G1 per row with content', () => {
    // 2×2 image, every pixel burning — each row produces one G0
    // (rapid to active-span start) and at least one G1 (run end +
    // overscan exit).
    const out = emitRasterGroup(makeInput({ sValues: new Uint16Array([100, 100, 100, 100]) }));
    const g0s = out.match(/^G0 /gm) ?? [];
    expect(g0s.length).toBe(2); // one per row
  });

  it('skips rows that are entirely S=0 (no G0/G1 for blank rows)', () => {
    // All-white 2×2 should produce zero row data — just preamble +
    // postamble + the header comments. Saves time on blank bands
    // above/below the actual burn content of a banner image.
    const out = emitRasterGroup(makeInput({ sValues: new Uint16Array([0, 0, 0, 0]) }));
    expect((out.match(/^G0 /gm) ?? []).length).toBe(0);
  });

  it('only emits rows where at least one pixel burns', () => {
    // 4×3 image: middle row is the only one with content. Expect
    // exactly one G0 (for that row) — top and bottom rows skip.
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 3,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
        sValues: new Uint16Array([
          0,
          0,
          0,
          0, //
          0,
          500,
          500,
          0, //
          0,
          0,
          0,
          0, //
        ]),
      }),
    );
    expect((out.match(/^G0 /gm) ?? []).length).toBe(1);
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

  it('overscan adds margin to both ends of the ACTIVE span', () => {
    // Full-width burn so the active span equals the full row;
    // overscan extends 5 mm beyond bounds.minX / maxX as before.
    const out = emitRasterGroup(
      makeInput({
        bounds: { minX: 10, minY: 0, maxX: 20, maxY: 2 },
        overscanMm: 5,
        sValues: new Uint16Array([100, 100, 100, 100]),
        width: 2,
        height: 2,
      }),
    );
    // First G0 should rapid to active-start (10) - overscan (5) = 5.
    expect(out).toMatch(/G0 X5\.000 Y0\.500 S0/);
    // Last G1 of row ends at active-end (20) + overscan (5) = 25.
    expect(out).toMatch(/G1 X25\.000 S0/);
  });

  it('keeps the entry overscan dark until the active span starts', () => {
    const out = emitRasterGroup(
      makeInput({
        bounds: { minX: 10, minY: 0, maxX: 12, maxY: 1 },
        overscanMm: 5,
        width: 2,
        height: 1,
        sValues: new Uint16Array([500, 500]),
      }),
    );
    const lines = out.split('\n').filter((l) => l.startsWith('G'));
    expect(lines).toContain('G0 X5.000 Y0.500 S0');
    expect(lines).toContain('G1 X10.000 F6000 S0');
    expect(lines).toContain('G1 X12.000 S500');
    expect(lines).toContain('G1 X17.000 S0');
  });

  it('clips sweep to active span when row has leading/trailing zeros', () => {
    // 6×1 row: [0, 0, 500, 500, 0, 0]. Active span columns 2..3.
    // bounds 0..6 → active-start = 2.0, active-end = 4.0.
    // overscan 1.0 → G0 to 1.0, G1 ends at 5.0.
    const out = emitRasterGroup(
      makeInput({
        width: 6,
        height: 1,
        bounds: { minX: 0, minY: 0, maxX: 6, maxY: 1 },
        overscanMm: 1,
        sValues: new Uint16Array([0, 0, 500, 500, 0, 0]),
      }),
    );
    expect(out).toMatch(/G0 X1\.000 /);
    expect(out).toMatch(/G1 X5\.000 S0/);
    // Should NOT travel to X=7 (full-bounds + overscan) any more.
    expect(out).not.toMatch(/G1 X7\.000/);
  });

  it('alternates active raster rows so blank rows do not force return sweeps', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 3,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
        overscanMm: 1,
        sValues: new Uint16Array([
          500,
          500,
          0,
          0, //
          0,
          0,
          0,
          0, //
          0,
          0,
          700,
          700, //
        ]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion).toEqual([
      'G0 X-1.000 Y0.500 S0',
      'G1 X0.000 F6000 S0',
      'G1 X2.000 S500',
      'G1 X3.000 S0',
      'G0 X5.000 Y2.500 S0',
      'G1 X4.000 S0',
      'G1 X2.000 S700',
      'G1 X1.000 S0',
    ]);
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
    // Use a row with internal S-changes inside the active span so we
    // verify run-length compression without confusion from leading
    // zero clipping. Pattern [500, 500, 1000, 1000]: 1 run change.
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 1,
        sValues: new Uint16Array([500, 500, 1000, 1000]),
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
        overscanMm: 0,
      }),
    );
    const lines = out.split('\n');
    const g1lines = lines.filter((l) => l.startsWith('G1 '));
    // First G1: F + S500 to X=2. Second G1: S1000 to X=4. Third G1:
    // S0 exit overscan at X=4. That's 3 G1s, 3 S-emissions.
    expect(g1lines).toHaveLength(3);
    const sCount = g1lines.filter((l) => /S\d/.test(l)).length;
    expect(sCount).toBe(3);
  });

  it('clipping skips the leading S=0 run — first G1 carries the burn S', () => {
    // [0, 0, 500, 500] used to emit a leading G1 at S=0 across the
    // first half of the row. After clipping, the sweep starts at the
    // first burn pixel so the first G1 already carries S500.
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 1,
        sValues: new Uint16Array([0, 0, 500, 500]),
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
        overscanMm: 0,
      }),
    );
    const lines = out.split('\n');
    const firstG1 = lines.find((l) => l.startsWith('G1 ')) ?? '';
    expect(firstG1).toContain('S500');
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

  it('emits reverse-row S runs from right edge to left edge', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        overscanMm: 0,
        sValues: new Uint16Array([
          100,
          100,
          100,
          100, //
          100,
          100,
          500,
          500, //
        ]),
      }),
    );

    const rows = out.split('\n').filter((line) => line.startsWith('G'));
    expect(rows.slice(3, 7)).toEqual([
      'G0 X4.000 Y1.500 S0',
      'G1 X2.000 S500',
      'G1 X0.000 S100',
      'G1 X0.000 S0',
    ]);
  });
});

describe('emitRasterGroup — dot width correction', () => {
  it('shortens non-zero scan runs at both ends', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 1,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
        overscanMm: 0,
        dotWidthCorrectionMm: 0.25,
        sValues: new Uint16Array([0, 500, 500, 0]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion).toEqual([
      'G0 X1.000 Y0.500 S0',
      'G1 X1.250 F6000 S0',
      'G1 X2.750 S500',
      'G1 X3.000 S0',
    ]);
  });

  it('shortens reverse-direction non-zero scan runs symmetrically', () => {
    const out = emitRasterGroup(
      makeInput({
        width: 4,
        height: 2,
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        overscanMm: 0,
        dotWidthCorrectionMm: 0.25,
        sValues: new Uint16Array([
          500,
          500,
          0,
          0, //
          0,
          500,
          500,
          0, //
        ]),
      }),
    );

    const motion = out.split('\n').filter((line) => line.startsWith('G'));
    expect(motion.slice(4)).toEqual([
      'G0 X3.000 Y1.500 S0',
      'G1 X2.750 S0',
      'G1 X1.250 S500',
      'G1 X1.000 S0',
    ]);
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
