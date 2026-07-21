import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { contourEntryPoint, contourEntryRunwayMm } from './contour-entry';

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
