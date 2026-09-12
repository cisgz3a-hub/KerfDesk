import { describe, expect, it } from 'vitest';
import type { RasterToolpathSource, ToolpathStep } from '../../core/job/toolpath-types';
import { PreparationStepRehydrator } from './preparation-step-rehydrator';

type Cut = Extract<ToolpathStep, { readonly kind: 'cut' }>;
type Travel = Extract<ToolpathStep, { readonly kind: 'travel' }>;

function rasterSource(): RasterToolpathSource {
  return {
    kind: 'raster',
    objectId: 'image-β',
    source: 'original photo.png',
    passIndex: -0,
    rowIndex: 39,
    spanIndex: 5,
    pixelStartX: 18,
    pixelEndX: 27,
  };
}

function cut(source: RasterToolpathSource = rasterSource()): Cut {
  return {
    kind: 'cut',
    color: '#80a0ff',
    source,
    polyline: [
      { x: -0, y: 1 / 3 },
      { x: 17.12345678901234, y: -1e-13 },
    ],
    length: Math.PI,
  };
}

function travel(): Travel {
  return {
    kind: 'travel',
    from: { x: -0, y: -1e-13 },
    to: { x: 1 / 3, y: 27.12345678901234 },
    length: -0,
  };
}

describe('native preparation step reconstruction', () => {
  it('recreates ordinary raster records without changing coordinates or source metadata', () => {
    const original = cut();
    const before = structuredClone(original);
    Object.freeze(original);
    Object.freeze(original.source);
    Object.freeze(original.polyline);
    original.polyline.forEach(Object.freeze);

    const result = new PreparationStepRehydrator().rehydrate(original);

    expect(result).toStrictEqual(before);
    expect(result).not.toBe(original);
    if (result.kind !== 'cut') throw new Error('expected a reconstructed cut');
    expect(result.source).not.toBe(original.source);
    expect(result.polyline).not.toBe(original.polyline);
    expect(result.polyline[0]).not.toBe(original.polyline[0]);
    expect(result.polyline[1]).not.toBe(original.polyline[1]);
    expect(Object.is(result.polyline[0]?.x, -0)).toBe(true);
    expect(Object.is(result.source?.passIndex, -0)).toBe(true);
    expect(original).toStrictEqual(before);
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('preserves optional label presence (objectId %s, source %s)', (objectId, source) => {
    const { objectId: _id, source: _source, ...required } = rasterSource();
    const metadata = {
      ...required,
      ...(objectId ? { objectId: '' } : {}),
      ...(source ? { source: '📷 photo.png' } : {}),
    };
    const original = cut(metadata);
    const result = new PreparationStepRehydrator().rehydrate(original);

    expect(result).toStrictEqual(original);
    expect(result).not.toBe(original);
    if (result.kind !== 'cut') throw new Error('expected a reconstructed cut');
    expect(Object.hasOwn(result.source!, 'objectId')).toBe(objectId);
    expect(Object.hasOwn(result.source!, 'source')).toBe(source);
  });

  it.each([undefined, 'rapid', 'feed'] as const)(
    'preserves travel motion presence and exact numeric values (%s)',
    (motion) => {
      const original = { ...travel(), ...(motion === undefined ? {} : { motion }) };
      const result = new PreparationStepRehydrator().rehydrate(original);

      expect(result).toStrictEqual(original);
      expect(result).not.toBe(original);
      if (result.kind !== 'travel') throw new Error('expected a reconstructed travel');
      expect(result.from).not.toBe(original.from);
      expect(result.to).not.toBe(original.to);
      expect(Object.is(result.from.x, -0)).toBe(true);
      expect(Object.is(result.length, -0)).toBe(true);
      expect(Object.hasOwn(result, 'motion')).toBe(motion !== undefined);
    },
  );

  it('retains all double values without rounding or coercion', () => {
    const original = {
      ...cut(),
      length: Number.NaN,
      polyline: [
        { x: Number.MIN_VALUE, y: Number.MAX_VALUE },
        { x: Infinity, y: -Infinity },
      ],
    };
    const result = new PreparationStepRehydrator().rehydrate(original);
    expect(result).toStrictEqual(original);
    expect(result).not.toBe(original);
  });

  it.each([
    ['travel Z', () => ({ ...travel(), z: { from: 3, to: 8 } })],
    ['cut Z', () => ({ ...cut(), z: { from: -3, to: -4 } })],
    ['vertex Z', () => ({ ...cut(), zs: [-3, -4] })],
    ['group', () => ({ ...cut(), groupId: 'finish-pass' })],
    ['tool', () => ({ ...cut(), toolId: 'vee-bit' })],
    ['pass', () => ({ ...cut(), passIndex: 2 })],
    ['extended step', () => ({ ...cut(), futureMetadata: { value: 'retain' } })],
    [
      'extended source',
      () => cut({ ...rasterSource(), futureMetadata: 'retain' } as RasterToolpathSource),
    ],
    [
      'extended point',
      () => ({
        ...cut(),
        polyline: [
          { x: 1, y: 2, z: 3 },
          { x: 4, y: 5 },
        ],
      }),
    ],
    [
      'extended array',
      () => ({ ...cut(), polyline: Object.assign([...cut().polyline], { label: 'retain' }) }),
    ],
    ['three vertices', () => ({ ...cut(), polyline: [...cut().polyline, { x: 1, y: 9 }] })],
    [
      'absent raster source',
      () => ({ kind: 'cut', color: '#fff', polyline: cut().polyline, length: 3 }),
    ],
    [
      'own undefined label',
      () => cut({ ...rasterSource(), source: undefined } as unknown as RasterToolpathSource),
    ],
    ['own undefined motion', () => ({ ...travel(), motion: undefined })],
    ['symbol metadata', () => ({ ...cut(), [Symbol('metadata')]: 7 })],
    ['custom prototype', () => Object.assign(Object.create({ metadata: 7 }), cut())],
    ['null prototype', () => Object.assign(Object.create(null), travel())],
    [
      'plunge',
      () => ({
        kind: 'plunge',
        at: { x: 6, y: 9 },
        fromZ: 4,
        toZ: -3,
        length: 7,
        toolId: 'endmill',
      }),
    ],
  ] as const)('keeps the complete original record for %s', (_name, makeStep) => {
    const original = makeStep() as ToolpathStep;
    expect(new PreparationStepRehydrator().rehydrate(original)).toBe(original);
  });
});
