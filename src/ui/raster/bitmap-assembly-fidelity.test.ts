import { describe, expect, it } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type TextObject,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes/create-polyline';
import { parseSvg } from '../../io/svg/parse-svg';
import {
  assembleBitmap,
  bitmapConversionTarget,
  type BitmapConversionOptions,
  type ConvertibleVector,
} from './bitmap-assembly';
import { estimateBitmapConversion } from './bitmap-conversion-plan';

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function vector(id: string, polylines: ReadonlyArray<Polyline>, color = '#ff0000'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines }],
  };
}

function convert(objects: ReadonlyArray<ConvertibleVector>, options: BitmapConversionOptions = {}) {
  let captured: VectorRaster | undefined;
  const image = assembleBitmap(
    objects,
    (raster) => {
      captured = raster;
      return { dataUrl: 'data:,', lumaBase64: '' };
    },
    'bitmap',
    { dpi: 254, ...options },
  );
  if (captured === undefined) throw new Error('Expected encoded raster');
  return { image, raster: captured };
}

function at(raster: VectorRaster, xMm: number, yMm: number): number | undefined {
  return raster.luma[Math.floor(yMm * 10) * raster.width + Math.floor(xMm * 10)];
}

describe('bitmap fill ownership and physical bounds', () => {
  it('unions separate explicit SVG elements even when their overlapping contours wind oppositely', () => {
    const imported = parseSvg({
      id: 'imported',
      source: 'elements.svg',
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="15mm" height="10mm" viewBox="0 0 15 10" fill-rule="nonzero"><path fill="black" d="M0 0H10V10H0Z"/><path fill="black" d="M5 0V10H15V0Z"/></svg>',
    });
    if (imported.object === null) throw new Error('Expected imported vector');
    const { raster } = convert([imported.object]);
    expect(at(raster, 7.5, 5)).toBe(127);
    expect(raster.luma.filter((value) => value === 127)).toHaveLength(15_000);
  });

  it.each(['nonzero', 'evenodd'] as const)(
    'keeps an imported explicit %s rule through conversion',
    (fillRule) => {
      const imported = parseSvg({
        id: 'imported',
        source: 'overlap.svg',
        svgText: `<svg xmlns="http://www.w3.org/2000/svg" width="15mm" height="10mm" viewBox="0 0 15 10"><path fill="black" fill-rule="${fillRule}" d="M0 0H10V10H0Z M5 0H15V10H5Z"/></svg>`,
      });
      if (imported.object === null) throw new Error('Expected imported vector');
      const { raster } = convert([imported.object]);
      expect(at(raster, 7.5, 5)).toBe(fillRule === 'nonzero' ? 127 : 255);
    },
  );

  it.each(['legacy-color', 'operation-id'])(
    'unions independent fill operations with %s bindings',
    (binding) => {
      const left = vector('left', [rectangle(0, 0, 10, 10)]);
      const right = vector('right', [rectangle(5, 0, 10, 10)], '#0000ff');
      const objects =
        binding === 'operation-id'
          ? [left, right].map((object, index) => ({ ...object, operationIds: [`fill-${index}`] }))
          : [left, right];
      const { raster } = convert(objects, {
        renderType: 'use-cut-settings',
        layers: [
          { id: 'fill-0', color: '#ff0000', mode: 'fill' },
          { id: 'fill-1', color: '#0000ff', mode: 'fill' },
        ],
      });
      expect(at(raster, 7.5, 5)).toBe(127);
      expect(raster.luma.filter((value) => value === 127)).toHaveLength(15_000);
    },
  );

  it('keeps a same-operation overlap empty and Fill All parity across objects', () => {
    const objects = [
      vector('left', [rectangle(0, 0, 10, 10)]),
      vector('right', [rectangle(5, 0, 10, 10)]),
    ];
    for (const renderType of ['fill-all', 'use-cut-settings'] as const) {
      const { raster } = convert(objects, {
        renderType,
        layers: [{ color: '#ff0000', mode: 'fill' }],
      });
      expect(at(raster, 7.5, 5)).toBe(255);
      expect(raster.luma.filter((value) => value === 127)).toHaveLength(10_000);
    }
  });

  it.each(['text', 'explicit-nonzero'])(
    'keeps same-winding joins within a %s object solid',
    (kind) => {
      const source = vector('joined', [rectangle(0, 0, 10, 10), rectangle(5, 0, 10, 10)]);
      const text: TextObject = {
        ...source,
        kind: 'text',
        content: 'joined',
        fontKey: 'fixture',
        sizeMm: 10,
        alignment: 'left',
        lineHeight: 1,
        letterSpacing: 0,
        color: '#ff0000',
      };
      const object =
        kind === 'text'
          ? text
          : {
              ...source,
              paths: source.paths.map((path) => ({ ...path, fillRule: 'nonzero' as const })),
            };
      for (const renderType of ['fill-all', 'use-cut-settings'] as const) {
        const { raster } = convert([object], {
          renderType,
          layers: [{ color: '#ff0000', mode: 'fill' }],
        });
        expect(at(raster, 7.5, 5)).toBe(127);
        expect(raster.luma.filter((value) => value === 127)).toHaveLength(15_000);
      }
    },
  );

  it('retains an opposite-winding counter inside nonzero text and separate evenodd artwork', () => {
    const hole = rectangle(5, 2, 10, 6);
    const source = vector('counter', [
      rectangle(0, 0, 20, 10),
      { ...hole, points: [...hole.points].reverse() },
    ]);
    const nonzero = {
      ...source,
      paths: source.paths.map((path) => ({ ...path, fillRule: 'nonzero' as const })),
    };
    for (const object of [source, nonzero]) {
      const { raster } = convert([object]);
      expect(at(raster, 10, 5)).toBe(255);
      expect(at(raster, 1, 5)).toBe(127);
    }
  });

  it('honors path-level operation bindings and does not double-count repeated operation ids', () => {
    const source = vector('mixed', [rectangle(0, 0, 10, 10)]);
    const object = {
      ...source,
      operationIds: ['object-line'],
      paths: [
        { ...source.paths[0]!, operationIds: ['fill', 'fill'] },
        { color: '#000000', operationIds: ['fill-other'], polylines: [rectangle(5, 0, 10, 10)] },
      ],
    };
    const { raster } = convert([object], {
      renderType: 'use-cut-settings',
      layers: [
        { id: 'object-line', color: '#ff0000', mode: 'line' },
        { id: 'fill', color: '#ff0000', mode: 'fill' },
        { id: 'fill-other', color: '#ff0000', mode: 'fill' },
      ],
    });
    expect(at(raster, 7.5, 5)).toBe(127);
    expect(raster.luma.filter((value) => value === 127)).toHaveLength(15_000);
  });

  it.each(['horizontal', 'vertical'])(
    'gives a drawn %s line one centred physical pixel',
    (orientation) => {
      const points =
        orientation === 'horizontal'
          ? [
              { x: 10, y: 10 },
              { x: 30, y: 10 },
            ]
          : [
              { x: 10, y: 10 },
              { x: 10, y: 30 },
            ];
      const object = createPolyline({
        id: 'line',
        color: '#000000',
        spec: { points, closed: false },
      });
      const plan = estimateBitmapConversion(bitmapConversionTarget([object]), 254);
      const { image, raster } = convert([object], { renderType: 'outlines' });
      expect(image.bounds).toEqual(plan.bounds);
      expect(image.bounds.maxX - image.bounds.minX).toBeCloseTo(
        orientation === 'horizontal' ? 20 : 0.1,
      );
      expect(image.bounds.maxY - image.bounds.minY).toBeCloseTo(
        orientation === 'vertical' ? 20 : 0.1,
      );
      expect((image.bounds.minX + image.bounds.maxX) / 2).toBe(
        orientation === 'horizontal' ? 20 : 10,
      );
      expect((image.bounds.minY + image.bounds.maxY) / 2).toBe(
        orientation === 'vertical' ? 20 : 10,
      );
      expect(raster.luma.filter((value) => value === 127)).toHaveLength(200);
      expect([image.pixelWidth, image.pixelHeight]).toEqual(
        orientation === 'horizontal' ? [200, 1] : [1, 200],
      );
    },
  );

  it('refuses an empty selection before encoding', () => {
    expect(() => convert([])).toThrow(/invalid/);
  });

  it('refuses reversed source bounds before the transformed AABB can hide them', () => {
    const object = vector('invalid', [rectangle(0, 0, 10, 10)]);
    expect(() =>
      convert([{ ...object, bounds: { minX: 10, minY: 0, maxX: 0, maxY: 10 } }]),
    ).toThrow(/invalid/);
  });
});
