import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { reliefFieldGeometryDisplay } from './relief-field-geometry-display';

describe('reliefFieldGeometryDisplay', () => {
  it('derives ordinary physical size and crop-aware nominal pitch', () => {
    const source = testReliefHeightfield({
      width: 4,
      height: 2,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      mapping: {
        crop: { kind: 'normalized-v1', x: 0.25, y: 0, width: 0.5, height: 1 },
      },
    });

    expect(reliefFieldGeometryDisplay(source, IDENTITY_TRANSFORM)).toEqual({
      widthMm: '100',
      heightMm: '50',
      pitchXMm: '50',
      pitchYMm: '25',
      collapsedAxes: [],
    });
  });

  it('retains finite results beyond the binary64 result range', () => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 1,
      physicalHeightMm: Number.MIN_VALUE,
      maxDepthMm: 5,
      mapping: {
        crop: {
          kind: 'normalized-v1',
          x: 0,
          y: 0,
          width: Number.MIN_VALUE,
          height: 1,
        },
      },
    });
    const transform = { ...IDENTITY_TRANSFORM, scaleY: 0.5 };

    expect(reliefFieldGeometryDisplay(source, transform)).toEqual({
      widthMm: '1',
      heightMm: '2.47033e-324',
      pitchXMm: '2.02402e+323',
      pitchYMm: '2.47033e-324',
      collapsedAxes: [],
    });
  });

  it('preserves algebraic cancellation without overflowed intermediates', () => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: Number.MAX_VALUE,
      physicalHeightMm: 1,
      maxDepthMm: 5,
      mapping: {
        crop: {
          kind: 'normalized-v1',
          x: 0,
          y: 0,
          width: Number.MIN_VALUE,
          height: 1,
        },
      },
    });

    expect(
      reliefFieldGeometryDisplay(source, { ...IDENTITY_TRANSFORM, scaleX: 100_000 }),
    ).toMatchObject({
      widthMm: '1.79769e+313',
      pitchXMm: '3.63857e+636',
    });
    expect(
      reliefFieldGeometryDisplay(source, { ...IDENTITY_TRANSFORM, scaleX: Number.MIN_VALUE }),
    ).toMatchObject({
      widthMm: '8.88178e-16',
      pitchXMm: '1.79769e+308',
    });
  });

  it('retains six useful significant digits near old fixed-decimal boundaries', () => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 0.0005001,
      physicalHeightMm: 0.0015001,
      maxDepthMm: 5,
    });

    expect(reliefFieldGeometryDisplay(source, IDENTITY_TRANSFORM)).toMatchObject({
      widthMm: '0.0005001',
      heightMm: '0.0015001',
      pitchXMm: '0.0005001',
      pitchYMm: '0.0015001',
    });
  });

  it('rounds the sixth significant digit from exact stored factor magnitudes', () => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 1e-7,
      physicalHeightMm: 1,
      maxDepthMm: 5,
    });

    expect(
      reliefFieldGeometryDisplay(source, { ...IDENTITY_TRANSFORM, scaleX: 9.999995 }),
    ).toMatchObject({
      widthMm: '9.99999e-7',
      pitchXMm: '9.99999e-7',
    });
  });

  it('keeps the smallest positive product distinct from exact zero scale', () => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: Number.MIN_VALUE,
      physicalHeightMm: 1,
      maxDepthMm: 5,
    });

    expect(
      reliefFieldGeometryDisplay(source, { ...IDENTITY_TRANSFORM, scaleX: Number.MIN_VALUE }),
    ).toMatchObject({
      widthMm: '2.44101e-647',
      pitchXMm: '2.44101e-647',
      collapsedAxes: [],
    });
  });

  it.each([
    { value: 0.000001, expected: '0.000001' },
    { value: 100_000_000, expected: '100000000' },
    { value: 1_000_000_000, expected: '1e+9' },
    { value: 9.999999, expected: '10' },
  ])('formats $value across notation and rounding-carry boundaries', ({ value, expected }) => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: value,
      physicalHeightMm: 1,
      maxDepthMm: 5,
    });

    expect(reliefFieldGeometryDisplay(source, IDENTITY_TRANSFORM).widthMm).toBe(expected);
  });

  it('uses exact scale zero only for the compatibility collapse state', () => {
    const source = testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: Number.MIN_VALUE,
      physicalHeightMm: 1,
      maxDepthMm: 5,
    });

    expect(reliefFieldGeometryDisplay(source, { ...IDENTITY_TRANSFORM, scaleX: -0 })).toMatchObject(
      {
        widthMm: '0',
        pitchXMm: '0',
        collapsedAxes: ['X'],
      },
    );
  });
});
