import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import {
  contourEntryPoint,
  contourEntryRunwayMm,
  contourExitPoint,
  contourExitRunwayMm,
} from './contour-entry';

describe('contourEntryRunwayMm', () => {
  it('applies the ADR-234 length formula on the 4040-safe profile', () => {
    expect(contourEntryRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 5)).toBe(5);
    expect(contourEntryRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 2)).toBe(2);
  });

  it('caps the entry at the 5 mm gap threshold', () => {
    expect(contourEntryRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 12)).toBe(5);
  });

  it('honors the operator disabling overscan', () => {
    expect(contourEntryRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 0)).toBeUndefined();
    expect(contourEntryRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, -3)).toBeUndefined();
  });

  it('keeps every non-4040 profile on legacy contour emission', () => {
    expect(contourEntryRunwayMm(DEFAULT_DEVICE_PROFILE, 5)).toBeUndefined();
  });
});

describe('contourEntryPoint', () => {
  it('backs off along the first edge direction', () => {
    expect(
      contourEntryPoint(
        [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        5,
      ),
    ).toEqual({ x: 5, y: 10 });
  });

  it('normalizes diagonal first edges', () => {
    const entry = contourEntryPoint(
      [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      5,
    );
    expect(entry?.x).toBeCloseTo(-3, 9);
    expect(entry?.y).toBeCloseTo(-4, 9);
  });

  it('skips degenerate leading edges to find a real tangent', () => {
    expect(
      contourEntryPoint(
        [
          { x: 10, y: 10 },
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        5,
      ),
    ).toEqual({ x: 5, y: 10 });
  });

  it('bounds the entry by the room left before the bed edge', () => {
    const bed = { widthMm: 400, heightMm: 400 };
    expect(
      contourEntryPoint(
        [
          { x: 1, y: 10 },
          { x: 2, y: 10 },
        ],
        5,
        bed,
      ),
    ).toEqual({ x: 0, y: 10 });
    expect(
      contourEntryPoint(
        [
          { x: 399, y: 10 },
          { x: 390, y: 10 },
        ],
        5,
        bed,
      ),
    ).toEqual({ x: 400, y: 10 });
  });

  it('skips the entry when no bed room remains', () => {
    const bed = { widthMm: 400, heightMm: 400 };
    expect(
      contourEntryPoint(
        [
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
        5,
        bed,
      ),
    ).toBeNull();
  });

  it('leaves the entry unbounded without a bed', () => {
    expect(
      contourEntryPoint(
        [
          { x: 1, y: 10 },
          { x: 2, y: 10 },
        ],
        5,
      ),
    ).toEqual({ x: -4, y: 10 });
  });

  it('returns null when no edge defines a direction', () => {
    expect(contourEntryPoint([{ x: 10, y: 10 }], 5)).toBeNull();
    expect(
      contourEntryPoint(
        [
          { x: 10, y: 10 },
          { x: 10, y: 10 },
        ],
        5,
      ),
    ).toBeNull();
    expect(
      contourEntryPoint(
        [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        0,
      ),
    ).toBeNull();
  });
});

describe('contourExitRunwayMm (ADR-239 Amendment 2)', () => {
  const grblCompatible = {
    ...DEFAULT_DEVICE_PROFILE,
    gcodeDialect: { dialectId: 'grbl-compatible' as const },
  };

  it("matches the entry where the dialect's default burns with constant power", () => {
    expect(contourExitRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 5, 'cut', undefined)).toBe(5);
    expect(contourExitRunwayMm(grblCompatible, 2, 'fill', undefined)).toBe(2);
  });

  it('adds nothing under dynamic power, whether from the dialect or the layer', () => {
    expect(
      contourExitRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 5, 'fill', undefined),
    ).toBeUndefined();
    expect(
      contourExitRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, 5, 'cut', 'dynamic'),
    ).toBeUndefined();
    expect(contourExitRunwayMm(DEFAULT_DEVICE_PROFILE, 5, 'cut', undefined)).toBeUndefined();
  });

  it("follows a layer's Constant power over a dynamic default", () => {
    expect(contourExitRunwayMm(DEFAULT_DEVICE_PROFILE, 4, 'cut', 'constant')).toBe(4);
  });

  it('adds nothing without an entry', () => {
    expect(
      contourExitRunwayMm(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, undefined, 'cut', undefined),
    ).toBeUndefined();
  });
});

describe('contourExitPoint', () => {
  const zigzag = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
  ];

  it('carries on past the last vertex along the last edge', () => {
    expect(contourExitPoint(zigzag, 5)).toEqual({ x: 20, y: 25 });
  });

  it('closes a closed contour by continuing its closing edge past the start', () => {
    const square = [...zigzag, { x: 10, y: 20 }, { x: 10, y: 10 }];
    expect(contourExitPoint(square, 5)).toEqual({ x: 10, y: 5 });
  });

  it('skips degenerate trailing edges to find a real tangent', () => {
    const exit = contourExitPoint([...zigzag, { x: 20, y: 20.0004 }], 5);
    expect(exit?.x).toBe(20);
    expect(exit?.y).toBeCloseTo(25.0004, 9);
  });

  it('bounds the exit by the room left before the bed edge, as the entry is', () => {
    const bed = { minX: 0, minY: 0, maxX: 100, maxY: 22 };
    expect(contourExitPoint(zigzag, 5, bed)).toEqual({ x: 20, y: 22 });
    expect(contourExitPoint(zigzag, 5, { ...bed, maxY: 20 })).toBeNull();
  });

  it('is skipped with an unknown bed envelope (ADR-343)', () => {
    expect(contourExitPoint(zigzag, 5, null)).toBeNull();
  });

  it('mirrors the entry of the reversed contour', () => {
    const reversed = [...zigzag].reverse();
    const bed = { minX: 0, minY: 0, maxX: 100, maxY: 23 };
    expect(contourExitPoint(zigzag, 5, bed)).toEqual(contourEntryPoint(reversed, 5, bed));
  });
});
